import { z } from "zod";
import { AuthoredDecisionSchema, AuthoredStateSchema, FictionalActorSchema, createAuthoredState } from "./authored-model.ts";
import type { AuthoredCreationInput, CreationIds } from "./authored-model.ts";
import { OutcomeSchema } from "./scenario.ts";

/** These are invented manifest permissions, not verified permissions of an external system. */
export const ContinuityPermissionSchema = z.enum(["documents:read", "documents:write", "documents:delete"]);
export type ContinuityPermission = z.infer<typeof ContinuityPermissionSchema>;
const PermissionsSchema = z.array(ContinuityPermissionSchema).min(1).refine((values): boolean => new Set(values).size === values.length, "Declare each permission once.");
export const ContinuityEvidenceSchema = AuthoredStateSchema.shape.sources.element.shape.evidence.extend({ requestedPermissions: PermissionsSchema, grantedPermissions: PermissionsSchema });
const SourceEventSchema = z.object({ id: z.uuid(), recordedAt: z.iso.datetime(), evidence: ContinuityEvidenceSchema });
const BasisSchema = z.object({
  revision: z.string(), statement: AuthoredDecisionSchema.shape.statement, rationale: AuthoredDecisionSchema.shape.rationale,
  actor: FictionalActorSchema, decidedAt: z.iso.datetime(), sourceEventId: z.uuid(), evidence: ContinuityEvidenceSchema, approvedRequestedPermissions: PermissionsSchema,
});
const ReviewSchema = z.object({
  id: z.uuid(), decisionId: z.uuid(), assumptionId: z.uuid(), actor: FictionalActorSchema,
  openedAt: z.iso.datetime(), sourceEventId: z.uuid(), basis: BasisSchema, changed: ContinuityEvidenceSchema,
});
export const ContinuityOutcomeInputSchema = z.object({
  actor: FictionalActorSchema, outcome: OutcomeSchema, rationale: AuthoredDecisionSchema.shape.rationale, statement: AuthoredDecisionSchema.shape.statement,
  approvedRequestedPermissions: PermissionsSchema.nullable(),
}).superRefine((input, context): void => {
  if ((input.outcome === "revise") !== (input.approvedRequestedPermissions !== null)) context.addIssue({ code: "custom", message: "A revision requires an explicit next request boundary. Other outcomes must not silently change that boundary." });
});
const OutcomeRecordSchema = ContinuityOutcomeInputSchema.safeExtend({
  id: z.uuid(), reviewId: z.uuid(), sourceEventId: z.uuid(), revision: z.string(), recordedAt: z.iso.datetime(), basis: BasisSchema, changed: ContinuityEvidenceSchema,
});
const StateFieldsSchema = z.object({
  schemaVersion: z.literal(4), id: z.uuid(), source: AuthoredStateSchema.shape.source, originalDecision: AuthoredDecisionSchema,
  assumption: AuthoredStateSchema.shape.assumption.extend({ rule: z.literal("requested-permissions-within-boundary") }),
  sources: z.array(SourceEventSchema).min(1), reviews: z.array(ReviewSchema), outcomes: z.array(OutcomeRecordSchema),
});
export type ContinuityState = z.infer<typeof StateFieldsSchema>;
export type ContinuityEvidence = z.infer<typeof ContinuityEvidenceSchema>;
export type ContinuityBasis = z.infer<typeof BasisSchema>;
export type ContinuityReview = z.infer<typeof ReviewSchema>;
export type ContinuityOutcome = z.infer<typeof OutcomeRecordSchema>;
export type ContinuityOutcomeInput = z.infer<typeof ContinuityOutcomeInputSchema>;
export const ContinuityEvidenceInputSchema = ContinuityEvidenceSchema.omit({ id: true, sourceId: true, provenance: true, observedActivity: true });
export type ContinuityEvidenceInput = z.infer<typeof ContinuityEvidenceInputSchema>;

