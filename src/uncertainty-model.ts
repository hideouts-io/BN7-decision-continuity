import { z } from "zod";
import { AuthoredDecisionSchema, FictionalActorSchema } from "./authored-model.ts";
import { ClarificationStateSchema } from "./clarification-model.ts";
import type { ClarificationState, ClarificationHistory } from "./clarification-model.ts";
import { decisionBasisEventsFromRecords, eventAncestors } from "./basis-events.ts";
import { decisionBasisAtRecords } from "./decision-basis.ts";
import { sharedDecision, sharedPendingReview } from "./shared-model.ts";
import type { SharedReview } from "./shared-model.ts";

export const RequirementInputSchema = z.strictObject({
  actor: FictionalActorSchema, question: AuthoredDecisionSchema.shape.statement,
  requiredEvidence: AuthoredDecisionSchema.shape.statement, triggerDescription: AuthoredDecisionSchema.shape.statement,
});
export const ResolutionInputSchema = z.strictObject({
  actor: FictionalActorSchema, sourceEventId: z.uuid(), result: z.enum(["satisfied", "insufficient"]), rationale: AuthoredDecisionSchema.shape.rationale,
});
export const RequirementSchema = RequirementInputSchema.extend({
  id: z.uuid(), recordedAt: z.iso.datetime(), kind: z.literal("declare-deployment-context"), field: z.literal("environment"), expectedEnvironment: z.literal("Production"),
  decisionId: z.uuid(), assumptionId: z.uuid(), sourceId: z.uuid(), reviewId: z.uuid(), deferredOutcomeId: z.uuid(), sourceEventId: z.uuid(), evidenceId: z.uuid(),
});
export const ResolutionSchema = ResolutionInputSchema.extend({ id: z.uuid(), requirementId: z.uuid(), evidenceId: z.uuid(), recordedAt: z.iso.datetime() });
const UncertaintyFieldsSchema = z.strictObject({
  schemaVersion: z.literal(7), id: z.uuid(), createdAt: z.iso.datetime(), history: ClarificationStateSchema,
  requirements: z.array(RequirementSchema), resolutions: z.array(ResolutionSchema),
});
export type RequirementInput = z.infer<typeof RequirementInputSchema>;
export type ResolutionInput = z.infer<typeof ResolutionInputSchema>;
export type UncertaintyRequirement = z.infer<typeof RequirementSchema>;
export type UncertaintyResolution = z.infer<typeof ResolutionSchema>;
export type UncertaintyState = z.infer<typeof UncertaintyFieldsSchema>;
export type UncertaintyJournal = Readonly<{ id: string; createdAt: string; history: ClarificationHistory; requirements: readonly UncertaintyRequirement[]; resolutions: readonly UncertaintyResolution[] }>;
type SourceEvent = ClarificationState["sources"][number];

function historyTimes(history: ClarificationHistory): readonly string[] {
  return [...history.sources.map((event): string => event.recordedAt), ...history.reviews.map((review): string => review.openedAt), ...history.outcomes.map((outcome): string => outcome.recordedAt), ...history.replacements.map((event): string => event.recordedAt)];
}
export function uncertaintyRecordTimes(state: UncertaintyState): readonly string[] {
  return [state.createdAt, ...historyTimes(state.history), ...state.requirements.map((requirement): string => requirement.recordedAt), ...state.resolutions.map((resolution): string => resolution.recordedAt)];
}
function requireAppendTime(times: readonly string[], recordedAt: string): void {
  const time: string = z.iso.datetime().parse(recordedAt);
  if (times.some((previous: string): boolean => Date.parse(previous) > Date.parse(time))) throw new RangeError("A new uncertainty event cannot predate any record already present in this continuation. No event was appended.");
}
function historyIds(history: ClarificationHistory): readonly string[] {
  return [history.id, history.source.id, ...history.originalDecisions.flatMap((record): string[] => [record.decision.id, record.assumption.id]), ...history.sources.flatMap((event): string[] => [event.id, event.evidence.id]), ...history.reviews.map((review): string => review.id), ...history.outcomes.map((outcome): string => outcome.id), ...history.replacements.map((event): string => event.id)];
}
function requireCausalHistory(history: ClarificationHistory): void {
  for (const record of history.originalDecisions) eventAncestors(decisionBasisEventsFromRecords(history, record.decision.id));
}
function sameHistoryPrefix(previous: ClarificationState, next: ClarificationState): boolean {
  return previous.id === next.id
    && JSON.stringify([previous.source, previous.originalDecisions]) === JSON.stringify([next.source, next.originalDecisions])
    && JSON.stringify(previous.sources) === JSON.stringify(next.sources.slice(0, previous.sources.length))
    && JSON.stringify(previous.reviews) === JSON.stringify(next.reviews.slice(0, previous.reviews.length))
    && JSON.stringify(previous.outcomes) === JSON.stringify(next.outcomes.slice(0, previous.outcomes.length))
    && JSON.stringify(previous.replacements) === JSON.stringify(next.replacements.slice(0, previous.replacements.length));
}
function requireRequirement(state: UncertaintyState, id: string): UncertaintyRequirement {
  const requirement = state.requirements.find((item): boolean => item.id === z.uuid().parse(id));
  if (requirement === undefined) throw new ReferenceError(`Evidence requirement ${id} does not belong to this continuation.`);
  return requirement;
}
export function uncertaintyRequirementForReview(state: UncertaintyState, reviewId: string): UncertaintyRequirement | null {
  return state.requirements.find((requirement): boolean => requirement.reviewId === reviewId) ?? null;
}
export function uncertaintyResolutionsForRequirement(state: UncertaintyState, requirementId: string): readonly UncertaintyResolution[] {
  requireRequirement(state, requirementId);
  return state.resolutions.filter((resolution): boolean => resolution.requirementId === requirementId);
}

