import { ApiError } from "../api";

const STATUS_WORDS: Record<string, string> = {
  needs_review: "Needs review",
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  invoiced: "Invoiced",
  open: "Open",
  paid: "Paid",
  void: "Void",
  approve: "Approve",
  review: "Review",
  decline: "Decline",
  assessed: "Assessed",
};

export function Status({ value }: { value: string }) {
  return <span className={`status ${value}`}>{STATUS_WORDS[value] ?? value}</span>;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : new ApiError(String((error as Error)?.message ?? error), 0);
  return (
    <div className="error" role="alert">
      {e.message}
      {e.issues?.length ? (
        <ul>
          {e.issues.slice(0, 8).map((i, n) => (
            <li key={n}>{i.line ? `Line ${i.line}: ` : i.path ? `${i.path}: ` : ""}{i.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Citations like [M7] or [K1], shown quietly after a sentence. */
export function Cites({ ids }: { ids: string[] }) {
  return ids.length ? <span className="cite">[{ids.join(", ")}]</span> : null;
}
