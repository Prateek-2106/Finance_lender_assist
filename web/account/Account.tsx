// Accounts: sign in by email, the page the link opens, and "your businesses".
import { useEffect, useId, useState } from "react";
import { api, ApiError } from "../api";
import { ErrorText } from "../ui/bits";

type Business = { id: string; name: string; subdomain: string; role: string; dashboardUrl: string; siteUrl: string };
type Me = { user: { id: string; email: string; name: string | null }; businesses: Business[]; limits: { businesses: number }; admin?: boolean };

/** The platform's own address (where sign-in lives), from any business subdomain. */
export async function apexUrl() {
  const { platform } = await api<{ platform: { baseDomain: string } }>("/platform");
  const base = platform.baseDomain === "localhost" ? "lvh.me" : platform.baseDomain;
  return `${location.protocol}//${base}${location.port ? `:${location.port}` : ""}`;
}

export function Frame({ children, title, wide }: { children: React.ReactNode; title: string; wide?: boolean }) {
  useEffect(() => {
    document.title = `${title} · Vendor Street`;
  }, [title]);
  return (
    <div className={wide ? "site auth wide" : "site auth"}>
      <header>
        <p className="eyebrow"><a href="/">Vendor Street</a></p>
        <h1>{title}</h1>
      </header>
      {children}
    </div>
  );
}

const nextParam = () => {
  const n = new URLSearchParams(location.search).get("next");
  return n ? `next=${encodeURIComponent(n)}` : "";
};
const withNext = (path: string, extra = "") => {
  const q = [extra, nextParam()].filter(Boolean).join("&");
  return q ? `${path}?${q}` : path;
};
const goNext = () => location.replace(new URLSearchParams(location.search).get("next") ?? "/account");

function PasswordField({ name = "password", label = "Password", autoComplete, help }: { name?: string; label?: string; autoComplete: string; help?: string }) {
  const [show, setShow] = useState(false);
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <span className="pw">
        <input id={id} name={name} type={show ? "text" : "password"} required minLength={10} maxLength={200} autoComplete={autoComplete} aria-describedby={help ? `${id}-help` : undefined} />
        <button type="button" className="secondary small" onClick={() => setShow((x) => !x)} aria-label={show ? "Hide password" : "Show password"}>{show ? "Hide" : "Show"}</button>
      </span>
      {help && <span id={`${id}-help`} className="small quiet">{help}</span>}
    </div>
  );
}

function useSubmit<T>(fn: (f: FormData) => Promise<T>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn(new FormData(e.currentTarget));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, onSubmit };
}

export function SignInPage() {
  const { busy, error, onSubmit } = useSubmit(async (f) => {
    const email = String(f.get("email")).trim();
    try {
      await api("/auth/login", { method: "POST", json: { email, password: String(f.get("password")) } });
      goNext();
    } catch (err) {
      // Right password but the email isn't confirmed yet: we just sent a code
      if (err instanceof ApiError && err.status === 403 && /Confirm your email/.test(err.message)) location.assign(withNext("/verify", `email=${encodeURIComponent(email)}`));
      else throw err;
    }
  });
  return (
    <Frame title="Sign in">
      <form className="stack" onSubmit={onSubmit} aria-label="Sign in">
        <label>
          Email
          <input name="email" type="email" required autoComplete="username" autoFocus />
        </label>
        <PasswordField autoComplete="current-password" />
        <ErrorText error={error} />
        <div className="row" style={{ justifyContent: "space-between" }}>
          <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          <a href={withNext("/forgot")} className="small">Forgot password?</a>
        </div>
      </form>
      <p className="small">New to Vendor Street? <a href={withNext("/signup")}>Create an account</a></p>
      <p className="small quiet">Just looking? <a href="/">Try a demo business</a>; no account needed.</p>
    </Frame>
  );
}

