import * as cdk from "aws-cdk-lib";
import { VendorStreetStack } from "../lib/vendorstreet-stack.js";
import { EconomyStack } from "../lib/economy-stack.js";

const app = new cdk.App();
const ctx = (k: string) => app.node.tryGetContext(k) as string | undefined;
const domainName = ctx("domainName");
const hostedZoneId = ctx("hostedZoneId");
if (!domainName || !hostedZoneId) throw new Error("Set domainName and hostedZoneId in infra/cdk.json (see README: Deploy to AWS)");
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "us-east-1" };

// profile=economy (default): CloudFront + one EC2 instance, ~$12/month.
// profile=full: load balancer + Fargate, ~$40/month. `npx cdk deploy -c profile=full`
if ((ctx("profile") ?? "economy") === "economy") {
  new EconomyStack(app, "VendorStreetEconomy", {
    env: { ...env, region: "us-east-1" },
    domainName,
    hostedZoneId,
    githubRepo: ctx("githubRepo"),
    githubRepoIds: ctx("githubRepoIds"),
    githubOidcProviderArn: ctx("githubOidcProviderArn"),
    instanceType: ctx("instanceType"),
    alertEmail: ctx("alertEmail"),
    tags: { project: "vendorstreet" },
  });
} else {
  new VendorStreetStack(app, "VendorStreet", {
    env,
    domainName,
    hostedZoneId,
    githubRepo: ctx("githubRepo"),
    githubRepoIds: ctx("githubRepoIds"),
    githubOidcProviderArn: ctx("githubOidcProviderArn"),
    llmProvider: ctx("llmProvider") === "anthropic" ? "anthropic" : "none",
    secrets: {
      mongoUrl: "/vendorstreet/MONGO_URL",
      ...(ctx("twilio") === "true" ? { twilioAuthToken: "/vendorstreet/TWILIO_AUTH_TOKEN" } : {}),
      ...(ctx("llmProvider") === "anthropic" ? { anthropicApiKey: "/vendorstreet/ANTHROPIC_API_KEY" } : {}),
      ...(ctx("underwriters") === "true" ? { underwriters: "/vendorstreet/UNDERWRITERS" } : {}),
    },
    tags: { project: "vendorstreet" },
  });
}
