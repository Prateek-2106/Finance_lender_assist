import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as ses from "aws-cdk-lib/aws-ses";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { githubSubjects } from "./github.js";

export interface VendorStreetProps extends cdk.StackProps {
  domainName: string; // e.g. vendorstreet-prateek.com
  hostedZoneId: string; // the Route 53 zone created when the domain was registered
  githubRepo?: string; // "owner/repo": creates a role GitHub Actions can assume to deploy
  githubRepoIds?: string; // "ownerId/repoId": also accept GitHub's ID-based token subject (see github.ts)
  githubOidcProviderArn?: string; // reuse an existing GitHub OIDC provider in this account
  llmProvider?: "none" | "anthropic";
  /** SSM SecureString parameters, created once with `aws ssm put-parameter` (see README). */
  secrets?: { mongoUrl: string; twilioAuthToken?: string; anthropicApiKey?: string; underwriters?: string };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export class VendorStreetStack extends cdk.Stack {
  /** Pinned so no construct triggers an AWS lookup at synth time (works offline, in tests, in CI). */
  override get availabilityZones(): string[] {
    return [`${this.region}a`, `${this.region}b`];
  }

  constructor(scope: Construct, id: string, props: VendorStreetProps) {
    super(scope, id, props);
    const { domainName } = props;
    const secretNames = props.secrets ?? { mongoUrl: "/vendorstreet/MONGO_URL" };

    // No lookups, so `cdk synth` works offline and in tests.
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", { hostedZoneId: props.hostedZoneId, zoneName: domainName });

    // Public subnets only and no NAT gateway: tasks get a public IP to reach Atlas and ECR.
    // (A NAT gateway is ~$32/month; this is a demo. Production: private subnets + NAT or VPC endpoints.)
    const vpc = new ec2.Vpc(this, "Vpc", {
      availabilityZones: this.availabilityZones,
      natGateways: 0,
      subnetConfiguration: [{ name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
    });
    const cluster = new ecs.Cluster(this, "Cluster", { vpc, containerInsightsV2: ecs.ContainerInsights.DISABLED });

    // One certificate for the platform domain and every tenant subdomain.
    const certificate = new acm.Certificate(this, "Certificate", {
      domainName,
      subjectAlternativeNames: [`*.${domainName}`],
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const image = ecs.ContainerImage.fromDockerImageAsset(
      new ecrAssets.DockerImageAsset(this, "Image", { directory: repoRoot, platform: ecrAssets.Platform.LINUX_AMD64 }),
    );
    const secureParam = (id: string, name: string) =>
      ecs.Secret.fromSsmParameter(ssm.StringParameter.fromSecureStringParameterAttributes(this, id, { parameterName: name }));
    const secrets: Record<string, ecs.Secret> = { MONGO_URL: secureParam("MongoUrl", secretNames.mongoUrl) };
    if (secretNames.twilioAuthToken) secrets.TWILIO_AUTH_TOKEN = secureParam("TwilioToken", secretNames.twilioAuthToken);
    if (secretNames.anthropicApiKey) secrets.ANTHROPIC_API_KEY = secureParam("AnthropicKey", secretNames.anthropicApiKey);
    if (secretNames.underwriters) secrets.UNDERWRITERS = secureParam("Underwriters", secretNames.underwriters);

    // Email from no-reply@yourdomain.com through SES, with DKIM records added to Route 53 automatically.
    // New SES accounts start in the sandbox (only verified recipients) until production access is requested.
    new ses.EmailIdentity(this, "MailIdentity", { identity: ses.Identity.publicHostedZone(zone) });

    const service = new patterns.ApplicationLoadBalancedFargateService(this, "Web", {
      cluster,
      cpu: 256,
      memoryLimitMiB: 512,
      desiredCount: 1,
      minHealthyPercent: 100, // a new task is healthy before the old one stops: no downtime on deploy
      maxHealthyPercent: 200,
      circuitBreaker: { rollback: true }, // a deploy that never gets healthy rolls itself back
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      publicLoadBalancer: true,
      protocol: cdk.aws_elasticloadbalancingv2.ApplicationProtocol.HTTPS,
      certificate,
      redirectHTTP: true,
      healthCheckGracePeriod: cdk.Duration.seconds(30),
      taskImageOptions: {
        image,
        containerPort: 3000,
        environment: {
          NODE_ENV: "production",
          BASE_DOMAIN: domainName,
          PUBLIC_URL: `https://${domainName}`,
          LLM_PROVIDER: props.llmProvider ?? "none",
          MAIL_TRANSPORT: "ses",
          MAIL_FROM: `Vendor Street <no-reply@${domainName}>`,
        },
        secrets,
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: "web",
          logGroup: new logs.LogGroup(this, "Logs", { retention: logs.RetentionDays.ONE_WEEK, removalPolicy: cdk.RemovalPolicy.DESTROY }),
        }),
      },
    });
    // The task's own role sends email: no SMTP passwords anywhere.
    service.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`], // sandbox also checks the recipient's identity
      }),
    );
    service.targetGroup.configureHealthCheck({ path: "/health", healthyHttpCodes: "200", interval: cdk.Duration.seconds(15) });
    service.targetGroup.setAttribute("deregistration_delay.timeout_seconds", "15");

    // yourdomain.com and *.yourdomain.com both point at the load balancer.
    const alias = route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(service.loadBalancer));
    new route53.ARecord(this, "Apex", { zone, target: alias });
    new route53.ARecord(this, "Wildcard", { zone, recordName: `*.${domainName}`, target: alias });

    new cdk.CfnOutput(this, "Url", { value: `https://${domainName}` });
    new cdk.CfnOutput(this, "TenantUrlPattern", { value: `https://<subdomain>.${domainName}/app` });

    if (props.githubRepo) {
      // GitHub Actions deploys by assuming this role over OIDC: no AWS keys stored in GitHub.
      const provider = props.githubOidcProviderArn
        ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(this, "GitHubOidc", props.githubOidcProviderArn)
        : new iam.OpenIdConnectProvider(this, "GitHubOidc", { url: "https://token.actions.githubusercontent.com", clientIds: ["sts.amazonaws.com"] });
      const role = new iam.Role(this, "GitHubDeployRole", {
        assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
          StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
          StringLike: { "token.actions.githubusercontent.com:sub": githubSubjects(props.githubRepo, props.githubRepoIds) },
        }),
        description: "Assumed by GitHub Actions on main to run cdk deploy",
        maxSessionDuration: cdk.Duration.hours(1),
      });
      // Least privilege: it may only assume the CDK bootstrap roles, which do the actual work.
      role.addToPolicy(
        new iam.PolicyStatement({ actions: ["sts:AssumeRole"], resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`] }),
      );
      new cdk.CfnOutput(this, "GitHubDeployRoleArn", { value: role.roleArn });
    }
  }
}
