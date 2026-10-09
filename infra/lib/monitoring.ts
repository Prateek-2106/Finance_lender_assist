// Watching the live site: one CloudWatch dashboard, alarms that email you, and an outside uptime check.
//
// The app's own metrics (requests, errors, latency, AI calls and cost, emails) come from log lines in
// CloudWatch's Embedded Metric Format (src/telemetry/metrics.ts): 11 custom metrics (10 are free,
// the 11th about $0.30/month). 8 alarms (10 free), 1 dashboard (3 free), 1 Route 53 health check (about $0.75/month).
import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import type * as ec2 from "aws-cdk-lib/aws-ec2";
import type * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import { Construct } from "constructs";

/** Must match src/telemetry/metrics.ts. */
export const APP_NAMESPACE = "VendorStreet";
export const APP_DIMENSIONS = { Service: "web" };
export const DASHBOARD_NAME = "VendorStreet";

export interface MonitoringProps {
  domainName: string;
  instance: ec2.Instance;
  distribution: cloudfront.Distribution;
  logGroup: logs.ILogGroup;
  /** Where alarms are emailed. AWS sends a confirmation link first; alarms reach you after you click it. */
  alertEmail?: string;
  /** Alarm when the AI costs more than this in one hour (dollars). */
  aiDollarsPerHour?: number;
}