export function samePermissions(left: readonly ContinuityPermission[], right: readonly ContinuityPermission[]): boolean {
  return left.length === right.length && left.every((permission): boolean => right.includes(permission));
}
function originalBasis(state: ContinuityState): ContinuityBasis {
  const event = state.sources[0];
  if (event === undefined) throw new ReferenceError("The original approval requires a baseline source event.");
  return { revision: state.originalDecision.revision, statement: state.originalDecision.statement, rationale: state.originalDecision.rationale, actor: state.originalDecision.actor, decidedAt: state.originalDecision.decidedAt, sourceEventId: event.id, evidence: event.evidence, approvedRequestedPermissions: ["documents:read"] };
}
function resolvedBasis(outcome: ContinuityOutcome): ContinuityBasis | null {
  if (outcome.outcome === "withdraw") return null;
  if (outcome.outcome === "defer") throw new RangeError("A deferral is not a resolved approval basis.");
  const permissions = outcome.outcome === "revise" ? outcome.approvedRequestedPermissions : outcome.basis.approvedRequestedPermissions;
  if (permissions === null) throw new ReferenceError("A revised outcome must declare its next request boundary.");
  return { revision: outcome.revision, statement: outcome.statement, rationale: outcome.rationale, actor: outcome.actor, decidedAt: outcome.recordedAt, sourceEventId: outcome.sourceEventId, evidence: outcome.changed, approvedRequestedPermissions: permissions };
}
export function applicableBasis(state: ContinuityState): ContinuityBasis | null {
  const resolved = state.outcomes.filter((outcome): boolean => outcome.outcome !== "defer").at(-1);
  return resolved === undefined ? originalBasis(state) : resolvedBasis(resolved);
}
export function pendingReview(state: ContinuityState): ContinuityReview | null {
  const review = state.reviews.at(-1);
  if (review === undefined) return null;
  const latest = state.outcomes.filter((outcome): boolean => outcome.reviewId === review.id).at(-1);
  return latest === undefined || latest.outcome === "defer" ? review : null;
}
export function reviewNeeded(basis: ContinuityBasis, evidence: ContinuityEvidence): boolean {
  return !samePermissions(basis.evidence.requestedPermissions, evidence.requestedPermissions)
    && evidence.requestedPermissions.some((permission): boolean => !basis.approvedRequestedPermissions.includes(permission));
}

export const ContinuityStateSchema = StateFieldsSchema.superRefine((state, context): void => {
  function require(condition: boolean, message: string): void { if (!condition) context.addIssue({ code: "custom", message }); }
  const baseline = state.sources[0];
  if (baseline === undefined) return;
  const decision = state.originalDecision;
  require(decision.revision === `${decision.id}.1` && decision.decidedAt === baseline.recordedAt, "Original revision and recording time must preserve the baseline approval.");
  require(decision.assumptionId === state.assumption.id && decision.evidenceId === baseline.evidence.id
    && state.assumption.decisionId === decision.id && state.assumption.sourceId === state.source.id && state.assumption.baselineId === baseline.evidence.id, "Original decision and assumption must reference their exact source and baseline.");
  require(samePermissions(baseline.evidence.requestedPermissions, ["documents:read"]), "The original basis must request documents:read only.");
  const ids: string[] = [state.id, state.source.id, decision.id, state.assumption.id, ...state.sources.flatMap((event): string[] => [event.id, event.evidence.id]), ...state.reviews.map((review): string => review.id), ...state.outcomes.map((outcome): string => outcome.id)];
  require(new Set(ids).size === ids.length, "All entity and event UUIDs must be distinct.");
  state.sources.forEach((event, index: number): void => {
    require(event.evidence.sourceId === state.source.id, "Captured evidence must reference the recorded source.");
    require(Date.parse(event.evidence.capturedAt) <= Date.parse(event.recordedAt), "A capture cannot be recorded before its evidence time.");
    const previous = state.sources[index - 1];
    if (previous !== undefined) require(Date.parse(event.recordedAt) >= Date.parse(previous.recordedAt) && Date.parse(event.evidence.capturedAt) >= Date.parse(previous.evidence.capturedAt), "Source captures must preserve chronological order.");
  });
  let expectedBasis: ContinuityBasis | null = originalBasis(state);
  let previousTarget = 0;
  let outcomeIndex = 0;
  let previousResolutionAt: string = baseline.recordedAt;
  state.reviews.forEach((review): void => {
    const targetIndex: number = state.sources.findIndex((event): boolean => event.id === review.sourceEventId);
    const target = state.sources[targetIndex];
    require(targetIndex > previousTarget && target !== undefined, "Each review must target a distinct later source event in order.");
    require(expectedBasis !== null && JSON.stringify(review.basis) === JSON.stringify(expectedBasis), "Review must preserve the exact applicable decision basis, including its accepted request boundary.");
    require(review.decisionId === decision.id && review.assumptionId === state.assumption.id && review.actor === decision.actor, "Review responsibility and dependency references must match the original decision.");
    require(target !== undefined && JSON.stringify(review.changed) === JSON.stringify(target.evidence), "Review must preserve its exact target evidence snapshot.");
    require(target !== undefined && Date.parse(review.openedAt) >= Date.parse(target.recordedAt) && Date.parse(target.recordedAt) >= Date.parse(previousResolutionAt), "Review and target must follow the previous resolution and source capture.");
    require(expectedBasis !== null && reviewNeeded(expectedBasis, review.changed), "The reviewed capture must change the request and exceed the applicable request boundary.");
    // A later capture cannot already exist when this review opens, even at equal milliseconds.
    const following = state.sources[targetIndex + 1];
    const records = state.outcomes.filter((outcome): boolean => outcome.reviewId === review.id);
    const terminal = records.at(-1);
    require(following === undefined || (terminal !== undefined && terminal.outcome !== "defer" && terminal.outcome !== "withdraw" && Date.parse(following.recordedAt) >= Date.parse(terminal.recordedAt)), "Additional captures require resolution of the prior review; withdrawal ends the active approval.");
    let precedingTime: string = review.openedAt;
    records.forEach((outcome, index: number): void => {
      require(state.outcomes[outcomeIndex]?.id === outcome.id && outcome.revision === `${decision.id}.${outcomeIndex + 2}`, "Outcomes must be ordered by review and consecutive global revision.");
      outcomeIndex += 1;
      require(outcome.actor === review.actor && outcome.sourceEventId === review.sourceEventId && JSON.stringify(outcome.basis) === JSON.stringify(review.basis) && JSON.stringify(outcome.changed) === JSON.stringify(review.changed), "Outcome must retain its assigned reviewer, exact source event, decision basis and evidence.");
      require(Date.parse(outcome.recordedAt) >= Date.parse(precedingTime), "Outcome time cannot predate its review or earlier outcome.");
      const previous = records[index - 1];
      require(previous === undefined || previous.outcome === "defer", "A terminal outcome cannot receive another outcome for the same review.");
      precedingTime = outcome.recordedAt;
    });
    if (terminal === undefined || terminal.outcome === "defer") require(review.id === state.reviews.at(-1)?.id, "An unresolved review cannot be followed by another review.");
    else {
      if (terminal.outcome !== "revise" || terminal.approvedRequestedPermissions !== null) expectedBasis = resolvedBasis(terminal);
      previousResolutionAt = terminal.recordedAt;
    }
    previousTarget = targetIndex;
  });
  require(outcomeIndex === state.outcomes.length, "Every outcome requires an exact recorded review.");
});

