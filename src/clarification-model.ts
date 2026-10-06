import { z } from "zod";
import { AuthoredDecisionSchema, FictionalActorSchema } from "./authored-model.ts";
import { SharedFieldsSchema, SharedEvidenceInputSchema, SharedOutcomeInputSchema, createSharedState, validateSharedHistory, sharedDecision, sharedEvidence, sharedBasis, sharedPendingReview, sharedReviewForLatest } from "./shared-model.ts";
import type { SharedCreationIds, SharedEvidenceInput, SharedOutcomeInput } from "./shared-model.ts";

export const ReplacementInputSchema = z.object({ actor: FictionalActorSchema, rationale: AuthoredDecisionSchema.shape.rationale });
const ReplacementSchema = ReplacementInputSchema.extend({
  id: z.uuid(), decisionId: z.uuid(), oldReviewId: z.uuid(), newReviewId: z.uuid(), deferredOutcomeId: z.uuid(), recordedAt: z.iso.datetime(),
  oldSourceEventId: z.uuid(), oldEvidenceId: z.uuid(), newSourceEventId: z.uuid(), newEvidenceId: z.uuid(),
});
const ClarificationFieldsSchema = SharedFieldsSchema.extend({ schemaVersion: z.literal(6), replacements: z.array(ReplacementSchema) });
export type ClarificationState = z.infer<typeof ClarificationFieldsSchema>;
export type ReplacementInput = z.infer<typeof ReplacementInputSchema>;

/** Replacement closes a review question, never a decision hold or approval basis. */
export const ClarificationStateSchema = ClarificationFieldsSchema.superRefine((state, context): void => {
  validateSharedHistory(state, state.replacements, context);
  function require(condition: boolean, message: string): void { if (!condition) context.addIssue({ code: "custom", message }); }
  const originalIds = [state.id, state.source.id, ...state.originalDecisions.flatMap((record): string[] => [record.decision.id, record.assumption.id]), ...state.sources.flatMap((event): string[] => [event.id, event.evidence.id]), ...state.reviews.map((review): string => review.id), ...state.outcomes.map((outcome): string => outcome.id)];
  const ids = [...originalIds, ...state.replacements.map((event): string => event.id)];
  require(new Set(ids).size === ids.length, "Replacement events require distinct UUIDs, including across all existing entities.");
  require(new Set(state.replacements.map((event): string => event.oldReviewId)).size === state.replacements.length && new Set(state.replacements.map((event): string => event.newReviewId)).size === state.replacements.length, "A review can be replaced once and have only one predecessor; duplicate or branching replacement links are invalid.");
  state.replacements.forEach((event, index: number): void => {
    const previous = state.replacements[index - 1];
    require(previous === undefined || Date.parse(event.recordedAt) >= Date.parse(previous.recordedAt), "Replacement events retain append chronology.");
    const oldReview = state.reviews.find((review): boolean => review.id === event.oldReviewId), newReview = state.reviews.find((review): boolean => review.id === event.newReviewId);
    require(oldReview !== undefined && newReview !== undefined && oldReview.id !== newReview.id, "Replacement links require two different existing reviews; orphan or cyclic links are invalid.");
    if (oldReview === undefined || newReview === undefined) return;
    const record = state.originalDecisions.find((item): boolean => item.decision.id === event.decisionId);
    const oldTarget = state.sources.find((item): boolean => item.id === oldReview.sourceEventId), newTarget = state.sources.find((item): boolean => item.id === newReview.sourceEventId);
    const decisionReviews = state.reviews.filter((review): boolean => review.decisionId === event.decisionId);
    require(oldReview.decisionId === event.decisionId && newReview.decisionId === event.decisionId && record?.assumption.scope === "Production", "A clarification replacement belongs to one production decision only.");
    require(decisionReviews[decisionReviews.indexOf(oldReview) + 1]?.id === newReview.id, "The replacement review must immediately follow its predecessor; reverse or cyclic links are invalid.");
    require(event.actor === oldReview.actor && event.actor === newReview.actor && event.actor === record?.decision.actor, "Only the assigned fictional reviewer can replace this review.");
    require(oldReview.trigger === "unresolved" && oldTarget?.evidence.environment === "Unknown" && newTarget?.evidence.environment === "Production" && newReview.trigger === "affected", "Replacement requires an Unknown target followed by a declared Production capture that warrants reassessment.");
    require(event.oldSourceEventId === oldReview.sourceEventId && event.oldEvidenceId === oldReview.evidenceId && event.newSourceEventId === newReview.sourceEventId && event.newEvidenceId === newReview.evidenceId, "Replacement source/evidence references must match both frozen reviews exactly.");
    require(event.recordedAt === newReview.openedAt && Date.parse(event.recordedAt) >= Date.parse(oldReview.openedAt), "Replacement and new review are one atomic event after the old review.");
    const oldOutcomes = state.outcomes.filter((outcome): boolean => outcome.reviewId === oldReview.id);
    require(oldOutcomes.length > 0 && oldOutcomes.at(-1)?.outcome === "defer" && oldOutcomes.at(-1)?.id === event.deferredOutcomeId, "Only a deferred, unresolved review can be replaced; a terminal outcome cannot be replaced.");
    require(oldOutcomes.every((outcome): boolean => Date.parse(outcome.recordedAt) <= Date.parse(event.recordedAt)), "A replaced review cannot receive an outcome after its replacement.");
  });
  state.outcomes.forEach((outcome): void => {
    const review = state.reviews.find((item): boolean => item.id === outcome.reviewId);
    require(outcome.outcome !== "reaffirm" || outcome.statement === review?.basis.statement, "Reaffirm preserves the exact earlier decision scope, including a production hold. Choose Revise to record a changed scope.");
  });
});

