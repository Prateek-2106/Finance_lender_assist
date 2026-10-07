import { useEffect, useState } from "react";
import { api } from "../api";
import { ErrorText } from "../ui/bits";
import { Guide } from "../tour/Tour";

/** The tenant's public website: who they are, and a way to ask for a quote. */
export function Site() {
  const [site, setSite] = useState<{ name: string; demo?: boolean } | null>(null);
  const [missing, setMissing] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<{ site: { name: string; demo?: boolean } }>("/site")
      .then((r) => {
        setSite(r.site);
        document.title = r.site.name;
      })
      .catch(() => setMissing(true));
  }, []);

  if (missing)
    return (
      <div className="site">
        <h1>No business here yet</h1>
        <p className="quiet">This address isn't connected to a business on Vendor Street.</p>
      </div>
    );
  if (!site) return null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("/leads", { method: "POST", json: Object.fromEntries(f) });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site">
      <header>
        <h1>{site.name}</h1>
        <p className="quiet">Tell us what you need and we'll get back to you with a quote.</p>
      </header>
      {sent ? (
        <p role="status">
          <strong>Thanks, we got your request.</strong> {site.name} will be in touch shortly.
        </p>
      ) : (
        <form className="stack" onSubmit={submit} data-tour="site-form">
          <label>
            Your name
            <input name="name" required autoComplete="name" />
          </label>
          <div className="row" style={{ alignItems: "stretch" }}>
            <label style={{ flex: 1 }}>
              Phone
              <input name="phone" type="tel" autoComplete="tel" />
            </label>
            <label style={{ flex: 1 }}>
              Email
              <input name="email" type="email" autoComplete="email" />
            </label>
          </div>
          <label>
            What do you need?
            <textarea name="message" required placeholder="For example: my water heater is leaking from the bottom." />
          </label>
          <ErrorText error={error} />
          <div>
            <button disabled={busy} data-tour="site-submit">{busy ? "Sending…" : "Request a quote"}</button>
          </div>
        </form>
      )}
      <Guide page="site" />
    </div>
  );
}
