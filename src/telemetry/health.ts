// Live health of this server: how long every route, database operation and outside call takes,
// kept in memory for the last hour, minute by minute. The /admin "System health" page reads it.
//
// Long-term history lives in CloudWatch (metrics.ts); this is the close-up view: per route, per
// database operation, with the share of each request spent waiting on the database.
import { AsyncLocalStorage } from "node:async_hooks";
import { monitorEventLoopDelay } from "node:perf_hooks";
type IntervalHistogram = ReturnType<typeof monitorEventLoopDelay>;
import type { Prometheus } from "./prometheus";

export type Kind = "route" | "db" | "external";

/** Per-request tally of database work, so each route can say how much of its time was the database. */
interface RequestScope {
  dbMs: number;
  dbCalls: number;
}
const scope = new AsyncLocalStorage<RequestScope>();
export const inRequestScope = <T>(fn: () => T) => scope.run({ dbMs: 0, dbCalls: 0 }, fn);
export const currentScope = () => scope.getStore();

/** Keep at most this many timings per key per minute (a uniform random sample beyond that). */
const RESERVOIR = 500;
const MINUTES = 60;

interface Cell {
  count: number;
  errors: number;
  sumMs: number;
  maxMs: number;
  values: number[]; // a sample, for percentiles
  dbMs: number; // routes only: time spent in the database
  dbCalls: number;
}
interface Vitals {
  cpuPercent: number;
  heapUsedMb: number;
  rssMb: number;
  loopP99Ms: number;
  loopMeanMs: number;
}
interface Minute {
  t: number; // minute start, epoch ms
  cells: Map<string, Cell>; // "kind|key"
  vitals?: Vitals;
}

