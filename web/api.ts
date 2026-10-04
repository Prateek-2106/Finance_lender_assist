// Thin fetch wrapper. Same origin, so the Host header tells the API which tenant this is.
function keyStore(name: string) {
  return {
    get: () => sessionStorage.getItem(name),
    set: (k: string) => sessionStorage.setItem(name, k),
    clear: () => sessionStorage.removeItem(name),
  };
}
/** The business owner's key, for this business's address. */
export const session = keyStore("mainstreet.apiKey");
/** An underwriter's key, for the platform-wide console. Kept separately on purpose. */
export const uwSession = keyStore("mainstreet.underwriterKey");

/**
 * "#key=sk_…" in the address (the "Try it" button, the demo underwriter link): keep the key for
 * this tab and take it out of the address bar, so it isn't bookmarked, shared or left in history.
 */
export function takeKeyFromHash(store: ReturnType<typeof keyStore>, next = "#/") {
  const m = /^#key=([\w-]+)/.exec(location.hash);
  if (!m) return;
  store.set(m[1]!);
  history.replaceState(null, "", `${location.pathname}${location.search}${next}`);
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly issues?: { path?: string; line?: number; message: string }[]) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown; text?: string; as?: "owner" | "underwriter" } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const key = init.as === "underwriter" ? uwSession.get() : session.get();
  if (key) headers.set("authorization", `Bearer ${key}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  } else if (init.text !== undefined) {
    headers.set("content-type", "text/csv");
    body = init.text;
  }
  const res = await fetch(`/api${path}`, { ...init, headers, body });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; issues?: ApiError["issues"] };
    throw new ApiError(err.error ?? `Request failed (${res.status})`, res.status, err.issues);
  }
  return (res.headers.get("content-type") ?? "").includes("json") ? ((await res.json()) as T) : (undefined as T);
}

/** Opens an authenticated PDF in a new tab (a plain link can't send the API key). */
export async function openPdf(path: string) {
  const res = await fetch(`/api${path}`, { headers: { authorization: `Bearer ${session.get()}` } });
  if (!res.ok) throw new ApiError("Could not load the PDF", res.status);
  window.open(URL.createObjectURL(await res.blob()), "_blank");
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const money = (cents: number) => usd.format(cents / 100);
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
/** Whole dollars, for funding amounts where cents are noise. */
export const dollars = (cents: number) => usd0.format(Math.round(cents / 100));
export const pct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(digits)}%`);
export const day = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
