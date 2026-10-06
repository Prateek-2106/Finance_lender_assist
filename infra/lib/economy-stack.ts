// The "economy" profile: the same app for about $12 a month instead of about $40.
//
//   visitor ──HTTPS──▶ CloudFront (*.domain cert, caches /assets)
//                          │ HTTP + secret header, only from CloudFront's address ranges
//                          ▼
//                     one EC2 instance (Elastic IP) running the Docker image from ECR
//                          │
//                          ├─▶ MongoDB Atlas (free M0)   ├─▶ SES (email)   ├─▶ Anthropic (capped)
//
// Trade-offs, on purpose: one instance (a deploy restarts the container: a few seconds of downtime),
// and CloudFront→instance is HTTP inside AWS's network, guarded by a security group that only admits
// CloudFront plus a secret header. The "full" profile (vendorstreet-stack.ts) has TLS to a load balancer,
// Fargate with rolling deploys and no single machine to patch.
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as ses from "aws-cdk-lib/aws-ses";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { githubSubjects } from "./github.js";

/** AWS-managed list of CloudFront's origin-facing addresses (`com.amazonaws.global.cloudfront.origin-facing`), per region. */
export const CLOUDFRONT_PREFIX_LISTS: Record<string, string> = { "us-east-1": "pl-3b927c52" };

export interface EconomyProps extends cdk.StackProps {
  domainName: string;
  hostedZoneId: string;
  githubRepo?: string;
  /** "ownerId/repoId": accept GitHub's newer ID-based token subject too (see github.ts). */
  githubRepoIds?: string;
  githubOidcProviderArn?: string;
  /** t3.micro (1 GB) is enough for a demo; t3.small if you see memory pressure. */
  instanceType?: string;
  cloudfrontPrefixListId?: string;
  /** Non-secret settings passed to the container. Secrets come from SSM under /vendorstreet/. */
  environment?: Record<string, string>;
}

export const SSM_PREFIX = "/vendorstreet/";

export class EconomyStack extends cdk.Stack {
  override get availabilityZones(): string[] {
    return [`${this.region}a`];
  }

