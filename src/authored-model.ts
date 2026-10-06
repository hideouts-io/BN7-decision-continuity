import { z } from "zod";
import { OutcomeSchema, PermissionSchema } from "./scenario.ts";

const narrative = (minimum: number, maximum: number): z.ZodString => z.string().min(minimum).max(maximum).refine((value: string): boolean => value === value.trim(), "Remove leading or trailing whitespace; historical text is never silently normalized.");
const PermissionsSchema = z.array(PermissionSchema).min(1).refine((values): boolean => new Set(values).size === values.length, "Permissions must be unique.");
export const FictionalActorSchema = z.string().regex(/^[A-Z][A-Z0-9_-]{1,31}$/, "Use a fictional reviewer code of 2–32 uppercase letters, digits, underscores or hyphens.");
const EvidenceSchema = z.object({
  id: z.uuid(), sourceId: z.uuid(), capturedAt: z.iso.datetime(), sourceNote: narrative(16, 1000),
  requestedPermissions: PermissionsSchema, grantedPermissions: PermissionsSchema,
  observedActivity: z.literal("Not observed"), provenance: z.literal("Synthetic"),
});
const SourceEventSchema = z.object({ id: z.uuid(), recordedAt: z.iso.datetime(), evidence: EvidenceSchema });
export const AuthoredDecisionSchema = z.object({
  id: z.uuid(), title: narrative(3, 120), revision: z.string(), statement: narrative(16, 1000),
  rationale: narrative(16, 2000), actor: FictionalActorSchema, decidedAt: z.iso.datetime(), assumptionId: z.uuid(), evidenceId: z.uuid(),
});
export const AuthoredReviewInputSchema = z.object({
  actor: FictionalActorSchema, outcome: OutcomeSchema, rationale: narrative(16, 2000), statement: narrative(16, 1000),
});
const ReviewSchema = z.object({
  id: z.uuid(), decisionId: z.uuid(), assumptionId: z.uuid(), actor: FictionalActorSchema, openedAt: z.iso.datetime(),
  sourceEventId: z.uuid(), baseline: EvidenceSchema, changed: EvidenceSchema,
});
const OutcomeRecordSchema = AuthoredReviewInputSchema.extend({
  id: z.uuid(), reviewId: z.uuid(), sourceEventId: z.uuid(), revision: z.string(), recordedAt: z.iso.datetime(), baseline: EvidenceSchema, changed: EvidenceSchema,
});
export const AuthoredStateSchema = z.object({
  schemaVersion: z.literal(3), id: z.uuid(), source: z.object({ id: z.uuid(), name: narrative(3, 120) }),
  originalDecision: AuthoredDecisionSchema,
  assumption: z.object({ id: z.uuid(), decisionId: z.uuid(), sourceId: z.uuid(), baselineId: z.uuid(), rule: z.literal("request-remains-read-only"), description: narrative(16, 1000) }),
  sources: z.array(SourceEventSchema).min(1).max(2), review: ReviewSchema.nullable(), outcomes: z.array(OutcomeRecordSchema),
}).superRefine((state, context): void => {
  function require(condition: boolean, message: string): void {
    if (!condition) context.addIssue({ code: "custom", message });
  }
  const baseline = state.sources[0];
  if (baseline === undefined) return; // The array schema reports a missing baseline.
  const decision = state.originalDecision;
  require(decision.revision === `${decision.id}.1`, "The original decision must retain revision 1.");
  require(decision.evidenceId === baseline.evidence.id && decision.assumptionId === state.assumption.id, "The original decision must reference its exact baseline and assumption.");
  require(state.assumption.decisionId === decision.id && state.assumption.sourceId === state.source.id && state.assumption.baselineId === baseline.evidence.id, "Assumption relationships must match the decision, source and baseline.");
  require(decision.decidedAt === baseline.recordedAt, "The original approval and baseline record must share the creation time.");
  require(baseline.evidence.requestedPermissions.length === 1 && baseline.evidence.requestedPermissions[0] === "documents:read", "The original basis must request documents:read only.");
  const entityIds: string[] = [state.id, state.source.id, decision.id, state.assumption.id, ...state.sources.flatMap((event): string[] => [event.id, event.evidence.id]), ...state.outcomes.map((outcome): string => outcome.id), ...(state.review === null ? [] : [state.review.id])];
  require(new Set(entityIds).size === entityIds.length, "Each entity and event must have a distinct UUID.");
  state.sources.forEach((event, index: number): void => {
    require(event.evidence.sourceId === state.source.id, "Evidence must reference the declared source.");
    require(Date.parse(event.evidence.capturedAt) <= Date.parse(event.recordedAt), "Evidence capture cannot be later than its recording time.");
    const previous = state.sources[index - 1];
    if (previous !== undefined) {
      require(Date.parse(event.recordedAt) >= Date.parse(previous.recordedAt) && Date.parse(event.evidence.capturedAt) >= Date.parse(previous.evidence.capturedAt), "Source versions must preserve capture and recording chronology.");
    }
  });
  const changed = state.sources[1];
  const review = state.review;
  if (review === null) require(state.outcomes.length === 0, "Outcomes require an explicitly opened review.");
  else {
    require(changed !== undefined && changed.evidence.requestedPermissions.includes("documents:write"), "A review requires a later write request that contradicts the read-only request rule.");
    require(review.decisionId === decision.id && review.assumptionId === state.assumption.id && review.actor === decision.actor, "The review must reference the exact decision, assumption and assigned fictional reviewer.");
    require(review.sourceEventId === changed?.id && JSON.stringify(review.baseline) === JSON.stringify(baseline.evidence) && JSON.stringify(review.changed) === JSON.stringify(changed?.evidence), "Review evidence must match the immutable source snapshots.");
    require(changed !== undefined && Date.parse(review.openedAt) >= Date.parse(changed.recordedAt), "Review time cannot predate its source event.");
    state.outcomes.forEach((outcome, index: number): void => {
      require(outcome.reviewId === review.id && outcome.sourceEventId === review.sourceEventId && outcome.actor === review.actor, "Outcome responsibility and references must match its review.");
      require(JSON.stringify(outcome.baseline) === JSON.stringify(review.baseline) && JSON.stringify(outcome.changed) === JSON.stringify(review.changed), "Outcome evidence must preserve the exact review snapshots.");
      require(outcome.revision === `${decision.id}.${index + 2}`, "Outcome revisions must be consecutive and append-only.");
      const previous = state.outcomes[index - 1];
      require(Date.parse(outcome.recordedAt) >= Date.parse(previous?.recordedAt ?? review.openedAt), "An outcome cannot predate its review or prior outcome.");
      require(previous === undefined || previous.outcome === "defer", "A terminal outcome cannot be followed by another outcome.");
    });
  }
});
export type AuthoredState = z.infer<typeof AuthoredStateSchema>;
export type AuthoredEvidence = z.infer<typeof EvidenceSchema>;
export type AuthoredReviewInput = z.infer<typeof AuthoredReviewInputSchema>;
export const AuthoredCreationInputSchema = z.object({
  title: narrative(3, 120), statement: narrative(16, 1000), rationale: narrative(16, 2000), actor: FictionalActorSchema,
  assumption: narrative(16, 1000), sourceName: narrative(3, 120), capturedAt: z.iso.datetime(), sourceNote: narrative(16, 1000), grantedPermissions: PermissionsSchema,
});
export type AuthoredCreationInput = z.infer<typeof AuthoredCreationInputSchema>;
export const AuthoredEvidenceInputSchema = EvidenceSchema.omit({ id: true, sourceId: true, observedActivity: true, provenance: true });
export type AuthoredEvidenceInput = z.infer<typeof AuthoredEvidenceInputSchema>;
export type CreationIds = Readonly<{ session: string; decision: string; assumption: string; source: string; event: string; evidence: string }>;

