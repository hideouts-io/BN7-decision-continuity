import { z } from "zod";
import { AuthoredDecisionSchema, FictionalActorSchema } from "./authored-model.ts";
import { ContinuityEvidenceSchema, samePermissions } from "./continuity-model.ts";
import { OutcomeSchema } from "./scenario.ts";

export const EnvironmentSchema = z.enum(["Unknown", "Sandbox", "Production"]);
export const SharedEvidenceSchema = ContinuityEvidenceSchema.extend({ environment: EnvironmentSchema });
const SourceEventSchema = z.object({ id: z.uuid(), recordedAt: z.iso.datetime(), evidence: SharedEvidenceSchema });
const PermissionsSchema = ContinuityEvidenceSchema.shape.requestedPermissions;
const AssumptionSchema = z.object({
  id: z.uuid(), sourceId: z.uuid(), baselineId: z.uuid(), decisionId: z.uuid(),
  field: z.enum(["requestedPermissions", "grantedPermissions"]), scope: z.enum(["Any", "Production"]),
  acceptedPermissions: PermissionsSchema, description: AuthoredDecisionSchema.shape.rationale,
});
const DecisionRecordSchema = z.object({ decision: AuthoredDecisionSchema, assumption: AssumptionSchema });
const BasisSchema = AuthoredDecisionSchema.omit({ id: true, title: true, assumptionId: true }).extend({ sourceEventId: z.uuid(), acceptedPermissions: PermissionsSchema });
export const SharedOutcomeInputSchema = z.object({
  actor: FictionalActorSchema, outcome: OutcomeSchema,
  rationale: AuthoredDecisionSchema.shape.rationale, statement: AuthoredDecisionSchema.shape.statement,
  acceptedPermissions: PermissionsSchema.nullable(),
}).superRefine((input, context): void => {
  if ((input.outcome === "revise") !== (input.acceptedPermissions !== null)) context.addIssue({ code: "custom", message: "Revise requires an explicit next boundary for the decision's monitored field. Other outcomes cannot change the boundary." });
});
const ReviewSchema = z.object({
  id: z.uuid(), decisionId: z.uuid(), assumptionId: z.uuid(), actor: FictionalActorSchema, openedAt: z.iso.datetime(),
  sourceEventId: z.uuid(), evidenceId: z.uuid(), basis: BasisSchema, trigger: z.enum(["affected", "unresolved"]),
});
const OutcomeRecordSchema = SharedOutcomeInputSchema.safeExtend({
  id: z.uuid(), decisionId: z.uuid(), reviewId: z.uuid(), sourceEventId: z.uuid(), evidenceId: z.uuid(), revision: z.string(), recordedAt: z.iso.datetime(),
});
export const SharedFieldsSchema = z.object({
  schemaVersion: z.literal(5), id: z.uuid(), source: z.object({ id: z.uuid(), name: AuthoredDecisionSchema.shape.title }),
  originalDecisions: z.array(DecisionRecordSchema).length(3), sources: z.array(SourceEventSchema).min(1), reviews: z.array(ReviewSchema), outcomes: z.array(OutcomeRecordSchema),
});
export type SharedState = z.infer<typeof SharedFieldsSchema>;
export type SharedHistory = Omit<SharedState, "schemaVersion">;
export type ReviewReplacementLink = Readonly<{ oldReviewId: string; newReviewId: string; recordedAt: string }>;
export type SharedEvidence = z.infer<typeof SharedEvidenceSchema>;
export type SharedDecision = z.infer<typeof DecisionRecordSchema>;
export type SharedBasis = z.infer<typeof BasisSchema>;
export type SharedReview = z.infer<typeof ReviewSchema>;
export type SharedOutcomeInput = z.infer<typeof SharedOutcomeInputSchema>;
export const SharedEvidenceInputSchema = SharedEvidenceSchema.omit({ id: true, sourceId: true, observedActivity: true, provenance: true });
export type SharedEvidenceInput = z.infer<typeof SharedEvidenceInputSchema>;
export type SharedImpact = Readonly<{ status: "affected" | "unchanged" | "unresolved" | "inactive"; explanation: string }>;

