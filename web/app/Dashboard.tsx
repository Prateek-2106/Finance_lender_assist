import { useEffect, useState } from "react";
import { api, session } from "../api";
import { ErrorText } from "../ui/bits";
import { useHash } from "./useHash";
import { Leads } from "./Leads";
import { Estimates } from "./Estimates";
import { Funding } from "./Funding";

const SECTIONS = [
  { id: "leads", name: "Leads" },
  { id: "estimates", name: "Estimates" },
  { id: "funding", name: "Funding" },
];

export function Dashboard() {
  const [site, setSite] = useState<{ name: string } | null>(null);
  const [signedIn, setSignedIn] = useState(!!session.get());
  const [parts, go] = useHash();
  const section = SECTIONS.some((s) => s.id === parts[0]) ? parts[0]! : "leads";

  useEffect(() => {
    api<{ site: { name: string } }>("/site").then((r) => {
      setSite(r.site);
      document.title = `${r.site.name} · Mainstreet`;
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
        {section === "leads" && <Leads go={go} />}
        {section === "estimates" && <Estimates selected={parts[1]} go={go} />}
        {section === "funding" && <Funding selected={parts[1]} go={go} />}
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
        <h1>{name ?? "Mainstreet"}</h1>
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
