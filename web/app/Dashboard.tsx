import { useEffect, useState } from "react";
import { api, day, session } from "../api";
import { ErrorText } from "../ui/bits";
import { useHash } from "./useHash";
import { Leads } from "./Leads";
import { Estimates } from "./Estimates";
import { Funding } from "./Funding";
import { Insights } from "./Insights";
import { Guide } from "../tour/Tour";
import type { PageId } from "../tour/steps";

const SECTIONS = [
  { id: "leads", name: "Leads" },
  { id: "estimates", name: "Estimates" },
  { id: "funding", name: "Funding" },
  { id: "insights", name: "Insights" },
];

export function Dashboard() {
  const [site, setSite] = useState<{ name: string } | null>(null);
  const [signedIn, setSignedIn] = useState(!!session.get());
  const [demo, setDemo] = useState<boolean | undefined>(undefined); // known once settings load
  const [parts, go] = useHash();
  const section = SECTIONS.some((s) => s.id === parts[0]) ? parts[0]! : "leads";

  useEffect(() => {
    api<{ site: { name: string } }>("/site").then((r) => {
      setSite(r.site);
      document.title = `${r.site.name} · Vendor Street`;
    });
  }, []);

  if (!signedIn) return <SignIn name={site?.name} onDone={() => setSignedIn(true)} />;

  return (
    <div className="shell">
      <aside className="rail">
        <div className="tenant">{site?.name ?? " "}</div>
        <nav aria-label="Sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#/${s.id}`} aria-current={s.id === section ? "page" : undefined}>
              {s.name}
            </a>
          ))}
        </nav>
        <button
          className="secondary small"
          onClick={() => {
            session.clear();
            setSignedIn(false);
          }}
        >
          Sign out
        </button>
      </aside>
      <main>
        <DemoBanner onDemo={setDemo} />
        {section === "leads" && <Leads go={go} />}
        {section === "estimates" && <Estimates selected={parts[1]} go={go} />}
        {section === "funding" && <Funding selected={parts[1]} go={go} />}
        {section === "insights" && <Insights />}
        {demo !== undefined && <Guide key={section} page={section as PageId} auto={demo} />}
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
        <p className="quiet">Sign in with the API key you got when you created this business.</p>
      </header>
      <form className="stack" onSubmit={submit}>
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
function DemoBanner({ onDemo }: { onDemo: (isDemo: boolean) => void }) {
  const [demo, setDemo] = useState<{ expiresAt: string } | null>(null);
  const [uwKey, setUwKey] = useState<string | null>(null);
  useEffect(() => {
    api<{ settings: { demo: { expiresAt: string } | null } }>("/settings").then((r) => { setDemo(r.settings.demo); onDemo(!!r.settings.demo); }, () => onDemo(false));
    api<{ platform: { demo: { underwriterKey: string | null } | null } }>("/platform").then((r) => setUwKey(r.platform.demo?.underwriterKey ?? null), () => {});
  }, []);
  if (!demo) return null;
  return (
    <aside className="demo-banner" aria-label="Demo business" data-tour="demo-banner">
      <p>
        <strong>Demo business.</strong> Everyone and everything here is made up. Emails are kept under Insights, never sent. Expires {day(demo.expiresAt)}.
      </p>
      {uwKey && (
        <a className="button secondary small" href={`/underwriting#key=${uwKey}`} target="_blank" rel="noopener" data-tour="uw-link">
          Open the underwriter console
        </a>
      )}
    </aside>
  );
}