export function sharedDecision(state: SharedHistory, id: string): SharedDecision {
  const record = state.originalDecisions.find((item): boolean => item.decision.id === id);
  if (record === undefined) throw new ReferenceError(`Decision ${id} does not belong to this shared-source workspace.`);
  return record;
}
export function sharedEvidence(state: SharedHistory, id: string): SharedEvidence {
  const event = state.sources.find((item): boolean => item.evidence.id === id);
  if (event === undefined) throw new ReferenceError(`Evidence ${id} has no canonical source capture in this workspace.`);
  return event.evidence;
}
export function sharedBasis(state: SharedHistory, decisionId: string): SharedBasis | null {
  const record = sharedDecision(state, decisionId);
  const outcome = state.outcomes.filter((item): boolean => item.decisionId === decisionId && item.outcome !== "defer").at(-1);
  if (outcome !== undefined) {
    if (outcome.outcome === "withdraw") return null;
    const review = state.reviews.find((item): boolean => item.id === outcome.reviewId);
    if (review === undefined) throw new ReferenceError("A resolved outcome requires its exact review.");
    const permissions = outcome.outcome === "revise" ? outcome.acceptedPermissions : review.basis.acceptedPermissions;
    if (permissions === null) throw new ReferenceError("A revision requires an explicit accepted boundary.");
    return { revision: outcome.revision, statement: outcome.statement, rationale: outcome.rationale, actor: outcome.actor, decidedAt: outcome.recordedAt, evidenceId: outcome.evidenceId, sourceEventId: outcome.sourceEventId, acceptedPermissions: permissions };
  }
  const baseline = state.sources[0];
  if (baseline === undefined) throw new ReferenceError("Original decisions require a canonical baseline.");
  const original = record.decision;
  return { revision: original.revision, statement: original.statement, rationale: original.rationale, actor: original.actor, decidedAt: original.decidedAt, evidenceId: original.evidenceId, sourceEventId: baseline.id, acceptedPermissions: record.assumption.acceptedPermissions };
}
export function sharedPendingReview(state: SharedHistory, decisionId: string): SharedReview | null {
  const review = state.reviews.filter((item): boolean => item.decisionId === decisionId).at(-1);
  if (review === undefined) return null;
  const outcome = state.outcomes.filter((item): boolean => item.reviewId === review.id).at(-1);
  return outcome === undefined || outcome.outcome === "defer" ? review : null;
}

/** Only structured fields and explicit scope execute rules; prose, requests and declarations never establish runtime activity. */
export function sharedImpact(state: SharedHistory, record: SharedDecision, basis: SharedBasis | null, target: SharedEvidence): SharedImpact {
  if (basis === null) return { status: "inactive", explanation: "This decision was withdrawn. Its earlier evidence and outcomes remain preserved." };
  if (record.assumption.scope === "Production" && target.environment === "Unknown") return { status: "unresolved", explanation: "Deployment context is Unknown. This production rule cannot establish applicability; it supplies no approval or safety conclusion." };
  if (record.assumption.scope === "Production" && target.environment !== "Production") return { status: "unchanged", explanation: "This capture declares Sandbox. The production rule is outside this declared scope; it supplies no production assurance." };
  const previousEvidence = sharedEvidence(state, basis.evidenceId);
  if (record.assumption.scope === "Production" && previousEvidence.environment !== "Production") return { status: "affected", explanation: "Production applicability is now declared, while the applicable basis used another or Unknown context. Reassess the newly applicable production hold; this declaration supplies no approval or runtime assurance." };
  const previous = previousEvidence[record.assumption.field];
  const current = target[record.assumption.field];
  const exceeds: boolean = current.some((permission): boolean => !basis.acceptedPermissions.includes(permission));
  if (exceeds) return { status: "affected", explanation: `${record.assumption.field === "requestedPermissions" ? "Requested access" : "Declared grants"} exceeds the applicable accepted boundary. ${samePermissions(previous, current) ? "The earlier reassessment retained this unresolved boundary mismatch." : "The monitored permissions changed."} A person must reassess; no access or runtime behavior is inferred.` };
  return { status: "unchanged", explanation: `${record.assumption.field === "requestedPermissions" ? "Requested access" : "Declared granted access"} ${samePermissions(previous, current) ? "is unchanged" : "changed within the accepted boundary"}. No relevant change under this explicit rule; this is not a safety or approval conclusion.` };
}

