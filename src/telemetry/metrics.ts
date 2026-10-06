// Operational metrics, published to CloudWatch for free-ish.
//
// The container's stdout already goes to CloudWatch Logs (Docker's awslogs driver). A log line in
// CloudWatch's Embedded Metric Format (EMF) becomes metrics automatically: no SDK, no PutMetricData
// calls, no extra IAM. Counts are added up in memory and written once a minute, so a busy minute is
// still one log line.
//
// Every metric shares one dimension (Service=web), so each name is exactly one custom metric. The
// list stays at 10, which is CloudWatch's free tier.

export const NAMESPACE = "VendorStreet";
export const DIMENSIONS = { Service: "web" } as const;

export const COUNTERS = {
  Requests: "Count",
  ClientErrors: "Count", // 4xx
  ServerErrors: "Count", // 5xx
  AiCalls: "Count",
  AiFailures: "Count",
  AiCostUsd: "None", // dollars, from the token counts the model reports
  EmailsSent: "Count",
  EmailsFailed: "Count",
} as const;
export const TIMINGS = {
  Latency: "Milliseconds", // every request except AI ones, which are slow by design
  AiLatency: "Milliseconds",
} as const;
export type Counter = keyof typeof COUNTERS;
export type Timing = keyof typeof TIMINGS;

export interface Metrics {
  count(name: Counter, n?: number): void;
  time(name: Timing, ms: number): void;
  /** Writes whatever has been collected (also runs on a timer and at shutdown). */
  flush(): void;
}

export const noMetrics: Metrics = { count() {}, time() {}, flush() {} };

/** CloudWatch allows at most 100 values per metric in one EMF record. */
const MAX_VALUES = 100;

/**
 * Collects metrics and writes them as EMF JSON lines through `write` (stdout in production).
 * Timings keep every value, split across records of 100, so CloudWatch's p95/p99 are exact.
 */
export function emfMetrics(opts: { write?: (line: string) => void; now?: () => number } = {}): Metrics {
  const write = opts.write ?? ((line) => process.stdout.write(line + "\n"));
  const now = opts.now ?? Date.now;
  let counts = new Map<Counter, number>();
  let timings = new Map<Timing, number[]>();

  const record = (values: Record<string, number | number[]>) => {
    const names = Object.keys(values);
    if (!names.length) return;
    const units: Record<string, string> = { ...COUNTERS, ...TIMINGS };
    write(
      JSON.stringify({
        _aws: {
          Timestamp: now(),
          CloudWatchMetrics: [{ Namespace: NAMESPACE, Dimensions: [Object.keys(DIMENSIONS)], Metrics: names.map((Name) => ({ Name, Unit: units[Name] })) }],
        },
        ...DIMENSIONS,
        ...values,
      }),
    );
  };

  return {
    count(name, n = 1) {
      if (n) counts.set(name, (counts.get(name) ?? 0) + n);
    },
    time(name, ms) {
      const list = timings.get(name) ?? [];
      list.push(Math.round(ms));
      timings.set(name, list);
    },
    flush() {
      const c = counts;
      const t = timings;
      counts = new Map();
      timings = new Map();
      // Counts and the first 100 timings in one record; any further timings in follow-up records.
      for (let i = 0; ; i++) {
        const values: Record<string, number | number[]> = {};
        if (i === 0) for (const [k, v] of c) values[k] = Math.round(v * 1e6) / 1e6;
        for (const [k, v] of t) {
          const chunk = v.slice(i * MAX_VALUES, (i + 1) * MAX_VALUES);
          if (chunk.length) values[k] = chunk;
        }
        if (!Object.keys(values).length) break;
        record(values);
      }
    },
  };
}

/** Flushes every `ms` and once more when the process is told to stop (deploys send SIGTERM). */
export function flushPeriodically(metrics: Metrics, ms = 60_000) {
  const timer = setInterval(() => metrics.flush(), ms);
  timer.unref();
  const stop = () => {
    metrics.flush();
    clearInterval(timer);
  };
  process.once("SIGTERM", () => {
    stop();
    process.exit(0);
  });
  process.once("beforeExit", stop);
  return stop;
}

/** For tests: totals you can assert on. */
export function memoryMetrics() {
  const counts: Partial<Record<Counter, number>> = {};
  const timings: Partial<Record<Timing, number[]>> = {};
  const m: Metrics = {
    count(name, n = 1) {
      counts[name] = (counts[name] ?? 0) + n;
    },
    time(name, ms) {
      (timings[name] ??= []).push(ms);
    },
    flush() {},
  };
  return Object.assign(m, { counts, timings });
}