  constructor(scope: Construct, id: string, props: EconomyProps) {
    super(scope, id, props);
    if (this.region !== "us-east-1") throw new Error("The economy profile deploys to us-east-1: CloudFront certificates must live there");
    const { domainName } = props;
    const prefixListId = props.cloudfrontPrefixListId ?? CLOUDFRONT_PREFIX_LISTS[this.region]!;
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", { hostedZoneId: props.hostedZoneId, zoneName: domainName });

    // ── network: one public subnet, no NAT gateway (that alone would be ~$32/month)
    const vpc = new ec2.Vpc(this, "Vpc", {
      availabilityZones: this.availabilityZones,
      natGateways: 0,
      subnetConfiguration: [{ name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
    });
    const sg = new ec2.SecurityGroup(this, "WebSg", { vpc, description: "HTTP from CloudFront only; no SSH (use SSM Session Manager)", allowAllOutbound: true });
    sg.addIngressRule(ec2.Peer.prefixList(prefixListId), ec2.Port.tcp(80), "CloudFront origin-facing addresses");

    // ── image registry, logs, email
    const repo = new ecr.Repository(this, "Repo", {
      repositoryName: "vendorstreet",
      lifecycleRules: [{ maxImageCount: 10, description: "keep the last 10 builds for rollback" }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });
    const logGroup = new logs.LogGroup(this, "Logs", { logGroupName: "/vendorstreet/web", retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: cdk.RemovalPolicy.DESTROY });
    new ses.EmailIdentity(this, "MailIdentity", { identity: ses.Identity.publicHostedZone(zone) });

    // ── the machine's permissions: pull the image, read /vendorstreet/* settings, write logs, send email.
    // Session Manager replaces SSH, so no key pair and no port 22.
    const role = new iam.Role(this, "InstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")],
    });
    repo.grantPull(role);
    logGroup.grantWrite(role);
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParametersByPath", "ssm:GetParameter"],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${SSM_PREFIX}*`, `arn:aws:ssm:${this.region}:${this.account}:parameter${SSM_PREFIX.slice(0, -1)}`],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({ actions: ["kms:Decrypt"], resources: ["*"], conditions: { StringEquals: { "kms:ViaService": `ssm.${this.region}.amazonaws.com` } } }),
    );
    role.addToPolicy(
      // Any identity verified in this account. In the SES sandbox AWS checks the *recipient's* identity too
      // (every recipient must be verified), so naming only the domain fails with "not authorized ...
      // identity/someone@gmail.com". The account only verifies the domain and test inboxes, so this stays narrow.
      new iam.PolicyStatement({ actions: ["ses:SendEmail", "ses:SendRawEmail"], resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`] }),
    );

    // ── settings for the container (non-secret). Secrets are read on the machine at start-up.
    const environment: Record<string, string> = {
      NODE_ENV: "production",
      PORT: "3000",
      BASE_DOMAIN: domainName,
      PUBLIC_URL: `https://${domainName}`,
      TRUST_PROXY_HOPS: "1", // CloudFront
      MAIL_TRANSPORT: "ses",
      MAIL_FROM: `Vendor Street <no-reply@${domainName}>`,
      AWS_REGION: this.region,
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_MODEL: "claude-haiku-4-5-20251001",
      AI_DAILY_LIMIT: "300",
      AI_DAILY_LIMIT_PER_BUSINESS: "25",
      DEMO_ENABLED: "true",
      DEMO_TTL_DAYS: "3",
      OPEN_SIGNUP: "false",
      DEMO_UNDERWRITER_KEY: "uw_demo_try_it_0001", // public on purpose: shown on the homepage, sees demo businesses only
      ...(props.githubRepo ? { SITE_REPO_URL: `https://github.com/${props.githubRepo}` } : {}),
      ...props.environment,
    };
    const envFile = Object.entries(environment).map(([k, v]) => `${k}=${v}`).join("\n");

    // run.sh is how every deploy happens: GitHub Actions calls it through SSM with the new image tag.
    const runScript = `#!/bin/bash
# Pulls an image and (re)starts the app. Usage: run.sh <image-tag>   (no tag: restart the last one)
set -euo pipefail
cd /opt/vendorstreet
TAG="\${1:-$(cat current-tag 2>/dev/null || echo latest)}"
IMAGE="${repo.repositoryUri}:$TAG"
# Secrets and settings: every parameter under ${SSM_PREFIX} becomes an environment variable
aws ssm get-parameters-by-path --region ${this.region} --path ${SSM_PREFIX} --with-decryption \\
  --query 'Parameters[*].[Name,Value]' --output text \\
  | while IFS=$'\\t' read -r name value; do echo "\${name##*/}=$value"; done > secrets.env
chmod 600 secrets.env
aws ecr get-login-password --region ${this.region} | docker login --username AWS --password-stdin ${this.account}.dkr.ecr.${this.region}.amazonaws.com >/dev/null
docker pull "$IMAGE"
docker rm -f vendorstreet >/dev/null 2>&1 || true
docker run -d --name vendorstreet --restart unless-stopped -p 80:3000 \\
  --env-file app.env --env-file secrets.env \\
  --log-driver awslogs --log-opt awslogs-region=${this.region} --log-opt awslogs-group=${logGroup.logGroupName} --log-opt awslogs-stream=web \\
  "$IMAGE"
for i in $(seq 1 30); do
  if curl -fsS localhost/health >/dev/null; then echo "$TAG" > current-tag; echo "running $IMAGE"; exit 0; fi
  sleep 2
done
echo "app did not become healthy"; docker logs --tail 80 vendorstreet; exit 1
`;

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      "set -eux",
      // 1 GB of RAM: add swap so a build-free Node app and Docker never get OOM-killed
      "if [ ! -f /swapfile ]; then dd if=/dev/zero of=/swapfile bs=1M count=1024 && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile swap swap defaults 0 0' >> /etc/fstab; fi",
      "dnf install -y docker",
      "systemctl enable --now docker",
      "mkdir -p /opt/vendorstreet",
      `cat > /opt/vendorstreet/app.env <<'ENV'\n${envFile}\nENV`,
      `cat > /opt/vendorstreet/run.sh <<'RUN'\n${runScript}RUN`,
      "chmod +x /opt/vendorstreet/run.sh",
      // First boot: start whatever is in the registry; before the first push there is nothing yet, and that's fine
      "/opt/vendorstreet/run.sh || echo 'no image yet: push to main to deploy'",
    );

    const instance = new ec2.Instance(this, "Web", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType(props.instanceType ?? "t3.micro"),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: sg,
      role,
      userData,
      userDataCausesReplacement: true, // changing the boot script builds a fresh machine
      blockDevices: [{ deviceName: "/dev/xvda", volume: ec2.BlockDeviceVolume.ebs(16, { volumeType: ec2.EbsDeviceVolumeType.GP3, encrypted: true }) }],
    });
    // IMDSv2 only, with a hop limit of 2 so the app inside its Docker container can still get the
    // instance role's credentials (for SES). The default of 1 stops at the container's network bridge.
    const metadata = new ec2.LaunchTemplate(this, "Metadata", { requireImdsv2: true, httpPutResponseHopLimit: 2, httpTokens: ec2.LaunchTemplateHttpTokens.REQUIRED });
    (instance.node.defaultChild as ec2.CfnInstance).launchTemplate = { launchTemplateId: metadata.launchTemplateId!, version: metadata.latestVersionNumber };
    const eip = new ec2.CfnEIP(this, "Ip", { instanceId: instance.instanceId, tags: [{ key: "Name", value: "vendorstreet" }] });
    const originHost = `origin.${domainName}`;
    new route53.ARecord(this, "OriginRecord", { zone, recordName: originHost, target: route53.RecordTarget.fromIpAddresses(eip.ref), ttl: cdk.Duration.minutes(5) });