/** A requirement names the unresolved declaration; it neither replaces its review nor approves its decision. */
export function eligibleUncertaintyReview(state: UncertaintyState, decisionId: string): SharedReview | null {
  const record = sharedDecision(state.history, z.uuid().parse(decisionId)), review = sharedPendingReview(state.history, decisionId);
  if (review === null || record.assumption.scope !== "Production" || review.trigger !== "unresolved" || uncertaintyRequirementForReview(state, review.id) !== null) return null;
  const target = state.history.sources.find((event): boolean => event.id === review.sourceEventId);
  const outcome = state.history.outcomes.filter((item): boolean => item.reviewId === review.id).at(-1);
  return target?.evidence.environment === "Unknown" && outcome?.outcome === "defer" && !state.history.replacements.some((event): boolean => event.oldReviewId === review.id) ? review : null;
}

/** Candidates must be genuinely later records; an insufficient attempt requires another capture before retrying. */
export function uncertaintyResolutionCandidates(state: UncertaintyState, requirementId: string): readonly SourceEvent[] {
  const requirement = requireRequirement(state, requirementId), attempts = uncertaintyResolutionsForRequirement(state, requirementId), last = attempts.at(-1);
  if (last?.result === "satisfied") return [];
  const priorId = last?.sourceEventId ?? requirement.sourceEventId, priorIndex = state.history.sources.findIndex((event): boolean => event.id === priorId);
  if (priorIndex < 0) throw new ReferenceError("The evidence requirement's previous capture is missing; no candidate can be established.");
  return state.history.sources.filter((event, index: number): boolean => index > priorIndex && Date.parse(event.recordedAt) >= Date.parse(requirement.recordedAt));
}

