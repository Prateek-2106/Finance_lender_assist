import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { EconomyStack } from "../lib/economy-stack.js";

let t: Template;
let userData: string;
beforeAll(() => {
  const app = new cdk.App();
  const stack = new EconomyStack(app, "Eco", {
    env: { account: "123456789012", region: "us-east-1" },
    domainName: "example-vendorstreet.com",
    hostedZoneId: "Z0000000EXAMPLE",
    githubRepo: "Prateek-2106/mainstreet",
  });
  t = Template.fromStack(stack);
  const inst = Object.values(t.findResources("AWS::EC2::Instance"))[0] as { Properties: { UserData: unknown } };
  userData = JSON.stringify(inst.Properties.UserData);
}, 120_000);

describe("economy profile", () => {
  it("has no load balancer, NAT gateway or Fargate service", () => {
    t.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 0);
    t.resourceCountIs("AWS::EC2::NatGateway", 0);
    t.resourceCountIs("AWS::ECS::Service", 0);
    t.resourceCountIs("AWS::EC2::Instance", 1);
    t.hasResourceProperties("AWS::EC2::Instance", { InstanceType: "t3.micro" });
  });

  it("serves the domain and every tenant subdomain through CloudFront with one certificate", () => {
    t.hasResourceProperties("AWS::CertificateManager::Certificate", { DomainName: "example-vendorstreet.com", SubjectAlternativeNames: ["*.example-vendorstreet.com"] });
    t.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: ["example-vendorstreet.com", "*.example-vendorstreet.com"],
        ViewerCertificate: Match.objectLike({ MinimumProtocolVersion: "TLSv1.2_2021", SslSupportMethod: "sni-only" }),
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: "redirect-to-https",
          CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad", // Managed-CachingDisabled
          OriginRequestPolicyId: "216adef6-5c7f-47e4-b989-5492eafa07d3", // Managed-AllViewer: Host and Authorization reach the app
        }),
        CacheBehaviors: [Match.objectLike({ PathPattern: "/assets/*", CachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6" })], // CachingOptimized
      }),
    });
    t.hasResourceProperties("AWS::Route53::RecordSet", { Name: "example-vendorstreet.com.", Type: "A", AliasTarget: Match.anyValue() });
    t.hasResourceProperties("AWS::Route53::RecordSet", { Name: "*.example-vendorstreet.com.", Type: "A", AliasTarget: Match.anyValue() });
  });

  it("CloudFront talks to origin.<domain> with a secret header the app checks", () => {
    t.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Origins: [Match.objectLike({
          DomainName: "origin.example-vendorstreet.com",
          CustomOriginConfig: Match.objectLike({ OriginProtocolPolicy: "http-only" }),
          OriginCustomHeaders: [Match.objectLike({ HeaderName: "X-Origin-Verify" })],
        })],
      }),
    });
    t.hasResourceProperties("AWS::Route53::RecordSet", { Name: "origin.example-vendorstreet.com.", Type: "A" });
    const params = t.toJSON().Parameters as Record<string, { Default?: string }>;
    expect(Object.values(params).some((p) => p.Default === "/vendorstreet/ORIGIN_SECRET")).toBe(true);
  });

  it("the machine only accepts HTTP from CloudFront, and has no SSH", () => {
    t.resourceCountIs("AWS::EC2::SecurityGroupIngress", 1);
    t.hasResourceProperties("AWS::EC2::SecurityGroupIngress", { IpProtocol: "tcp", FromPort: 80, ToPort: 80, SourcePrefixListId: "pl-3b927c52" });
    expect(JSON.stringify(t.toJSON())).not.toMatch(/"FromPort":22/);
    t.hasResourceProperties("AWS::EC2::LaunchTemplate", {
      LaunchTemplateData: { MetadataOptions: { HttpTokens: "required", HttpPutResponseHopLimit: 2 } },
    });
  });

  it("boots into Docker and the run script, with production settings", () => {
    for (const s of ["dnf install -y docker", "/opt/vendorstreet/run.sh", "get-parameters-by-path", "--path /vendorstreet/", "TRUST_PROXY_HOPS=1", "OPEN_SIGNUP=false", "ANTHROPIC_MODEL=claude-haiku-4-5-20251001", "MAIL_TRANSPORT=ses", "awslogs-group="])
      expect(userData).toContain(s);
  });

  it("the machine can read only /vendorstreet/* settings, pull its image and send mail as the domain", () => {
    t.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Action: ["ssm:GetParametersByPath", "ssm:GetParameter"], Resource: Match.arrayWith([Match.stringLikeRegexp(":parameter/vendorstreet/\\*")]) })]) },
    });
    t.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Action: ["ses:SendEmail", "ses:SendRawEmail"], Resource: "arn:aws:ses:us-east-1:123456789012:identity/*" })]) },
    });
    t.hasResourceProperties("AWS::ECR::Repository", { RepositoryName: "vendorstreet", LifecyclePolicy: Match.anyValue() });
  });

  it("GitHub on main may push the image and run the deploy command on this one machine, nothing else", () => {
    t.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: { Statement: [Match.objectLike({ Condition: Match.objectLike({ StringLike: { "token.actions.githubusercontent.com:sub": ["repo:Prateek-2106/mainstreet:ref:refs/heads/main"] } }) })] },
    });
    const policies = JSON.stringify(t.findResources("AWS::IAM::Policy"));
    expect(policies).toContain("ssm:SendCommand");
    expect(policies).toContain("document/AWS-RunShellScript");
    expect(policies).not.toContain('"Action":"*"');
  });

  it("watches the site: a dashboard, 8 alarms that email, an uptime check, and self-healing for the machine", () => {
    t.resourceCountIs("AWS::CloudWatch::Dashboard", 1);
    t.hasResourceProperties("AWS::CloudWatch::Dashboard", { DashboardName: "VendorStreet" });
    t.resourceCountIs("AWS::CloudWatch::Alarm", 8); // the free tier covers 10
    t.hasResourceProperties("AWS::Route53::HealthCheck", {
      HealthCheckConfig: Match.objectLike({ Type: "HTTPS", FullyQualifiedDomainName: "example-vendorstreet.com", ResourcePath: "/health" }),
    });
    t.hasResourceProperties("AWS::CloudWatch::Alarm", { AlarmName: "vendorstreet-server-errors", Namespace: "VendorStreet", MetricName: "ServerErrors", Dimensions: [{ Name: "Service", Value: "web" }] });
    t.hasResourceProperties("AWS::CloudWatch::Alarm", { AlarmName: "vendorstreet-slow-pages", ExtendedStatistic: "p95", Threshold: 1500 });
    t.hasResourceProperties("AWS::CloudWatch::Alarm", { AlarmName: "vendorstreet-site-down", TreatMissingData: "breaching", Metrics: Match.arrayWith([Match.objectLike({ MetricStat: Match.objectLike({ Metric: Match.objectLike({ Namespace: "AWS/Route53", MetricName: "HealthCheckStatus" }) }) })]) });
    t.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "StatusCheckFailed_System",
      AlarmActions: Match.arrayWith([Match.objectLike({ "Fn::Join": Match.arrayWith([Match.arrayWith([Match.stringLikeRegexp("ec2:recover")])]) })]),
    });
    // Every alarm tells you when it fires and when it clears
    for (const a of Object.values(t.findResources("AWS::CloudWatch::Alarm")) as { Properties: { AlarmActions: unknown[]; OKActions: unknown[] } }[]) {
      expect(a.Properties.AlarmActions.length).toBeGreaterThan(0);
      expect(a.Properties.OKActions).toHaveLength(1);
    }
    t.resourceCountIs("AWS::SNS::Subscription", 0); // no alertEmail given here
  });

  it("emails alarms to alertEmail when it's set", () => {
    const stack = new EconomyStack(new cdk.App(), "Alerts", {
      env: { account: "123456789012", region: "us-east-1" },
      domainName: "example-vendorstreet.com",
      hostedZoneId: "Z0000000EXAMPLE",
      alertEmail: "ops@example.com",
    });
    Template.fromStack(stack).hasResourceProperties("AWS::SNS::Subscription", { Protocol: "email", Endpoint: "ops@example.com" });
  });

  it("refuses regions other than us-east-1 (CloudFront certificates live there)", () => {
    expect(() => new EconomyStack(new cdk.App(), "X", { env: { account: "123456789012", region: "eu-west-1" }, domainName: "x.com", hostedZoneId: "Z1" })).toThrow(/us-east-1/);
  });
});

describe("GitHub deploy trust", () => {
  it("accepts GitHub's ID-based subject for exactly this repository when the IDs are given", () => {
    const stack = new EconomyStack(new cdk.App(), "Ids", {
      env: { account: "123456789012", region: "us-east-1" },
      domainName: "example-mainstreet.com",
      hostedZoneId: "Z0000000EXAMPLE",
      githubRepo: "Prateek-2106/vendorstreet",
      githubRepoIds: "65821259/1400722849",
    });
    Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: [Match.objectLike({
          Condition: Match.objectLike({
            StringLike: {
              "token.actions.githubusercontent.com:sub": [
                "repo:Prateek-2106/vendorstreet:ref:refs/heads/main",
                "repo:Prateek-2106@65821259/vendorstreet@1400722849:ref:refs/heads/main",
              ],
            },
          }),
        })],
      },
    });
  });

  it("rejects malformed IDs instead of trusting something broader", async () => {
    const { githubSubjects } = await import("../lib/github.js");
    expect(() => githubSubjects("Prateek-2106/vendorstreet", "abc/*")).toThrow(/githubRepoIds/);
  });
});
