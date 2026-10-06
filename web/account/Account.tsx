// Accounts: sign in by email, the page the link opens, and "your businesses".
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { ErrorText } from "../ui/bits";

type Business = { id: string; name: string; subdomain: string; role: string; dashboardUrl: string; siteUrl: string };
type Me = { user: { id: string; email: string; name: string | null }; businesses: Business[]; limits: { businesses: number } };

/** The platform's own address (where sign-in lives), from any business subdomain. */
export async function apexUrl() {
  const { platform } = await api<{ platform: { baseDomain: string } }>("/platform");
  const base = platform.baseDomain === "localhost" ? "lvh.me" : platform.baseDomain;
  return `${location.protocol}//${base}${location.port ? `:${location.port}` : ""}`;
}

function Frame({ children, title }: { children: React.ReactNode; title: string }) {
  useEffect(() => {
    document.title = `${title} · Vendor Street`;
  }, [title]);
  return (
    <div className="site auth">
      <header>
        <p className="eyebrow"><a href="/">Vendor Street</a></p>
        <h1>{title}</h1>
      </header>
      {children}
    </div>
  );
}

export function SignInPage() {
  const next = new URLSearchParams(location.search).get("next") ?? undefined;
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/start", { method: "POST", json: { email, ...(next ? { next } : {}) } });
      setSentTo(email);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  if (sentTo)
    return (
      <Frame title="Check your email">
        <p role="status">
          We sent a sign-in link to <strong>{sentTo}</strong>. It works once and expires in 15 minutes.
        </p>
        <p className="quiet small">Nothing there? Check spam, or <button className="linkish" onClick={() => setSentTo(null)}>send another</button>.</p>
      </Frame>
    );
  return (
    <Frame title="Sign in">
      <p className="quiet">No password: we email you a link. New here? The same link creates your account.</p>
      <form className="stack" onSubmit={submit} aria-label="Sign in">
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" autoFocus placeholder="you@yourbusiness.com" />
        </label>
        <ErrorText error={error} />
        <div>
          <button disabled={busy}>{busy ? "Sending…" : "Email me a link"}</button>
        </div>
      </form>
      <p className="small quiet">Just looking? <a href="/">Try a demo business</a> instead; no account needed.</p>
    </Frame>
  );
}

let verifyStarted = false; // the token works once: never post it twice (React may run effects twice in development)

/** Opened from the email. The token is in the #fragment, so it never reaches a server log; we post it once. */
export function VerifyPage() {
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (verifyStarted) return;
    verifyStarted = true;
    const params = new URLSearchParams(location.hash.slice(1));
    const token = params.get("token");
    const next = params.get("next");
    history.replaceState(null, "", location.pathname); // don't leave the token in the address bar or history
    if (!token) return setError(new ApiError("This link is incomplete. Ask for a new one.", 400));
    api("/auth/verify", { method: "POST", json: { token } }).then(
      () => location.replace(next ?? "/account"),
      setError,
    );
  }, []);
  return (
    <Frame title={error ? "That link didn't work" : "Signing you in…"}>
      {error ? (
        <>
          <ErrorText error={error} />
          <p><a className="button" href="/signin">Send a new link</a></p>
        </>
      ) : (
        <p className="quiet" role="status">One moment.</p>
      )}
    </Frame>
  );
}

export function AccountPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<{ business: Business; apiKey: string } | null>(null);
  const load = () =>
    api<Me>("/auth/me").then(setMe, (err) => {
      if (err instanceof ApiError && err.status === 401) location.replace("/signin?next=/account");
      else setError(err);
    });
  useEffect(() => void load(), []);

  async function signOut() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    location.replace("/");
  }

  if (!me) return <Frame title="Your account"><ErrorText error={error} /></Frame>;
  const canCreate = me.businesses.filter((b) => b.role === "owner").length < me.limits.businesses;
  return (
    <Frame title="Your businesses">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="quiet">Signed in as <strong style={{ color: "var(--ink)" }}>{me.user.email}</strong></p>
        <button className="secondary small" onClick={signOut}>Sign out</button>
      </div>

      {created && (
        <div className="panel" role="status">
          <h2 style={{ fontSize: "var(--step-1)" }}>{created.business.name} is ready</h2>
          <p>
            Your website is live at <a href={created.business.siteUrl}>{created.business.siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>.
            Open the dashboard to add your price list; you're already signed in there.
          </p>
          <details>
            <summary className="small">API key for integrations (shown once)</summary>
            <p className="small" style={{ marginTop: "0.5rem" }}>You don't need this to sign in. Keep it secret: it gives full access to this business.</p>
            <code className="key">{created.apiKey}</code>
          </details>
          <div><a className="button" href={created.business.dashboardUrl}>Open the dashboard</a></div>
        </div>
      )}

      {me.businesses.length > 0 ? (
        <table data-testid="businesses">
          <thead><tr><th>Business</th><th>Role</th><th /></tr></thead>
          <tbody>
            {me.businesses.map((b) => (
              <tr key={b.id}>
                <td>{b.name}<div className="quiet small">{b.siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}</div></td>
                <td className="small">{b.role === "owner" ? "Owner" : "Staff"}</td>
                <td className="num"><a className="button secondary small" href={b.dashboardUrl}>Open dashboard</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        !created && <p className="empty">No businesses yet. Create one below; it takes a few seconds.</p>
      )}

      {canCreate ? <CreateBusiness email={me.user.email} onCreated={(c) => { setCreated(c); void load(); }} /> : <p className="quiet small">You own the maximum of {me.limits.businesses} businesses.</p>}
    </Frame>
  );
}

const slug = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);

function CreateBusiness({ email, onCreated }: { email: string; onCreated: (c: { business: Business; apiKey: string }) => void }) {
  const [name, setName] = useState("");
  const [sub, setSub] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [base, setBase] = useState("");
  useEffect(() => {
    apexUrl().then((u) => setBase(new URL(u).host), () => {});
  }, []);
  const subdomain = touched ? sub : slug(name);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const taxPct = Number(f.get("tax") || 0);
      const r = await api<{ business: Business; apiKey: string }>("/auth/businesses", {
        method: "POST",
        json: { name, subdomain, ownerEmail: String(f.get("ownerEmail") || email), taxRateBps: Math.round(taxPct * 100) },
      });
      onCreated(r);
      setName("");
      setSub("");
      setTouched(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel" onSubmit={submit} aria-label="Create a business">
      <h2 style={{ fontSize: "var(--step-1)" }}>Create a business</h2>
      <label>
        Business name
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={100} placeholder="Joe's Plumbing" />
      </label>
      <label>
        Web address
        <span className="addr">
          <input value={subdomain} onChange={(e) => { setTouched(true); setSub(e.target.value.toLowerCase()); }} required pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?" aria-describedby="addr-help" />
          <span className="quiet">.{base}</span>
        </span>
        <span id="addr-help" className="small quiet">Letters, numbers and hyphens. You can connect your own domain later.</span>
      </label>
      <div className="row" style={{ alignItems: "stretch" }}>
        <label style={{ flex: 2 }}>
          Send notifications to
          <input name="ownerEmail" type="email" defaultValue={email} />
        </label>
        <label style={{ flex: 1 }}>
          Sales tax %
          <input name="tax" type="number" min={0} max={20} step={0.01} defaultValue={0} />
        </label>
      </div>
      <ErrorText error={error} />
      <div><button disabled={busy}>{busy ? "Creating…" : "Create business"}</button></div>
    </form>
  );
}