/** Validate immutable records, append chronology and review semantics shared by complete workspaces and focused archives. */
export function validateSharedRecordHistory(state: SharedHistory, replacements: readonly ReviewReplacementLink[], context: z.RefinementCtx): void {
  function require(condition: boolean, message: string): void { if (!condition) context.addIssue({ code: "custom", message }); }
  const baseline = state.sources[0];
  if (baseline === undefined) return;
  const ids: string[] = [state.id, state.source.id, ...state.originalDecisions.flatMap((record): string[] => [record.decision.id, record.assumption.id]), ...state.sources.flatMap((event): string[] => [event.id, event.evidence.id]), ...state.reviews.map((item): string => item.id), ...state.outcomes.map((item): string => item.id)];
  require(new Set(ids).size === ids.length, "All shared entities, evidence, reviews and outcomes require distinct UUIDs.");
  require(samePermissions(baseline.evidence.requestedPermissions, ["documents:read"]) && samePermissions(baseline.evidence.grantedPermissions, ["documents:read"]) && baseline.evidence.environment === "Unknown", "The synthetic baseline must preserve read-only requests, independent read-only grants and Unknown deployment context.");
  state.sources.forEach((event, index: number): void => {
    require(event.evidence.sourceId === state.source.id, "Every capture must reference the same canonical source.");
    require(Date.parse(event.evidence.capturedAt) <= Date.parse(event.recordedAt), "Source recording cannot predate capture time.");
    const previous = state.sources[index - 1];
    if (previous !== undefined) require(Date.parse(event.recordedAt) >= Date.parse(previous.recordedAt) && Date.parse(event.evidence.capturedAt) >= Date.parse(previous.evidence.capturedAt), "Shared captures must preserve recording and capture chronology.");
  });
  state.originalDecisions.forEach((record): void => {
    const decision = record.decision, assumption = record.assumption;
    require(decision.revision === `${decision.id}.1` && decision.decidedAt === baseline.recordedAt, "Every original decision retains revision 1 and its baseline record time.");
    require(decision.assumptionId === assumption.id && decision.evidenceId === baseline.evidence.id && assumption.decisionId === decision.id && assumption.sourceId === state.source.id && assumption.baselineId === baseline.evidence.id, "Decisions and assumptions must reference their exact shared baseline and source.");
    require(samePermissions(assumption.acceptedPermissions, ["documents:read"]), "Original accepted boundaries must remain read-only.");
    let history: SharedHistory = { ...state, reviews: [], outcomes: [] };
    let previousTarget = -1;
    let previousResolution: string = baseline.recordedAt;
    const reviews = state.reviews.filter((review): boolean => review.decisionId === decision.id);
    let outcomeCount = 0;
    reviews.forEach((review, reviewIndex: number): void => {
      const expected = sharedBasis(history, decision.id);
      const targetIndex: number = state.sources.findIndex((event): boolean => event.id === review.sourceEventId);
      const target = state.sources[targetIndex];
      require(target !== undefined && targetIndex > previousTarget && review.evidenceId === target.evidence.id, "Each decision review must target an exact, successively later canonical capture.");
      require(expected !== null && JSON.stringify(review.basis) === JSON.stringify(expected), "A review must freeze the exact applicable decision basis and accepted boundary.");
      require(review.assumptionId === assumption.id && review.actor === decision.actor, "Review must preserve this decision's assumption and assigned fictional reviewer.");
      require(target !== undefined && Date.parse(review.openedAt) >= Date.parse(target.recordedAt) && Date.parse(review.openedAt) >= Date.parse(previousResolution), "Review must follow its capture and the previous decision resolution.");
      const following = state.sources[targetIndex + 1];
      require(following === undefined || Date.parse(following.recordedAt) >= Date.parse(review.openedAt), "A review cannot select a superseded capture that already existed when it opened.");
      if (target !== undefined && expected !== null) require(sharedImpact(state, record, expected, target.evidence).status === review.trigger, "Review trigger must match this decision's explicit rule and scope; unchanged evidence cannot silently create a review.");
      const outcomes = state.outcomes.filter((outcome): boolean => outcome.reviewId === review.id);
      let previousTime: string = review.openedAt;
      outcomes.forEach((outcome, index: number): void => {
        outcomeCount += 1;
        require(outcome.decisionId === decision.id && outcome.actor === review.actor && outcome.sourceEventId === review.sourceEventId && outcome.evidenceId === review.evidenceId, "Outcome responsibility and exact decision, review and capture references must agree.");
        require(outcome.revision === `${decision.id}.${outcomeCount + 1}`, "Each decision's outcomes require consecutive append-only revisions.");
        require(Date.parse(outcome.recordedAt) >= Date.parse(previousTime), "An outcome cannot predate its review or preceding outcome.");
        require(index === 0 || outcomes[index - 1]?.outcome === "defer", "A terminal review outcome cannot be followed by another outcome for that review.");
        require(review.trigger !== "unresolved" || outcome.outcome === "defer" || outcome.outcome === "withdraw", "Unknown applicability permits deferral or withdrawal only. Record clarified evidence before any later approval basis.");
        previousTime = outcome.recordedAt;
      });
      const terminal = outcomes.at(-1);
      const replacement = replacements.find((item): boolean => item.oldReviewId === review.id);
      require(terminal !== undefined && terminal.outcome !== "defer" || reviewIndex === reviews.length - 1 || replacement !== undefined && replacement.newReviewId === reviews[reviewIndex + 1]?.id, "An unresolved review requires an explicit replacement before another review for the same decision.");
      history = { ...history, reviews: [...history.reviews, review], outcomes: [...history.outcomes, ...outcomes] };
      previousTarget = targetIndex;
      if (terminal !== undefined && terminal.outcome !== "defer") previousResolution = terminal.recordedAt;
      if (replacement !== undefined) previousResolution = replacement.recordedAt;
    });
    require(outcomeCount === state.outcomes.filter((outcome): boolean => outcome.decisionId === decision.id).length, "Every decision outcome requires its exact recorded review.");
  });
  require(state.reviews.every((review): boolean => state.originalDecisions.some((record): boolean => record.decision.id === review.decisionId)), "Every review must belong to a recorded decision.");
  require(state.outcomes.every((outcome): boolean => state.reviews.some((review): boolean => review.id === outcome.reviewId)), "Every outcome must belong to a recorded review.");
  for (const times of [state.reviews.map((review): string => review.openedAt), state.outcomes.map((outcome): string => outcome.recordedAt)]) require(times.every((time: string, index: number): boolean => {
    const previous = times[index - 1];
    return previous === undefined || Date.parse(time) >= Date.parse(previous);
  }), "Review and outcome arrays must retain append chronology.");
}
/** The operational rehearsal still requires its three original cases; selected archives do not invent them. */
export function validateSharedWorkspaceRules(state: SharedHistory, context: z.RefinementCtx): void {
  const rules = state.originalDecisions.map((record): string => `${record.assumption.field}/${record.assumption.scope}`).sort();
  if (JSON.stringify(rules) !== JSON.stringify(["grantedPermissions/Any", "requestedPermissions/Any", "requestedPermissions/Production"])) context.addIssue({ code: "custom", message: "This bounded workspace requires one request rule, one grant rule, and one production request rule." });
}
export function validateSharedHistory(state: SharedHistory, replacements: readonly ReviewReplacementLink[], context: z.RefinementCtx): void {
  validateSharedWorkspaceRules(state, context);
  validateSharedRecordHistory(state, replacements, context);
}
export const SharedStateSchema = SharedFieldsSchema.superRefine((state, context): void => validateSharedHistory(state, [], context));

