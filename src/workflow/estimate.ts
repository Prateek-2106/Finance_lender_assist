import type { EstimateStatus } from "../domain";
import { InvalidTransitionError } from "../errors";

export const ESTIMATE_TRANSITIONS: Record<EstimateStatus, readonly EstimateStatus[]> = {
  needs_review: ["draft"],
  draft: ["sent"],
  sent: ["accepted", "declined", "draft"],
  declined: ["draft"],
  accepted: ["invoiced"],
  invoiced: [],
};

export function canTransition(from: EstimateStatus, to: EstimateStatus): boolean {
  return ESTIMATE_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: EstimateStatus, to: EstimateStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(`Cannot move estimate from ${from} to ${to}`);
}
