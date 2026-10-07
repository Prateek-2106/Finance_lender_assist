import { useEffect, useState } from "react";
import { api, day, session } from "../api";
import { ErrorText } from "../ui/bits";
import { useHash } from "./useHash";
import { Requests } from "./Requests";
import { Estimates } from "./Estimates";
import { Funding } from "./Funding";
import { Statistics } from "./Statistics";
import { PriceList } from "./PriceList";
import { Guide } from "../tour/Tour";
import { apexUrl } from "../account/Account";
import type { PageId } from "../tour/steps";

// The order is the order of the work: what came in, how it's going, quoting, your prices, then funding.
const SECTIONS = [
  { id: "requests", name: "Requests" },
  { id: "statistics", name: "Statistics" },
  { id: "estimates", name: "Estimates" },
  { id: "prices", name: "Price list" },
  { id: "funding", name: "Funding" },
];
/** Old addresses (emails already sent link to them) keep working. */
const RENAMED: Record<string, string> = { leads: "requests", insights: "statistics" };

export function Dashboard() {
  const [site, setSite] = useState<{ name: string } | null>(null);
  // Signed in by API key (kept in the browser) or by account (an HttpOnly cookie we can't see, so we ask)
  const [signedIn, setSignedIn] = useState<boolean | null>(session.get() ? true : null);
  const [parts, go] = useHash();
  const renamed = parts[0] && RENAMED[parts[0]];
  useEffect(() => {
    if (renamed) history.replaceState(null, "", `#/${[renamed, ...parts.slice(1)].join("/")}`);
  }, [renamed]);
  const first = renamed || parts[0];
  const section = SECTIONS.some((s) => s.id === first) ? first! : "requests";

  useEffect(() => {
    if (signedIn === null) api("/settings").then(() => setSignedIn(true), () => setSignedIn(false));
    api<{ site: { name: string } }>("/site").then((r) => {
      setSite(r.site);
      document.title = `${r.site.name} · Vendor Street`;
    });
  }, []);

  if (signedIn === null) return null;
  if (!signedIn) return <SignIn name={site?.name} onDone={() => setSignedIn(true)} />;

  return (
    <div className="shell">
      <aside className="rail">
        <div className="tenant">{site?.name ?? " "}</div>
        <nav aria-label="Sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#/${s.id}`} aria-current={s.id === section ? "page" : undefined} data-tour={`nav-${s.id}`}>
              {s.name}
            </a>
          ))}
        </nav>
        <button
          className="secondary small"
          onClick={async () => {
            session.clear();
            await api("/auth/logout", { method: "POST" }).catch(() => {});
            setSignedIn(false);
          }}
        >
          Sign out
        </button>
      </aside>
      <main>
        <DemoBanner />
        {section === "requests" && <Requests go={go} />}
        {section === "estimates" && <Estimates selected={parts[1]} go={go} />}
        {section === "funding" && <Funding selected={parts[1]} go={go} />}
        {section === "statistics" && <Statistics view={parts.slice(1)} go={go} />}
        {section === "prices" && <PriceList />}
        <Guide key={section} page={section as PageId} />
      </main>
    </div>
  );
}

function SignIn({ name, onDone }: { name?: string; onDone: () => void }) {
  const [error, setError] = useState<unknown>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const key = String(new FormData(e.currentTarget).get("key") ?? "").trim();
    session.set(key);
    try {
      await api("/leads?limit=1");
      onDone();
    } catch (err) {
      session.clear();
      setError(err);
    }
  }
  return (
    <div className="site">
      <header>
        <h1>{name ?? "Vendor Street"}</h1>
        <p className="quiet">Sign in to manage this business.</p>
      </header>
      <div>
        <button onClick={async () => (location.href = `${await apexUrl()}/signin?next=${encodeURIComponent(location.href)}`)}>Use my account</button>
      </div>
      <form className="stack" onSubmit={submit} aria-label="Key sign-in">
        <p className="small quiet">Or use an API key (integrations and demos):</p>
        <label>
          API key
          <input name="key" required autoComplete="off" spellCheck={false} placeholder="sk_…" />
        </label>
        <ErrorText error={error} />
        <div>
          <button>Sign in</button>
        </div>
      </form>
    </div>
  );
}

/** Demo businesses say so on every screen, and point the visitor at the other side of the product. */
function DemoBanner() {
  const [demo, setDemo] = useState<{ expiresAt: string } | null>(null);
  const [uwKey, setUwKey] = useState<string | null>(null);
  useEffect(() => {
    api<{ settings: { demo: { expiresAt: string } | null } }>("/settings").then((r) => setDemo(r.settings.demo), () => {});
    api<{ platform: { demo: { underwriterKey: string | null } | null } }>("/platform").then((r) => setUwKey(r.platform.demo?.underwriterKey ?? null), () => {});
  }, []);
  if (!demo) return null;
  return (
    <aside className="demo-banner" aria-label="Demo business" data-tour="demo-banner">
      <p>
        <strong>Demo business.</strong> Everyone and everything here is made up. Emails are kept under Statistics, never sent. Expires {day(demo.expiresAt)}.
      </p>
      {uwKey && (
        <a className="button secondary small" href={`/underwriting#key=${uwKey}`} data-tour="uw-link">
          Open the underwriter console
        </a>
      )}
    </aside>
  );
}