export interface Stat {
  key: string;
  count: number;
  errors: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  avg: number;
  avgDbMs?: number;
  dbCallsPerRequest?: number;
  dbShare?: number; // 0..1 of the route's time spent in the database
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]! : 0);
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export class Health {
  private minutes: Minute[] = [];
  private loop?: IntervalHistogram;
  private cpu = process.cpuUsage();
  private cpuAt = Date.now();
  private timer?: NodeJS.Timeout;
  readonly startedAt = new Date();

  constructor(
    private readonly now: () => number = Date.now,
    readonly prometheus?: Prometheus,
  ) {}

  private minute(): Minute {
    const t = Math.floor(this.now() / 60_000) * 60_000;
    let m = this.minutes.at(-1);
    if (!m || m.t !== t) {
      m = { t, cells: new Map() };
      this.minutes.push(m);
      while (this.minutes.length && this.minutes[0]!.t <= t - MINUTES * 60_000) this.minutes.shift();
    }
    return m;
  }

  record(kind: Kind, key: string, ms: number, ok = true, db?: { ms: number; calls: number }) {
    const cells = this.minute().cells;
    const id = `${kind}|${key}`;
    let c = cells.get(id);
    if (!c) cells.set(id, (c = { count: 0, errors: 0, sumMs: 0, maxMs: 0, values: [], dbMs: 0, dbCalls: 0 }));
    c.count++;
    if (!ok) c.errors++;
    c.sumMs += ms;
    c.maxMs = Math.max(c.maxMs, ms);
    if (c.values.length < RESERVOIR) c.values.push(ms);
    else {
      const j = Math.floor(Math.random() * c.count);
      if (j < RESERVOIR) c.values[j] = ms;
    }
    if (db) {
      c.dbMs += db.ms;
      c.dbCalls += db.calls;
    }
    this.prometheus?.observe(kind, key, ms, ok);
  }

  /** Times a promise as `kind`/`key`; database work also counts toward the current request. */
  async time<T>(kind: Kind, key: string, fn: () => Promise<T>): Promise<T> {
    const started = performance.now();
    let ok = true;
    try {
      return await fn();
    } catch (e) {
      ok = false;
      throw e;
    } finally {
      const ms = performance.now() - started;
      this.record(kind, key, ms, ok);
      const s = kind === "db" ? currentScope() : undefined;
      if (s) {
        s.dbMs += ms;
        s.dbCalls++;
      }
    }
  }

  /** Server vitals once a minute: CPU, memory and event-loop delay (how long work waits to run). */
  startVitals(everyMs = 60_000) {
    if (this.timer) return;
    this.loop = monitorEventLoopDelay({ resolution: 20 });
    this.loop.enable();
    this.timer = setInterval(() => this.sampleVitals(), everyMs);
    this.timer.unref();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.loop?.disable();
  }

  sampleVitals(): Vitals {
    const usage = process.cpuUsage(this.cpu);
    const wall = Math.max(1, Date.now() - this.cpuAt);
    this.cpu = process.cpuUsage();
    this.cpuAt = Date.now();
    const mem = process.memoryUsage();
    const v: Vitals = {
      cpuPercent: round(((usage.user + usage.system) / 1000 / wall) * 100),
      heapUsedMb: round(mem.heapUsed / 1048576),
      rssMb: round(mem.rss / 1048576),
      loopP99Ms: this.loop ? round(this.loop.percentile(99) / 1e6) : 0,
      loopMeanMs: this.loop ? round(this.loop.mean / 1e6) : 0,
    };
    this.loop?.reset();
    this.minute().vitals = v;
    return v;
  }

  /** The process right now: memory, uptime, and the last minute's vitals. */
  current() {
    const mem = process.memoryUsage();
    const last = [...this.minutes].reverse().find((m) => m.vitals)?.vitals;
    return {
      startedAt: this.startedAt,
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      heapUsedMb: round(mem.heapUsed / 1048576),
      rssMb: round(mem.rss / 1048576),
      ...(last ? { cpuPercent: last.cpuPercent, loopP99Ms: last.loopP99Ms, loopMeanMs: last.loopMeanMs } : {}),
      vitalsOn: !!this.timer,
    };
  }

  /** Everything recorded in the last `minutes`, summarised. */
  snapshot(minutes = 15) {
    const since = Math.floor(this.now() / 60_000) * 60_000 - (minutes - 1) * 60_000;
    const window = this.minutes.filter((m) => m.t >= since);
    const merged = new Map<string, Cell>();
    for (const m of window)
      for (const [id, c] of m.cells) {
        const into = merged.get(id) ?? { count: 0, errors: 0, sumMs: 0, maxMs: 0, values: [], dbMs: 0, dbCalls: 0 };
        into.count += c.count;
        into.errors += c.errors;
        into.sumMs += c.sumMs;
        into.maxMs = Math.max(into.maxMs, c.maxMs);
        into.values.push(...c.values);
        into.dbMs += c.dbMs;
        into.dbCalls += c.dbCalls;
        merged.set(id, into);
      }
    const stats = (kind: Kind): Stat[] =>
      [...merged.entries()]
        .filter(([id]) => id.startsWith(`${kind}|`))
        .map(([id, c]) => {
          const sorted = [...c.values].sort((a, b) => a - b);
          return {
            key: id.slice(kind.length + 1),
            count: c.count,
            errors: c.errors,
            p50: round(pct(sorted, 0.5)),
            p95: round(pct(sorted, 0.95)),
            p99: round(pct(sorted, 0.99)),
            max: round(c.maxMs),
            avg: round(c.sumMs / c.count),
            ...(kind === "route"
              ? { avgDbMs: round(c.dbMs / c.count), dbCallsPerRequest: round(c.dbCalls / c.count), dbShare: c.sumMs ? round(Math.min(1, c.dbMs / c.sumMs), 2) : 0 }
              : {}),
          };
        })
        .sort((a, b) => b.count * b.avg - a.count * a.avg); // what costs the most time first

    // One point per minute, gaps filled with zeros, for the charts
    const series = Array.from({ length: minutes }, (_, i) => {
      const t = since + i * 60_000;
      const m = window.find((x) => x.t === t);
      const pick = (kind: Kind) => [...(m?.cells.entries() ?? [])].filter(([id]) => id.startsWith(`${kind}|`)).map(([, c]) => c);
      const routes = pick("route");
      const db = pick("db");
      const all = routes.flatMap((c) => c.values).sort((a, b) => a - b);
      const dbAll = db.flatMap((c) => c.values).sort((a, b) => a - b);
      return {
        t: new Date(t).toISOString(),
        requests: routes.reduce((a, c) => a + c.count, 0),
        errors: routes.reduce((a, c) => a + c.errors, 0),
        p95: round(pct(all, 0.95)),
        dbP95: round(pct(dbAll, 0.95)),
        dbCalls: db.reduce((a, c) => a + c.count, 0),
        ...(m?.vitals ? { vitals: m.vitals } : {}),
      };
    });

    const routes = stats("route");
    const db = stats("db");
    const allRoutes = [...merged.entries()].filter(([id]) => id.startsWith("route|")).flatMap(([, c]) => c.values).sort((a, b) => a - b);
    const allDb = [...merged.entries()].filter(([id]) => id.startsWith("db|")).flatMap(([, c]) => c.values).sort((a, b) => a - b);
    const requests = routes.reduce((a, r) => a + r.count, 0);
    const errors = routes.reduce((a, r) => a + r.errors, 0);
    return {
      minutes,
      totals: {
        requests,
        requestsPerMinute: round(requests / minutes),
        errors,
        errorRate: requests ? round(errors / requests, 4) : 0,
        p50: round(pct(allRoutes, 0.5)),
        p95: round(pct(allRoutes, 0.95)),
        p99: round(pct(allRoutes, 0.99)),
        dbP95: round(pct(allDb, 0.95)),
        dbCalls: db.reduce((a, d) => a + d.count, 0),
      },
      routes,
      db,
      external: stats("external"),
      series,
    };
  }
}

/** Wraps every repository method so each database call is timed as "repo.method" (e.g. "leads.listByTenant"). */
export function instrumentRepos<R extends object>(repos: R, health: Health): R {
  const wrapGroup = (group: object, name: string) =>
    new Proxy(group, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (typeof v !== "function" || typeof prop !== "string") return v;
        return (...args: unknown[]) => health.time("db", `${name}.${prop}`, () => Promise.resolve(v.apply(target, args)));
      },
    });
  return new Proxy(repos, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || prop === "ping") return v; // pings are timed as an outside call instead
      if (typeof v === "function") return (...args: unknown[]) => health.time("db", prop, () => Promise.resolve(v.apply(target, args)));
      if (v && typeof v === "object") return wrapGroup(v, prop);
      return v;
    },
  });
}