/** Validate frozen eligibility at creation, so later replacements and human outcomes remain valid history. */
export function validateUncertaintyJournal(state: UncertaintyJournal, context: z.RefinementCtx): void {
  function require(condition: boolean, message: string): void { if (!condition) context.addIssue({ code: "custom", message }); }
  const ids = [state.id, ...historyIds(state.history), ...state.requirements.map((requirement): string => requirement.id), ...state.resolutions.map((resolution): string => resolution.id)];
  require(new Set(ids).size === ids.length, "Uncertainty continuation, requirements and resolutions require distinct UUIDs across every preserved entity.");
  const baseline = state.history.sources[0];
  require(baseline !== undefined && Date.parse(state.createdAt) >= Date.parse(baseline.recordedAt), "A continuation cannot be enrolled before its preserved baseline was recorded.");
  try { requireCausalHistory(state.history); }
  catch (error) {
    if (!(error instanceof RangeError) && !(error instanceof ReferenceError)) throw error;
    require(false, error.message);
  }
  require(new Set(state.requirements.map((requirement): string => requirement.reviewId)).size === state.requirements.length, "Each deferred review can have only one evidence requirement; preserve its earlier requirement.");
  state.requirements.forEach((requirement, index: number): void => {
    const previous = state.requirements[index - 1], time = Date.parse(requirement.recordedAt);
    require(time >= Date.parse(state.createdAt) && (previous === undefined || time >= Date.parse(previous.recordedAt)), "Requirements preserve continuation creation and append chronology.");
    const review = state.history.reviews.find((item): boolean => item.id === requirement.reviewId);
    const outcome = state.history.outcomes.find((item): boolean => item.id === requirement.deferredOutcomeId);
    const record = state.history.originalDecisions.find((item): boolean => item.decision.id === requirement.decisionId);
    const target = state.history.sources.find((event): boolean => event.id === requirement.sourceEventId);
    require(review !== undefined && outcome !== undefined && record !== undefined && target !== undefined, "Evidence requirements must reference an existing decision, assumption, exact review, deferral and source capture.");
    if (review === undefined || outcome === undefined || record === undefined || target === undefined) return;
    require(requirement.sourceId === state.history.source.id && requirement.assumptionId === record.assumption.id && requirement.decisionId === review.decisionId && requirement.assumptionId === review.assumptionId && requirement.sourceEventId === review.sourceEventId && requirement.evidenceId === review.evidenceId && requirement.evidenceId === target.evidence.id && outcome.reviewId === review.id && outcome.decisionId === requirement.decisionId, "Requirement references must match the exact frozen decision, assumption, review, source and evidence pair.");
    require(requirement.actor === review.actor && requirement.actor === record.decision.actor, "The evidence requirement must retain its assigned fictional reviewer.");
    require(record.assumption.scope === "Production" && review.trigger === "unresolved" && target.evidence.environment === "Unknown" && outcome.outcome === "defer", "An evidence requirement is limited to a deferred Unknown declaration for a Production-scope review.");
    require(time >= Date.parse(outcome.recordedAt), "An evidence requirement cannot predate its referenced deferral.");
    const knownOutcomes = state.history.outcomes.filter((item): boolean => item.reviewId === review.id && Date.parse(item.recordedAt) <= time);
    require(knownOutcomes.at(-1)?.id === outcome.id, "The requirement must reference the latest deferral available when it was recorded; terminal or superseded review outcomes cannot acquire a requirement.");
    const laterReview = state.history.reviews.filter((item): boolean => item.decisionId === requirement.decisionId).find((item): boolean => state.history.reviews.indexOf(item) > state.history.reviews.indexOf(review) && Date.parse(item.openedAt) <= time);
    require(laterReview === undefined && !state.history.replacements.some((event): boolean => event.oldReviewId === review.id && Date.parse(event.recordedAt) <= time), "The deferred review must still be active when its requirement is recorded. Same-time closure without an explicit ordering is unsupported.");
    try {
      const perspective = decisionBasisAtRecords(state.history, requirement.decisionId, outcome.id).historical;
      require(perspective.basis !== null && perspective.pendingReview?.id === review.id, "The referenced deferral must preserve an active decision basis and its unresolved review.");
    } catch (error) {
      if (!(error instanceof RangeError) && !(error instanceof ReferenceError)) throw error;
      require(false, error.message);
    }
  });
  state.resolutions.forEach((resolution, index: number): void => {
    const previous = state.resolutions[index - 1], time = Date.parse(resolution.recordedAt);
    require(previous === undefined || time >= Date.parse(previous.recordedAt), "Requirement resolutions retain global append chronology.");
    const requirement = state.requirements.find((item): boolean => item.id === resolution.requirementId);
    const candidateIndex = state.history.sources.findIndex((event): boolean => event.id === resolution.sourceEventId), candidate = state.history.sources[candidateIndex];
    require(requirement !== undefined && candidate !== undefined, "A resolution requires its exact evidence requirement and an existing canonical capture.");
    if (requirement === undefined || candidate === undefined) return;
    const attempts = state.resolutions.slice(0, index).filter((item): boolean => item.requirementId === requirement.id), last = attempts.at(-1);
    const priorIndex = state.history.sources.findIndex((event): boolean => event.id === (last?.sourceEventId ?? requirement.sourceEventId));
    require(last?.result !== "satisfied", "A satisfied evidence requirement is terminal; preserve it rather than appending another resolution.");
    require(candidateIndex > priorIndex && Date.parse(candidate.recordedAt) >= Date.parse(requirement.recordedAt), "Resolution evidence must be a strictly later capture than the frozen target and every prior attempt, recorded at or after the requirement.");
    require(resolution.evidenceId === candidate.evidence.id && candidate.evidence.sourceId === requirement.sourceId, "Resolution source and evidence references must identify the exact same canonical capture.");
    require(resolution.actor === requirement.actor, "Only the assigned fictional reviewer can record this requirement's resolution.");
    require(time >= Date.parse(requirement.recordedAt) && time >= Date.parse(candidate.recordedAt) && (last === undefined || time >= Date.parse(last.recordedAt)), "A resolution cannot predate its requirement, referenced capture or earlier attempt.");
    require(resolution.result !== "satisfied" || candidate.evidence.environment === "Production", "Satisfaction requires a declared Production context. Unknown or Sandbox cannot satisfy this requirement, and no declaration proves runtime behavior or approval.");
  });
}

/** Operational histories retain their original three-decision validation; focused packets validate separately. */
export const UncertaintyStateSchema = UncertaintyFieldsSchema.superRefine(validateUncertaintyJournal);