export function createContinuityState(input: AuthoredCreationInput, ids: CreationIds, recordedAt: string): ContinuityState {
  const original = createAuthoredState(input, ids, recordedAt);
  return ContinuityStateSchema.parse({ schemaVersion: 4, id: original.id, source: original.source, originalDecision: original.originalDecision, assumption: { ...original.assumption, rule: "requested-permissions-within-boundary" }, sources: original.sources, reviews: [], outcomes: [] });
}
export function appendContinuityEvidence(state: ContinuityState, input: ContinuityEvidenceInput, eventId: string, evidenceId: string, recordedAt: string): ContinuityState {
  const current = ContinuityStateSchema.parse(state);
  if (pendingReview(current) !== null) throw new RangeError("Resolve the open review before capturing another version. A deferral does not resolve it.");
  if (applicableBasis(current) === null) throw new RangeError("The approval was withdrawn. Its history stays intact; create another synthetic decision for a new approval.");
  const data = ContinuityEvidenceInputSchema.parse(input);
  return ContinuityStateSchema.parse({ ...current, sources: [...current.sources, { id: eventId, recordedAt, evidence: { ...data, id: evidenceId, sourceId: current.source.id, provenance: "Synthetic", observedActivity: "Not observed" } }] });
}
export function openContinuityReview(state: ContinuityState, id: string, openedAt: string): ContinuityState {
  const current = ContinuityStateSchema.parse(state);
  if (pendingReview(current) !== null) throw new RangeError("Resolve the current review before opening another.");
  const basis = applicableBasis(current);
  const event = current.sources.at(-1);
  if (basis === null || event === undefined) throw new ReferenceError("An active approval and captured source are required for reassessment.");
  return ContinuityStateSchema.parse({ ...current, reviews: [...current.reviews, { id, openedAt, actor: current.originalDecision.actor, decisionId: current.originalDecision.id, assumptionId: current.assumption.id, sourceEventId: event.id, basis, changed: event.evidence }] });
}
export function appendContinuityOutcome(state: ContinuityState, input: ContinuityOutcomeInput, id: string, recordedAt: string): ContinuityState {
  const current = ContinuityStateSchema.parse(state);
  const review = pendingReview(current);
  if (review === null) throw new ReferenceError("Open a review with a relevant change before recording an outcome.");
  const data = ContinuityOutcomeInputSchema.parse(input);
  return ContinuityStateSchema.parse({ ...current, outcomes: [...current.outcomes, { ...data, id, recordedAt, reviewId: review.id, sourceEventId: review.sourceEventId, basis: review.basis, changed: review.changed, revision: `${current.originalDecision.id}.${current.outcomes.length + 2}` }] });
}
