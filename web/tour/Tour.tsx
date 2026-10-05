// A game-style walkthrough: one short prompt at a time, the thing to look at outlined on the page.
// Nothing is blocked: visitors can click anything, and clicking the outlined thing moves the tour on.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TOURS, type PageId, type Step } from "./steps";

const SEEN = (page: PageId) => `mainstreet.tour.seen.${page}`;
const seen = (page: PageId) => {
  try {
    return localStorage.getItem(SEEN(page)) === "1";
  } catch {
    return true; // storage blocked: don't keep popping up
  }
};
const markSeen = (page: PageId) => {
  try {
    localStorage.setItem(SEEN(page), "1");
  } catch {
    /* ignore */
  }
};

/** Elements tagged data-tour="a b" match targets "a" and "b". The first visible one wins. */
function find(target: string | undefined): HTMLElement | null {
  if (!target) return null;
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour~="${target}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/**
 * The "What's this page?" button, and the walkthrough it starts.
 * `auto`: start by itself the first time someone sees this page (demo businesses, the homepage).
 */
export function Guide({ page, auto = false }: { page: PageId; auto?: boolean }) {
  const steps = TOURS[page];
  const [i, setI] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const scrolledTo = useRef<string | null>(null);
  const step: Step | undefined = i === null ? undefined : steps[i];

  const close = useCallback(() => {
    markSeen(page);
    setI(null);
    setRect(null);
  }, [page]);
  const next = useCallback(() => setI((n) => (n === null ? null : n + 1 < steps.length ? n + 1 : (markSeen(page), null))), [page, steps.length]);

  // Auto-start once per page, after the page has had a moment to load its data
  useEffect(() => {
    if (!auto || seen(page)) return;
    const t = setTimeout(() => {
      markSeen(page); // shown once: leaving mid-tour doesn't make it pop up again
      setI(0);
    }, 700);
    return () => clearTimeout(t);
  }, [auto, page]);

  // Follow the target as data loads, the page scrolls or the layout changes
  useLayoutEffect(() => {
    if (!step) return;
    const update = () => {
      const el = find(step.target);
      setRect(el ? el.getBoundingClientRect() : null);
      if (el && scrolledTo.current !== `${i}`) {
        scrolledTo.current = `${i}`;
        const r = el.getBoundingClientRect();
        if (r.top < 60 || r.bottom > innerHeight - 220) el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
    };
    update();
    const id = setInterval(update, 250);
    addEventListener("scroll", update, true);
    addEventListener("resize", update);
    return () => {
      clearInterval(id);
      removeEventListener("scroll", update, true);
      removeEventListener("resize", update);
    };
  }, [step, i]);

  // Doing the thing moves the tour on (the click itself still goes through)
  useEffect(() => {
    if (!step?.target || !step.advanceOnClick) return;
    const on = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.(`[data-tour~="${step.target}"]`)) setTimeout(next, 0);
    };
    document.addEventListener("click", on, true);
    return () => document.removeEventListener("click", on, true);
  }, [step, next]);

  useEffect(() => {
    if (i === null) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [i, close]);

  if (!step)
    return (
      <button className="tour-launch" onClick={() => { scrolledTo.current = null; setI(0); }} aria-label="What's this page? Start the walkthrough">
        <span aria-hidden="true">?</span> What's this page?
      </button>
    );

  const missing = !!step.target && !rect;
  const body = missing && step.whenMissing ? step.whenMissing : step.body;
  // Keep the card out of the way of what it points at
  const pad = 6;
  const cardAtTop = !!rect && rect.bottom > innerHeight - 260 && rect.top > 280;
  return (
    <>
      {rect && (
        <div
          className="tour-ring"
          aria-hidden="true"
          style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
        />
      )}
      <aside className={`tour-card${cardAtTop ? " top" : ""}`} role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-live="polite">
        <div className="tour-head">
          <span className="tour-count">{i! + 1} of {steps.length}</span>
          <button className="tour-x" onClick={close} aria-label="Close the walkthrough">×</button>
        </div>
        <h2 id="tour-title" className="tour-title">{step.title}</h2>
        <p>{body}</p>
        {step.advanceOnClick && !missing && <p className="tour-hint">Try it: click the outlined {step.what ?? "spot"}.</p>}
        <div className="tour-nav">
          <button className="secondary small" onClick={() => setI(i! - 1)} disabled={i === 0}>Back</button>
          <button className="small" onClick={next}>{i! + 1 === steps.length ? "Done" : "Next"}</button>
        </div>
      </aside>
    </>
  );
}
