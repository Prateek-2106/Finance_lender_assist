import type { Repos } from "../repos/types";

/** Deletes demo businesses past their expiry, with everything they own. Returns how many went. */
export async function purgeExpiredDemos(repos: Repos, now = new Date()): Promise<number> {
  let purged = 0;
  for (;;) {
    const batch = await repos.tenants.listExpiredDemos(now, { limit: 50 });
    if (!batch.length) return purged;
    for (const t of batch) await repos.purgeTenant(t.id);
    purged += batch.length;
  }
}

/** Runs the cleanup now and then every few hours. One server, so no locking needed; with more, run it as a job. */
export function scheduleDemoCleanup(repos: Repos, everyMs = 6 * 3_600_000) {
  const run = () =>
    purgeExpiredDemos(repos).then(
      (n) => n && console.log(`[demo] removed ${n} expired demo business${n === 1 ? "" : "es"}`),
      (e) => console.warn(`[demo] cleanup failed: ${(e as Error).message}`),
    );
  void run();
  return setInterval(run, everyMs).unref();
}
