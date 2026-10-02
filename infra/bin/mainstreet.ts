import * as cdk from "aws-cdk-lib";
import { MainstreetStack } from "../lib/mainstreet-stack.js";

const app = new cdk.App();
const ctx = (k: string) => app.node.tryGetContext(k) as string | undefined;
const domainName = ctx("domainName");
const hostedZoneId = ctx("hostedZoneId");
if (!domainName || !hostedZoneId) throw new Error("Set domainName and hostedZoneId in infra/cdk.json (see README: Deploy to AWS)");

new MainstreetStack(app, "Mainstreet", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "us-east-1" },
  domainName,
  hostedZoneId,
  githubRepo: ctx("githubRepo"),
  githubOidcProviderArn: ctx("githubOidcProviderArn"),
  llmProvider: ctx("llmProvider") === "anthropic" ? "anthropic" : "none",
  secrets: {
    mongoUrl: "/mainstreet/MONGO_URL",
    ...(ctx("twilio") === "true" ? { twilioAuthToken: "/mainstreet/TWILIO_AUTH_TOKEN" } : {}),
    ...(ctx("llmProvider") === "anthropic" ? { anthropicApiKey: "/mainstreet/ANTHROPIC_API_KEY" } : {}),
  },
  tags: { project: "mainstreet" },
});