    // ── CloudFront: TLS for the domain and every tenant subdomain, then on to the machine
    const certificate = new acm.Certificate(this, "Certificate", {
      domainName,
      subjectAlternativeNames: [`*.${domainName}`],
      validation: acm.CertificateValidation.fromDns(zone),
    });
    // A plain String parameter you create once (see README); CloudFront sends it, the app checks it.
    const originSecret = ssm.StringParameter.valueForStringParameter(this, `${SSM_PREFIX}ORIGIN_SECRET`);
    const origin = new origins.HttpOrigin(originHost, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
      customHeaders: { "X-Origin-Verify": originSecret },
      readTimeout: cdk.Duration.seconds(60), // AI drafts can take a while
      keepaliveTimeout: cdk.Duration.seconds(5),
    });
    const distribution = new cloudfront.Distribution(this, "Cdn", {
      comment: "vendorstreet",
      domainNames: [domainName, `*.${domainName}`],
      certificate,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // North America + Europe edges: cheapest
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        // Pages and the API are per business and per user: never cached. All viewer headers go through,
        // which is what makes CloudFront pass on Host (which business) and Authorization (who).
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      },
      additionalBehaviors: {
        // Hashed file names: safe to cache at the edge for a year, shared across every business.
        "/assets/*": {
          origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
        },
      },
    });

    const alias = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution));
    new route53.ARecord(this, "Apex", { zone, target: alias });
    new route53.ARecord(this, "Wildcard", { zone, recordName: `*.${domainName}`, target: alias });

    new cdk.CfnOutput(this, "Url", { value: `https://${domainName}` });
    new cdk.CfnOutput(this, "InstanceId", { value: instance.instanceId });
    new cdk.CfnOutput(this, "RepositoryUri", { value: repo.repositoryUri });
    new cdk.CfnOutput(this, "TailLogs", { value: `aws logs tail ${logGroup.logGroupName} --follow` });
    new cdk.CfnOutput(this, "Shell", { value: `aws ssm start-session --target ${instance.instanceId}` });

    if (props.githubRepo) {
      // GitHub Actions on main: push the image, then tell the machine to run it. No AWS keys in GitHub.
      const provider = props.githubOidcProviderArn
        ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(this, "GitHubOidc", props.githubOidcProviderArn)
        : new iam.OpenIdConnectProvider(this, "GitHubOidc", { url: "https://token.actions.githubusercontent.com", clientIds: ["sts.amazonaws.com"] });
      const deployRole = new iam.Role(this, "GitHubDeployRole", {
        assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
          StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
          StringLike: { "token.actions.githubusercontent.com:sub": githubSubjects(props.githubRepo, props.githubRepoIds) },
        }),
        description: "GitHub Actions on main: push the image and restart the app",
        maxSessionDuration: cdk.Duration.hours(1),
      });
      repo.grantPullPush(deployRole);
      deployRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ["ssm:SendCommand"],
          resources: [`arn:aws:ec2:${this.region}:${this.account}:instance/${instance.instanceId}`, `arn:aws:ssm:${this.region}::document/AWS-RunShellScript`],
        }),
      );
      deployRole.addToPolicy(new iam.PolicyStatement({ actions: ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"], resources: ["*"] }));
      new cdk.CfnOutput(this, "GitHubDeployRoleArn", { value: deployRole.roleArn });
    }
  }
}
