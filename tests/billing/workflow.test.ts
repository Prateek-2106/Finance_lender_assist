import { canTransition, assertTransition, ESTIMATE_TRANSITIONS } from "../../src/workflow/estimate";
import { InvalidTransitionError } from "../../src/errors";
import type { EstimateStatus } from "../../src/domain";

describe("estimate state machine", () => {
  it.each<[EstimateStatus, EstimateStatus]>([
    ["needs_review", "draft"],
    ["draft", "sent"],
    ["sent", "accepted"],
    ["sent", "declined"],
    ["sent", "draft"],
    ["declined", "draft"],
    ["accepted", "invoiced"],
  ])("allows %s → %s", (from, to) => expect(canTransition(from, to)).toBe(true));

  it.each<[EstimateStatus, EstimateStatus]>([
    ["needs_review", "sent"], // an AI draft can't reach a customer without human review
    ["draft", "accepted"],
    ["draft", "invoiced"],
    ["sent", "invoiced"],
    ["declined", "accepted"],
    ["accepted", "draft"],
  ])("rejects %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
  });

  it("invoiced is terminal", () => {
    expect(ESTIMATE_TRANSITIONS.invoiced).toEqual([]);
  });
});
