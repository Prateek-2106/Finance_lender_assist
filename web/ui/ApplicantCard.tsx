import type { ApplicantView } from "../../src/risk/applicantView";
import { day, dollars, money } from "../api";

/** The answer, in words the person who asked for money would use. */
export function ApplicantCard({ v }: { v: ApplicantView }) {
  return (
    <div className={`applicant ${v.status}`} data-testid="applicant-card" data-tour="applicant-card">
      <h3 className="headline">{v.headline}</h3>
      <p>{v.summary}</p>
      {v.offer && (
        <dl className="offer-terms">
          <div><dt>You receive</dt><dd>{dollars(v.offer.amountCents)}</dd></div>
          <div><dt>You repay</dt><dd>{dollars(v.offer.paybackCents)}</dd></div>
          <div><dt>Cost of the money</dt><dd>{dollars(v.offer.costCents)}</dd></div>
          <div><dt>Each business day</dt><dd>{money(v.offer.dailyPaymentCents)}</dd></div>
          <div><dt>For about</dt><dd>{v.offer.approxMonths} months</dd></div>
          <div><dt>Estimated APR</dt><dd>{v.offer.estimatedAprPercent}%</dd></div>
        </dl>
      )}
      {v.reasons.length > 0 && (
        <ul className="plain-reasons">
          {v.reasons.map((r, i) => (
            <li key={i}>
              <span>{r.text}</span>
              {r.whatWouldHelp && <span className="help">{r.whatWouldHelp}</span>}
            </li>
          ))}
        </ul>
      )}
      {v.note && <p className="reviewer-note">Note from the reviewer: {v.note}</p>}
      {v.nextSteps.length > 0 && (
        <div>
          <p className="next-title">What happens next</p>
          <ul className="next">{v.nextSteps.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      )}
      {v.decidedBy && <p className="quiet small" data-testid="decided-by">{v.decidedBy}{v.decidedAt ? ` on ${day(v.decidedAt)}` : ""}.</p>}
    </div>
  );
}
