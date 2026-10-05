import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { VendorStreetStack } from "../lib/vendorstreet-stack.js";

let t: Template;
beforeAll(() => {
  const app = new cdk.App();
  const stack = new VendorStreetStack(app, "Test", {
    env: { account: "123456789012", region: "us-east-1" },
    domainName: "example-vendorstreet.com",
    hostedZoneId: "Z0000000EXAMPLE",
    githubRepo: "Prateek-2106/mainstreet",
    secrets: { mongoUrl: "/vendorstreet/MONGO_URL" },
  });
  t = Template.fromStack(stack);
}, 120_000);

describe("traffic", () => {
  it("serves HTTPS with one certificate for the domain and every tenant subdomain", () => {
    t.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: "example-vendorstreet.com",
      SubjectAlternativeNames: ["*.example-vendorstreet.com"],
      ValidationMethod: "DNS",
    });
    t.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", { Port: 443, Protocol: "HTTPS", Certificates: Match.anyValue() });
  });
  it("redirects plain HTTP to HTTPS", () => {
    t.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      Port: 80,
      DefaultActions: [Match.objectLike({ Type: "redirect", RedirectConfig: Match.objectLike({ Protocol: "HTTPS", StatusCode: "HTTP_301" }) })],
    });
  });
  it("points the apex and the wildcard at the load balancer", () => {
    t.resourceCountIs("AWS::Route53::RecordSet", 5); // + 3 DKIM records for email
    t.hasResourceProperties("AWS::Route53::RecordSet", { Name: "example-vendorstreet.com.", Type: "A" });
    t.hasResourceProperties("AWS::Route53::RecordSet", { Name: "*.example-vendorstreet.com.", Type: "A" });
  });
  it("health-checks /health", () => {
    t.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", { HealthCheckPath: "/health", Port: 80 });
  });
});

describe("service", () => {
  it("rolls back a deploy that never gets healthy, with no downtime", () => {
    t.hasResourceProperties("AWS::ECS::Service", {
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
        MinimumHealthyPercent: 100,
        MaximumPercent: 200,
      }),
    });
  });
  it("gets config from env and the database URL from SSM, never as plain text", () => {
    t.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Cpu: "256",
      Memory: "512",
      ContainerDefinitions: [
        Match.objectLike({
          Environment: Match.arrayWith([{ Name: "BASE_DOMAIN", Value: "example-vendorstreet.com" }, { Name: "PUBLIC_URL", Value: "https://example-vendorstreet.com" }]),
          Secrets: [
            {
              Name: "MONGO_URL",
              // an SSM parameter ARN, joined at deploy time so the partition resolves
              ValueFrom: { "Fn::Join": ["", Match.arrayWith([Match.stringLikeRegexp(":ssm:us-east-1:123456789012:parameter/vendorstreet/MONGO_URL$")])] },
            },
          ],
        }),
      ],
    });
    const json = JSON.stringify(t.toJSON());
    expect(json).not.toMatch(/mongodb(\+srv)?:\/\//);
  });
  it("has no NAT gateway (cost) and keeps logs a week", () => {
    t.resourceCountIs("AWS::EC2::NatGateway", 0);
    t.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 7 });
  });
});

describe("email", () => {
  it("verifies the domain with SES (DKIM in Route 53) and lets only the task send from it", () => {
    t.hasResourceProperties("AWS::SES::EmailIdentity", { EmailIdentity: "example-vendorstreet.com" });
    t.resourceCountIs("AWS::Route53::RecordSet", 5); // apex, wildcard, 3 DKIM CNAMEs
    t.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([Match.objectLike({ Action: ["ses:SendEmail", "ses:SendRawEmail"], Resource: Match.anyValue() })]),
      }),
    });
    t.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: [Match.objectLike({ Environment: Match.arrayWith([{ Name: "MAIL_TRANSPORT", Value: "ses" }]) })],
    });
  });
});

describe("GitHub deploy role", () => {
  it("can only be assumed from this repo's main branch", () => {
    t.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: [
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
              StringLike: { "token.actions.githubusercontent.com:sub": "repo:Prateek-2106/mainstreet:ref:refs/heads/main" },
            },
          }),
        ],
      }),
    });
  });
  it("may only assume the CDK bootstrap roles", () => {
    t.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: [{ Action: "sts:AssumeRole", Effect: "Allow", Resource: "arn:aws:iam::123456789012:role/cdk-hnb659fds-*" }],
        Version: "2012-10-17",
      },
    });
  });
});