export function SignUpPage() {
  const { busy, error, onSubmit } = useSubmit(async (f) => {
    const email = String(f.get("email")).trim();
    await api("/auth/signup", { method: "POST", json: { email, password: String(f.get("password")) } });
    location.assign(withNext("/verify", `email=${encodeURIComponent(email)}`));
  });
  return (
    <Frame title="Create an account">
      <form className="stack" onSubmit={onSubmit} aria-label="Create an account">
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" autoFocus />
        </label>
        <PasswordField autoComplete="new-password" help="At least 10 characters. A short phrase is easy to remember and hard to guess." />
        <ErrorText error={error} />
        <div><button disabled={busy}>{busy ? "Creating…" : "Create account"}</button></div>
      </form>
      <p className="small">Already have an account? <a href={withNext("/signin")}>Sign in</a></p>
    </Frame>
  );
}

/** "Enter the code we emailed you" after sign-up (or a sign-in before confirming). */
export function VerifyPage() {
  const email = new URLSearchParams(location.search).get("email") ?? "";
  const [resent, setResent] = useState(false);
  const { busy, error, setError, onSubmit } = useSubmit(async (f) => {
    await api("/auth/verify-email", { method: "POST", json: { email, code: String(f.get("code")).trim() } });
    goNext();
  });
  async function resend() {
    setError(null);
    try {
      await api("/auth/resend-code", { method: "POST", json: { email } });
      setResent(true);
    } catch (err) {
      setError(err);
    }
  }
  if (!email) return <Frame title="Confirm your email"><p><a href="/signup">Start again</a></p></Frame>;
  return (
    <Frame title="Confirm your email">
      <p>We sent a 6-digit code to <strong>{email}</strong>. It expires in 15 minutes.</p>
      <form className="stack" onSubmit={onSubmit} aria-label="Confirm your email">
        <label>
          Code
          <input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} autoFocus className="code-input" />
        </label>
        <ErrorText error={error} />
        <div><button disabled={busy}>{busy ? "Checking…" : "Confirm"}</button></div>
      </form>
      <p className="small quiet">
        Nothing there? Check spam, or <button className="linkish" onClick={resend}>send a new code</button>.{resent && <span role="status"> Sent.</span>}
      </p>
    </Frame>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState<string | null>(null);
  const ask = useSubmit(async (f) => {
    const e = String(f.get("email")).trim();
    await api("/auth/forgot", { method: "POST", json: { email: e } });
    setEmail(e);
  });
  const reset = useSubmit(async (f) => {
    await api("/auth/reset", { method: "POST", json: { email, code: String(f.get("code")).trim(), password: String(f.get("password")) } });
    goNext();
  });
  if (!email)
    return (
      <Frame title="Reset your password">
        <p className="quiet">We'll email you a code to choose a new password.</p>
        <form className="stack" onSubmit={ask.onSubmit} aria-label="Reset your password">
          <label>
            Email
            <input name="email" type="email" required autoComplete="username" autoFocus />
          </label>
          <ErrorText error={ask.error} />
          <div><button disabled={ask.busy}>{ask.busy ? "Sending…" : "Email me a code"}</button></div>
        </form>
        <p className="small"><a href={withNext("/signin")}>Back to sign in</a></p>
      </Frame>
    );
  return (
    <Frame title="Choose a new password">
      <p>If <strong>{email}</strong> has an account, a 6-digit code is on its way. It expires in 15 minutes.</p>
      <form className="stack" onSubmit={reset.onSubmit} aria-label="Choose a new password">
        <label>
          Code
          <input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} autoFocus className="code-input" />
        </label>
        <PasswordField label="New password" autoComplete="new-password" help="At least 10 characters. This signs you out on your other devices." />
        <ErrorText error={reset.error} />
        <div><button disabled={reset.busy}>{reset.busy ? "Saving…" : "Save and sign in"}</button></div>
      </form>
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
        <div className="row">
          {me.admin && <a className="button secondary small" href="/admin">Platform numbers</a>}
          <button className="secondary small" onClick={signOut}>Sign out</button>
        </div>
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