export type SharedCreationIds = Readonly<{ session: string; source: string; event: string; evidence: string; decisions: readonly [string, string, string]; assumptions: readonly [string, string, string] }>;
/** Explicitly create the three-case rehearsal; no decision or outcome is fabricated on merely opening the page. */
export function createSharedState(actor: string, ids: SharedCreationIds, recordedAt: string): SharedState {
  const baseline: SharedEvidence = { id: ids.evidence, sourceId: ids.source, capturedAt: recordedAt, sourceNote: "Synthetic baseline manifest: requests read only, independently declares read granted; deployment context Unknown and runtime Not observed.", requestedPermissions: ["documents:read"], grantedPermissions: ["documents:read"], environment: "Unknown", observedActivity: "Not observed", provenance: "Synthetic" };
  const cases = [
    { title: "Request boundary", field: "requestedPermissions", scope: "Any", statement: "Approve a fictional read-only sandbox request boundary; any added request needs reassessment.", description: "Requested access must stay inside the read-only boundary, regardless of deployment context." },
    { title: "Declared grant boundary", field: "grantedPermissions", scope: "Any", statement: "Retain a fictional read-only grant assessment based on declared grants, without inferring runtime access.", description: "Declared granted permissions must stay read-only. Requested permissions are a separate fact." },
    { title: "Production applicability", field: "requestedPermissions", scope: "Production", statement: "Hold production use pending deployment clarification and a separate accountable reassessment; no production approval exists.", description: "Evaluate the request boundary only for a declared production context. Unknown context leaves applicability unresolved." },
  ] as const;
  return SharedStateSchema.parse({ schemaVersion: 5, id: ids.session, source: { id: ids.source, name: "Shared synthetic permissions manifest" }, sources: [{ id: ids.event, recordedAt, evidence: baseline }], reviews: [], outcomes: [], originalDecisions: cases.map((item, index: number) => {
    const id = ids.decisions[index], assumptionId = ids.assumptions[index];
    return { decision: { id, title: item.title, revision: `${id}.1`, statement: item.statement, rationale: "Simulated starting decision for a technical rehearsal only. The manifest declaration supplies no authenticated permission, runtime observation or practitioner acceptance.", actor, decidedAt: recordedAt, evidenceId: baseline.id, assumptionId }, assumption: { id: assumptionId, decisionId: id, sourceId: ids.source, baselineId: baseline.id, field: item.field, scope: item.scope, acceptedPermissions: ["documents:read"], description: item.description } };
  }) });
}
export function appendSharedEvidence(state: SharedState, input: SharedEvidenceInput, eventId: string, evidenceId: string, recordedAt: string): SharedState {
  const current = SharedStateSchema.parse(state), data = SharedEvidenceInputSchema.parse(input);
  return SharedStateSchema.parse({ ...current, sources: [...current.sources, { id: eventId, recordedAt, evidence: { ...data, id: evidenceId, sourceId: current.source.id, observedActivity: "Not observed", provenance: "Synthetic" } }] });
}
export function sharedReviewForLatest(current: SharedHistory, decisionId: string, id: string, openedAt: string): SharedReview {
  const record = sharedDecision(current, decisionId);
  if (sharedPendingReview(current, decisionId) !== null) throw new RangeError("Resolve the existing review for this decision before opening another. Other decisions can be reviewed independently.");
  const basis = sharedBasis(current, decisionId), target = current.sources.at(-1);
  if (basis === null || target === undefined) throw new ReferenceError("An active decision basis and captured source are required.");
  if (current.reviews.some((review): boolean => review.decisionId === decisionId && review.sourceEventId === target.id)) throw new RangeError("This exact capture already has a review for this decision. Preserve its outcome and record a later capture before reassessing again.");
  const impact = sharedImpact(current, record, basis, target.evidence);
  if (impact.status !== "affected" && impact.status !== "unresolved") throw new RangeError("This rule identifies no relevant change or unresolved applicability. No review was opened.");
  return { id, decisionId, assumptionId: record.assumption.id, actor: record.decision.actor, openedAt, sourceEventId: target.id, evidenceId: target.evidence.id, basis, trigger: impact.status };
}
export function openSharedReview(state: SharedState, decisionId: string, id: string, openedAt: string): SharedState {
  const current = SharedStateSchema.parse(state);
  return SharedStateSchema.parse({ ...current, reviews: [...current.reviews, sharedReviewForLatest(current, decisionId, id, openedAt)] });
}
export function appendSharedOutcome(state: SharedState, decisionId: string, input: SharedOutcomeInput, id: string, recordedAt: string): SharedState {
  const current = SharedStateSchema.parse(state), review = sharedPendingReview(current, decisionId);
  if (review === null) throw new ReferenceError("Open this decision's assigned review before recording an outcome.");
  const data = SharedOutcomeInputSchema.parse(input);
  return SharedStateSchema.parse({ ...current, outcomes: [...current.outcomes, { ...data, id, decisionId, reviewId: review.id, sourceEventId: review.sourceEventId, evidenceId: review.evidenceId, revision: `${decisionId}.${current.outcomes.filter((outcome): boolean => outcome.decisionId === decisionId).length + 2}`, recordedAt }] });
}