/** Explicit enrollment creates a separate continuation; its nested original workspace identity remains unchanged. */
export function createUncertaintyState(history: ClarificationState, id: string, createdAt: string): UncertaintyState {
  const current = ClarificationStateSchema.parse(history);
  requireAppendTime(historyTimes(current), createdAt);
  return UncertaintyStateSchema.parse({ schemaVersion: 7, id, createdAt, history: current, requirements: [], resolutions: [] });
}
export function appendUncertaintyRequirement(state: UncertaintyState, decisionId: string, input: RequirementInput, id: string, recordedAt: string): UncertaintyState {
  const current = UncertaintyStateSchema.parse(state), data = RequirementInputSchema.parse(input), review = eligibleUncertaintyReview(current, decisionId);
  if (review === null) throw new RangeError("Select an active Production-scope review whose frozen context is Unknown and latest outcome is Defer; a review can receive one requirement only.");
  if (data.actor !== review.actor) throw new RangeError("Only the assigned fictional reviewer can create this evidence requirement. No event was recorded.");
  const outcome = current.history.outcomes.filter((item): boolean => item.reviewId === review.id).at(-1);
  if (outcome === undefined) throw new ReferenceError("A recorded deferral is required before creating an evidence requirement.");
  requireAppendTime(uncertaintyRecordTimes(current), recordedAt);
  return UncertaintyStateSchema.parse({ ...current, requirements: [...current.requirements, { ...data, id, recordedAt, kind: "declare-deployment-context", field: "environment", expectedEnvironment: "Production", decisionId: review.decisionId, assumptionId: review.assumptionId, sourceId: current.history.source.id, reviewId: review.id, deferredOutcomeId: outcome.id, sourceEventId: review.sourceEventId, evidenceId: review.evidenceId }] });
}
export function appendUncertaintyResolution(state: UncertaintyState, requirementId: string, input: ResolutionInput, id: string, recordedAt: string): UncertaintyState {
  const current = UncertaintyStateSchema.parse(state), data = ResolutionInputSchema.parse(input), requirement = requireRequirement(current, requirementId);
  if (data.actor !== requirement.actor) throw new RangeError("Only the assigned fictional reviewer can resolve this evidence requirement. No event was recorded.");
  const candidate = uncertaintyResolutionCandidates(current, requirementId).find((event): boolean => event.id === data.sourceEventId);
  if (candidate === undefined) throw new RangeError("Choose a capture recorded at or after this requirement and strictly later than its frozen target and previous attempt; satisfied requirements cannot receive another resolution.");
  if (data.result === "satisfied" && candidate.evidence.environment !== "Production") throw new RangeError("This capture declares Unknown or Sandbox. Satisfaction requires a declared Production context; no resolution was recorded.");
  requireAppendTime(uncertaintyRecordTimes(current), recordedAt);
  return UncertaintyStateSchema.parse({ ...current, resolutions: [...current.resolutions, { ...data, id, requirementId, evidenceId: candidate.evidence.id, recordedAt }] });
}
export function updateUncertaintyHistory(state: UncertaintyState, nextHistory: ClarificationState): UncertaintyState {
  const current = UncertaintyStateSchema.parse(state), history = ClarificationStateSchema.parse(nextHistory);
  if (!sameHistoryPrefix(current.history, history)) throw new RangeError("The uncertainty continuation preserves every original record and append prefix. Existing evidence, decisions, reviews, outcomes and replacements cannot be changed.");
  const addedTimes: readonly string[] = [
    ...history.sources.slice(current.history.sources.length).map((event): string => event.recordedAt),
    ...history.reviews.slice(current.history.reviews.length).map((review): string => review.openedAt),
    ...history.outcomes.slice(current.history.outcomes.length).map((outcome): string => outcome.recordedAt),
    ...history.replacements.slice(current.history.replacements.length).map((event): string => event.recordedAt),
  ];
  for (const time of addedTimes) requireAppendTime(uncertaintyRecordTimes(current), time);
  return UncertaintyStateSchema.parse({ ...current, history });
}

/** Storage and pure updates use the same exact prefix contract; no normalization or conflict replacement is allowed. */
export function requireUncertaintyPrefix(previous: UncertaintyState, next: UncertaintyState): void {
  if (previous.id !== next.id || previous.createdAt !== next.createdAt || !sameHistoryPrefix(previous.history, next.history)
    || JSON.stringify(previous.requirements) !== JSON.stringify(next.requirements.slice(0, previous.requirements.length))
    || JSON.stringify(previous.resolutions) !== JSON.stringify(next.resolutions.slice(0, previous.resolutions.length))) throw new RangeError("Uncertainty continuation identity, original records, requirements and resolutions are immutable. Append new records instead.");
}