export function createClarificationState(actor: string, ids: SharedCreationIds, recordedAt: string): ClarificationState {
  return ClarificationStateSchema.parse({ ...createSharedState(actor, ids, recordedAt), schemaVersion: 6, replacements: [] });
}
export function appendClarificationEvidence(state: ClarificationState, input: SharedEvidenceInput, eventId: string, evidenceId: string, recordedAt: string): ClarificationState {
  const current = ClarificationStateSchema.parse(state), data = SharedEvidenceInputSchema.parse(input);
  return ClarificationStateSchema.parse({ ...current, sources: [...current.sources, { id: eventId, recordedAt, evidence: { ...data, id: evidenceId, sourceId: current.source.id, observedActivity: "Not observed", provenance: "Synthetic" } }] });
}
export function openClarificationReview(state: ClarificationState, decisionId: string, id: string, openedAt: string): ClarificationState {
  const current = ClarificationStateSchema.parse(state);
  return ClarificationStateSchema.parse({ ...current, reviews: [...current.reviews, sharedReviewForLatest(current, decisionId, id, openedAt)] });
}
export function replaceClarificationReview(state: ClarificationState, decisionId: string, input: ReplacementInput, eventId: string, reviewId: string, recordedAt: string): ClarificationState {
  const current = ClarificationStateSchema.parse(state), data = ReplacementInputSchema.parse(input);
  const oldReview = sharedPendingReview(current, decisionId), latest = current.sources.at(-1), record = sharedDecision(current, decisionId);
  if (oldReview === null || latest === undefined) throw new ReferenceError("A pending review and later captured evidence are required for explicit replacement.");
  if (data.actor !== oldReview.actor) throw new RangeError("Only the assigned fictional reviewer can initiate replacement. No event was recorded.");
  if (oldReview.trigger !== "unresolved" || sharedEvidence(current, oldReview.evidenceId).environment !== "Unknown" || latest.evidence.environment !== "Production" || latest.evidence.id === oldReview.evidenceId || record.assumption.scope !== "Production") throw new RangeError("Defer the Unknown production review, then capture a later declared Production context before replacing it.");
  if (current.outcomes.filter((outcome): boolean => outcome.reviewId === oldReview.id).at(-1)?.outcome !== "defer") throw new RangeError("Record the unresolved review's deferral before replacing it with a clarified question.");
  const basis = sharedBasis(current, decisionId);
  if (basis === null) throw new ReferenceError("A withdrawn decision cannot receive a replacement review.");
  const newReview = { ...oldReview, id: reviewId, openedAt: recordedAt, sourceEventId: latest.id, evidenceId: latest.evidence.id, basis, trigger: "affected" as const };
  return ClarificationStateSchema.parse({ ...current, reviews: [...current.reviews, newReview], replacements: [...current.replacements, { ...data, id: eventId, decisionId, oldReviewId: oldReview.id, newReviewId: reviewId, deferredOutcomeId: z.uuid().parse(current.outcomes.filter((outcome): boolean => outcome.reviewId === oldReview.id).at(-1)?.id), recordedAt, oldSourceEventId: oldReview.sourceEventId, oldEvidenceId: oldReview.evidenceId, newSourceEventId: latest.id, newEvidenceId: latest.evidence.id }] });
}
export function appendClarificationOutcome(state: ClarificationState, decisionId: string, input: SharedOutcomeInput, id: string, recordedAt: string): ClarificationState {
  const current = ClarificationStateSchema.parse(state), review = sharedPendingReview(current, decisionId), data = SharedOutcomeInputSchema.parse(input);
  if (review === null) throw new ReferenceError("Open this decision's assigned review before recording an outcome.");
  return ClarificationStateSchema.parse({ ...current, outcomes: [...current.outcomes, { ...data, id, decisionId, reviewId: review.id, sourceEventId: review.sourceEventId, evidenceId: review.evidenceId, revision: `${decisionId}.${current.outcomes.filter((outcome): boolean => outcome.decisionId === decisionId).length + 2}`, recordedAt }] });
}