export class Monitoring extends Construct {
  readonly topic: sns.Topic;
  readonly alarms: cw.Alarm[] = [];
  readonly dashboard: cw.Dashboard;

  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);
    const stack = cdk.Stack.of(this);
    const { instance, distribution, logGroup, domainName } = props;
    const five = cdk.Duration.minutes(5);

    this.topic = new sns.Topic(this, "Alerts", { displayName: "Vendor Street alerts" });
    if (props.alertEmail) this.topic.addSubscription(new subs.EmailSubscription(props.alertEmail));
    const notify = new actions.SnsAction(this.topic);

    const app = (metricName: string, statistic: string, period = five, label?: string) =>
      new cw.Metric({ namespace: APP_NAMESPACE, metricName, dimensionsMap: APP_DIMENSIONS, statistic, period, ...(label ? { label } : {}) });
    const ec2Metric = (metricName: string, statistic: string, period = five) =>
      new cw.Metric({ namespace: "AWS/EC2", metricName, dimensionsMap: { InstanceId: instance.instanceId }, statistic, period });
    const cdn = (metricName: string, statistic: string) =>
      new cw.Metric({ namespace: "AWS/CloudFront", metricName, dimensionsMap: { DistributionId: distribution.distributionId, Region: "Global" }, statistic, period: five });

    // ── outside-in: is the site answering at all? (Catches a dead container, which reports nothing itself.)
    const health = new route53.CfnHealthCheck(this, "Uptime", {
      healthCheckConfig: {
        type: "HTTPS",
        fullyQualifiedDomainName: domainName,
        resourcePath: "/health",
        port: 443,
        requestInterval: 30,
        failureThreshold: 3,
        enableSni: true,
      },
      healthCheckTags: [{ key: "Name", value: `${domainName} /health` }],
    });
    const up = new cw.Metric({ namespace: "AWS/Route53", metricName: "HealthCheckStatus", dimensionsMap: { HealthCheckId: health.attrHealthCheckId }, statistic: "Minimum", period: cdk.Duration.minutes(1), label: "Up (1) / down (0)" });

    const alarm = (id: string, description: string, opts: Omit<cw.AlarmProps, "alarmDescription" | "alarmName">, extra: cw.IAlarmAction[] = []) => {
      const a = new cw.Alarm(this, id, { alarmName: `vendorstreet-${id.replace(/[A-Z]/g, (c, i) => (i ? "-" : "") + c.toLowerCase())}`, alarmDescription: description, treatMissingData: cw.TreatMissingData.NOT_BREACHING, ...opts });
      a.addAlarmAction(notify, ...extra);
      a.addOkAction(notify);
      this.alarms.push(a);
      return a;
    };

    alarm("SiteDown", `${domainName}/health has failed from Route 53's checkers for 2 minutes.`, {
      metric: up, threshold: 1, comparisonOperator: cw.ComparisonOperator.LESS_THAN_THRESHOLD, evaluationPeriods: 2, treatMissingData: cw.TreatMissingData.BREACHING,
    });
    alarm("ServerErrors", "5 or more server errors (HTTP 5xx) in 5 minutes. Check the error log on the dashboard.", {
      metric: app("ServerErrors", "Sum"), threshold: 5, comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD, evaluationPeriods: 1,
    });
    alarm("SlowPages", "p95 response time over 1.5 s for 15 minutes (AI drafts excluded).", {
      metric: app("Latency", "p95"), threshold: 1500, comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD, evaluationPeriods: 3,
    });
    alarm("AiFailures", "3 or more failed calls to the language model in 15 minutes.", {
      metric: app("AiFailures", "Sum", cdk.Duration.minutes(15)), threshold: 3, comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD, evaluationPeriods: 1,
    });
    alarm("AiSpend", `AI spend over $${props.aiDollarsPerHour ?? 1} in an hour. The daily call cap still applies; this is the early warning.`, {
      metric: app("AiCostUsd", "Sum", cdk.Duration.hours(1)), threshold: props.aiDollarsPerHour ?? 1, comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD, evaluationPeriods: 1,
    });
    alarm("EmailsFailing", "3 or more emails failed to send in an hour (codes, invoices, receipts).", {
      metric: app("EmailsFailed", "Sum", cdk.Duration.hours(1)), threshold: 3, comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD, evaluationPeriods: 1,
    });
    // AWS-side hardware or network trouble: move the instance to healthy hardware (same IP, same disk).
    alarm("InstanceHardware", "EC2 system status check failing: AWS is recovering the instance onto new hardware.", {
      metric: ec2Metric("StatusCheckFailed_System", "Maximum", cdk.Duration.minutes(1)), threshold: 1, comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD, evaluationPeriods: 2,
    }, [new actions.Ec2Action(actions.Ec2InstanceAction.RECOVER)]);
    // The operating system stopped responding: reboot it (Docker restarts the app on boot).
    alarm("InstanceStuck", "EC2 instance status check failing for 3 minutes: rebooting it.", {
      metric: ec2Metric("StatusCheckFailed_Instance", "Maximum", cdk.Duration.minutes(1)), threshold: 1, comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD, evaluationPeriods: 3,
    }, [new actions.Ec2Action(actions.Ec2InstanceAction.REBOOT)]);

    // ── the dashboard
    const graph = (title: string, left: cw.IMetric[], opts: Partial<cw.GraphWidgetProps> = {}) => new cw.GraphWidget({ title, left, width: 8, height: 6, ...opts });
    const logsUrl = `https://${stack.region}.console.aws.amazon.com/cloudwatch/home?region=${stack.region}#logsV2:log-groups/log-group/${encodeURIComponent(encodeURIComponent(logGroup.logGroupName))}`;
    this.dashboard = new cw.Dashboard(this, "Dashboard", {
      dashboardName: DASHBOARD_NAME,
      defaultInterval: cdk.Duration.days(1),
      widgets: [
        [
          new cw.TextWidget({
            width: 8,
            height: 4,
            markdown: [
              `# Vendor Street`,
              `[${domainName}](https://${domainName}) · [Platform numbers](https://${domainName}/admin) · [All logs](${logsUrl})`,
              ``,
              `App metrics are log lines (EMF), written once a minute. AI drafts are left out of page latency.`,
            ].join("\n"),
          }),
          new cw.AlarmStatusWidget({ title: "Alarms", alarms: this.alarms, width: 16, height: 4 }),
        ],
        [
          graph("Requests and errors", [app("Requests", "Sum", five, "Requests")], {
            right: [app("ClientErrors", "Sum", five, "4xx"), app("ServerErrors", "Sum", five, "5xx")],
            rightYAxis: { min: 0, label: "errors" },
            leftYAxis: { min: 0 },
          }),
          graph("Page response time (ms)", [app("Latency", "p50", five, "p50"), app("Latency", "p95", five, "p95"), app("Latency", "p99", five, "p99")], {
            leftYAxis: { min: 0 },
            leftAnnotations: [{ value: 1500, label: "alarm (p95)", color: "#b3261e" }],
          }),
          graph("Uptime (Route 53, every 30 s)", [up], { leftYAxis: { min: 0, max: 1 } }),
        ],
        [
          graph("AI calls", [app("AiCalls", "Sum", five, "calls"), app("AiFailures", "Sum", five, "failures")], { leftYAxis: { min: 0 } }),
          graph("AI spend per hour ($)", [app("AiCostUsd", "Sum", cdk.Duration.hours(1), "$ per hour")], {
            leftYAxis: { min: 0 },
            leftAnnotations: [{ value: props.aiDollarsPerHour ?? 1, label: "alarm", color: "#b3261e" }],
            view: cw.GraphWidgetView.BAR,
          }),
          graph("AI response time (ms)", [app("AiLatency", "p50", five, "p50"), app("AiLatency", "p95", five, "p95")], { leftYAxis: { min: 0 } }),
        ],
        [
          graph("Database time per request (ms)", [app("DbTime", "p50", five, "p50"), app("DbTime", "p95", five, "p95")], { leftYAxis: { min: 0 }, width: 6 }),
          graph("Emails", [app("EmailsSent", "Sum", five, "sent"), app("EmailsFailed", "Sum", five, "failed")], { leftYAxis: { min: 0 }, width: 6 }),
          graph("Server CPU (%) and burst credits", [ec2Metric("CPUUtilization", "Average")], {
            width: 6,
            right: [ec2Metric("CPUCreditBalance", "Average")],
            leftYAxis: { min: 0, max: 100 },
            rightYAxis: { min: 0, label: "credits" },
          }),
          graph("CloudFront", [cdn("Requests", "Sum")], { right: [cdn("5xxErrorRate", "Average")], rightYAxis: { min: 0, label: "5xx %" }, width: 6 }),
        ],
        [
          new cw.LogQueryWidget({
            title: "Recent errors and warnings",
            logGroupNames: [logGroup.logGroupName],
            width: 24,
            height: 7,
            view: cw.LogQueryVisualizationType.TABLE,
            queryLines: [
              "fields @timestamp, @message",
              'filter @message not like /"_aws"/',
              "filter @message like /(?i)(error|fail|warn|exception)/",
              "sort @timestamp desc",
              "limit 50",
            ],
          }),
        ],
      ],
    });

    new cdk.CfnOutput(stack, "Dashboard", { value: `https://${stack.region}.console.aws.amazon.com/cloudwatch/home?region=${stack.region}#dashboards/dashboard/${DASHBOARD_NAME}` });
    new cdk.CfnOutput(stack, "AlertsTopic", { value: this.topic.topicArn });
  }
}
