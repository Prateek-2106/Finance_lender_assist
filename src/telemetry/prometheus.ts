// The same timings in Prometheus format at GET /metrics, so Prometheus/Grafana (or a Kubernetes
// cluster's monitoring) can scrape this server. Off unless METRICS_TOKEN is set; the scraper sends
// it as a bearer token.
import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";
import type { Kind } from "./health";

const BUCKETS = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

export class Prometheus {
  readonly registry = new Registry();
  private readonly seconds = {
    route: new Histogram({ name: "http_request_duration_seconds", help: "Time to answer a request, by route", labelNames: ["route"], buckets: BUCKETS, registers: [this.registry] }),
    db: new Histogram({ name: "db_operation_duration_seconds", help: "Time for one database operation", labelNames: ["operation"], buckets: BUCKETS, registers: [this.registry] }),
    external: new Histogram({ name: "external_call_duration_seconds", help: "Time for a call to another service (AI, email, DNS, database ping)", labelNames: ["target"], buckets: BUCKETS, registers: [this.registry] }),
  };
  private readonly failures = new Counter({ name: "operation_failures_total", help: "Requests answered 5xx, and failed database or outside calls", labelNames: ["kind", "name"], registers: [this.registry] });

  constructor(opts: { defaults?: boolean } = {}) {
    this.registry.setDefaultLabels({ service: "vendorstreet" });
    if (opts.defaults !== false) collectDefaultMetrics({ register: this.registry }); // CPU, memory, event loop, GC
  }

  observe(kind: Kind, name: string, ms: number, ok: boolean) {
    const label = kind === "route" ? "route" : kind === "db" ? "operation" : "target";
    (this.seconds[kind] as Histogram<string>).observe({ [label]: name }, ms / 1000);
    if (!ok) this.failures.inc({ kind, name });
  }

  text() {
    return this.registry.metrics();
  }
  get contentType() {
    return this.registry.contentType;
  }
}