/** Create a synthetic approval with an explicit structured rule; prose does not execute a rule. */
export function createAuthoredState(input: AuthoredCreationInput, ids: CreationIds, recordedAt: string): AuthoredState {
  const data: AuthoredCreationInput = AuthoredCreationInputSchema.parse(input);
  const evidence: AuthoredEvidence = { id: ids.evidence, sourceId: ids.source, capturedAt: data.capturedAt, sourceNote: data.sourceNote, requestedPermissions: ["documents:read"], grantedPermissions: data.grantedPermissions, observedActivity: "Not observed", provenance: "Synthetic" };
  return AuthoredStateSchema.parse({
    schemaVersion: 3, id: ids.session, source: { id: ids.source, name: data.sourceName },
    originalDecision: { id: ids.decision, title: data.title, revision: `${ids.decision}.1`, statement: data.statement, rationale: data.rationale, actor: data.actor, decidedAt: recordedAt, assumptionId: ids.assumption, evidenceId: ids.evidence },
    assumption: { id: ids.assumption, decisionId: ids.decision, sourceId: ids.source, baselineId: ids.evidence, rule: "request-remains-read-only", description: data.assumption },
    sources: [{ id: ids.event, recordedAt, evidence }], review: null, outcomes: [],
  });
}

export function appendAuthoredEvidence(state: AuthoredState, input: AuthoredEvidenceInput, eventId: string, evidenceId: string, recordedAt: string): AuthoredState {
  const current: AuthoredState = AuthoredStateSchema.parse(state);
  if (current.sources.length !== 1) throw new RangeError("This version supports one later capture per decision. Existing evidence cannot be replaced.");
  const data = AuthoredEvidenceInputSchema.parse(input);
  return AuthoredStateSchema.parse({ ...current, sources: [...current.sources, { id: eventId, recordedAt, evidence: { ...data, id: evidenceId, sourceId: current.source.id, observedActivity: "Not observed", provenance: "Synthetic" } }] });
}

export function openAuthoredReview(state: AuthoredState, id: string, openedAt: string): AuthoredState {
  const current = AuthoredStateSchema.parse(state);
  if (current.review !== null) throw new RangeError("A review already exists. Preserve it and record an outcome.");
  const baseline = current.sources[0];
  const changed = current.sources[1];
  if (baseline === undefined || changed === undefined) throw new ReferenceError("Capture a later source version before opening a review.");
  return AuthoredStateSchema.parse({ ...current, review: { id, openedAt, decisionId: current.originalDecision.id, assumptionId: current.assumption.id, actor: current.originalDecision.actor, sourceEventId: changed.id, baseline: baseline.evidence, changed: changed.evidence } });
}

export function appendAuthoredOutcome(state: AuthoredState, input: AuthoredReviewInput, id: string, recordedAt: string): AuthoredState {
  const current = AuthoredStateSchema.parse(state);
  const review = current.review;
  if (review === null) throw new ReferenceError("Open an accountable review before recording an outcome.");
  const data = AuthoredReviewInputSchema.parse(input);
  return AuthoredStateSchema.parse({ ...current, outcomes: [...current.outcomes, { ...data, id, recordedAt, reviewId: review.id, sourceEventId: review.sourceEventId, revision: `${current.originalDecision.id}.${current.outcomes.length + 2}`, baseline: review.baseline, changed: review.changed }] });
}
