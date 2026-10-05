import { z } from "zod";
import { LegacyStateSchema, ReviewInputSchema } from "./legacy-state.ts";
import type { LegacyState, OutcomeRecord as LegacyOutcomeRecord, Review as LegacyReview, ReviewInput } from "./legacy-state.ts";
import { AuthoredEvidenceSchema, EvidenceIdSchema, EvidenceInputSchema, EvidenceSchema, ORIGINAL_DECISION, getEvidence, requiresReview } from "./scenario.ts";
import type { Evidence, EvidenceId, EvidenceInput } from "./scenario.ts";

export { EvidenceInputSchema, LegacyStateSchema, ReviewInputSchema };
export type { LegacyState, ReviewInput };

const SourceEventSchema = z.object({
  id: z.uuid(),
  recordedAt: z.iso.datetime(),
  evidence: EvidenceSchema,
});

const CustomEvidenceRecordSchema = z.object({
  id: z.uuid(),
  recordedAt: z.iso.datetime(),
  evidence: AuthoredEvidenceSchema,
});

const ReviewSchema = z.object({
  id: z.literal("REV-001"),
  decisionId: z.literal("DEC-001"),
  assumptionId: z.literal("ASM-001"),
  actor: z.literal("Morgan Lee — synthetic reviewer"),
  openedAt: z.iso.datetime(),
  sourceEventId: z.uuid(),
  baseline: EvidenceSchema,
  changed: EvidenceSchema,
});

const OutcomeRecordSchema = ReviewInputSchema.extend({
  id: z.uuid(),
  reviewId: z.literal("REV-001"),
  recordedAt: z.iso.datetime(),
  sourceEventId: z.uuid(),
  revision: z.string().regex(/^DEC-001\.([2-9]|[1-9][0-9]+)$/),
  baseline: EvidenceSchema,
  changed: EvidenceSchema,
});

export const VersionStateSchema = z.object({
  schemaVersion: z.literal(2),
  selectedEvidenceId: EvidenceIdSchema,
  sources: z.array(SourceEventSchema),
  customEvidence: CustomEvidenceRecordSchema.nullable(),
  review: ReviewSchema.nullable(),
  outcomes: z.array(OutcomeRecordSchema),
}).superRefine((state, context): void => {
  const lastSource = state.sources.at(-1);
  if (lastSource === undefined && state.selectedEvidenceId !== "EV-001") {
    context.addIssue({ code: "custom", message: "A selected comparison requires a recorded source event." });
  }
  if (lastSource !== undefined && state.selectedEvidenceId !== lastSource.evidence.id) {
    context.addIssue({ code: "custom", message: "The selected evidence must match the last recorded source selection." });
  }
  if (new Set([...state.sources.map((source): string => source.id), ...state.outcomes.map((outcome): string => outcome.id)]).size !== state.sources.length + state.outcomes.length) {
    context.addIssue({ code: "custom", message: "Source and outcome event identifiers must be unique." });
  }
  if (state.selectedEvidenceId === "EV-004" && state.customEvidence === null) {
    context.addIssue({ code: "custom", message: "EV-004 requires its saved manually authored version." });
  }
  const records: Evidence[] = [
    ...state.sources.map((source): Evidence => source.evidence),
    ...(state.review === null ? [] : [state.review.baseline, state.review.changed]),
    ...state.outcomes.flatMap((outcome): Evidence[] => [outcome.baseline, outcome.changed]),
  ];
  for (const record of records) {
    const canonical: Evidence | undefined = record.id === "EV-004" ? state.customEvidence?.evidence : getEvidence(record.id);
    if (canonical === undefined || JSON.stringify(record) !== JSON.stringify(canonical)) {
      context.addIssue({ code: "custom", message: `Saved evidence ${record.id} differs from its immutable source version. Inspect the saved data; it will not be silently replaced.` });
    }
  }
  state.sources.forEach((source, index): void => {
    if (Date.parse(source.recordedAt) < Date.parse(getEvidence("EV-001").capturedAt) || Date.parse(source.recordedAt) < Date.parse(source.evidence.capturedAt)) {
      context.addIssue({ code: "custom", message: "A source selection predates its capture or previous source selection. Check the system clock; records cannot reverse their causal order." });
    }
    if (index > 0) {
      const previous = state.sources[index - 1];
      if (previous === undefined) throw new ReferenceError(`Source event ${index} has no preceding array entry.`);
      if (Date.parse(source.recordedAt) < Date.parse(previous.recordedAt)) {
        context.addIssue({ code: "custom", message: "Source selections must retain chronological order. Check the system clock; records cannot reverse their causal order." });
      }
    }
  });
  if (state.customEvidence !== null) {
    const custom = state.customEvidence;
    if (Date.parse(custom.evidence.capturedAt) < Date.parse(getEvidence("EV-001").capturedAt) || Date.parse(custom.evidence.capturedAt) > Date.parse(custom.recordedAt)) {
      context.addIssue({ code: "custom", message: "The authored capture must be at or after the original capture and at or before the time it was recorded." });
    }
    if (!state.sources.some((source): boolean => source.id === custom.id && source.recordedAt === custom.recordedAt && source.evidence.id === "EV-004")) {
      context.addIssue({ code: "custom", message: "The authored version requires its original source event with the same identifier and recording time." });
    }
    if (state.review !== null && Date.parse(custom.recordedAt) > Date.parse(state.review.openedAt)) {
      context.addIssue({ code: "custom", message: "The authored version must be recorded before a review is opened; it cannot be added to an existing review." });
    }
  }
  if (state.outcomes.length > 0 && state.review === null) {
    context.addIssue({ code: "custom", message: "Saved outcomes require their original review record." });
  }
  if (state.outcomes.slice(0, -1).some((outcome): boolean => outcome.outcome !== "defer")) {
    context.addIssue({ code: "custom", message: "A terminal outcome cannot be followed by another outcome. Final review history cannot be reopened or overwritten." });
  }
  if (state.review !== null) {
    const review = state.review;
    if (review.baseline.id !== "EV-001" || (review.changed.id !== "EV-002" && review.changed.id !== "EV-004") || !requiresReview(review.changed)) {
      context.addIssue({ code: "custom", message: "REV-001 must preserve the original evidence and a version that contradicts ASM-001." });
    }
    const selectedAtOpening = state.sources.find((source): boolean => source.id === review.sourceEventId);
    if (selectedAtOpening === undefined || JSON.stringify(selectedAtOpening.evidence) !== JSON.stringify(review.changed) || Date.parse(selectedAtOpening.recordedAt) > Date.parse(review.openedAt)) {
      context.addIssue({ code: "custom", message: "Review REV-001 requires an explicit source event containing its exact changed evidence at or before review opening." });
    }
  }
  state.outcomes.forEach((outcome, index): void => {
    if (state.review === null || JSON.stringify(outcome.baseline) !== JSON.stringify(state.review.baseline) || JSON.stringify(outcome.changed) !== JSON.stringify(state.review.changed) || outcome.revision !== `DEC-001.${index + 2}`) {
      context.addIssue({ code: "custom", message: "Outcome evidence and decision revision sequence must match the original review." });
    }
    const previousTime: string | undefined = index === 0 ? state.review?.openedAt : state.outcomes[index - 1]?.recordedAt;
    if (previousTime !== undefined && Date.parse(outcome.recordedAt) < Date.parse(previousTime)) {
      context.addIssue({ code: "custom", message: `Outcome ${outcome.revision} predates its review or preceding outcome. Check the system clock; records cannot reverse their causal order.` });
    }
    const selectedAtOutcome = state.sources.find((source): boolean => source.id === outcome.sourceEventId);
    if (selectedAtOutcome === undefined || JSON.stringify(selectedAtOutcome.evidence) !== JSON.stringify(outcome.changed) || Date.parse(selectedAtOutcome.recordedAt) > Date.parse(outcome.recordedAt)) {
      context.addIssue({ code: "custom", message: "An outcome requires an explicit source event containing its exact reviewed evidence at or before it was recorded." });
    }
  });
});

export const StateSchema = z.discriminatedUnion("schemaVersion", [LegacyStateSchema, VersionStateSchema]);
export type DemoState = z.infer<typeof StateSchema>;
export type VersionState = z.infer<typeof VersionStateSchema>;
export type Review = LegacyReview | z.infer<typeof ReviewSchema>;
export type OutcomeRecord = LegacyOutcomeRecord | z.infer<typeof OutcomeRecordSchema>;

/** Create the original v1 workflow without changing its fixture-bound schema. */
export function initialState(): LegacyState {
  return { schemaVersion: 1, selectedEvidenceId: "EV-001", sources: [], review: null, outcomes: [] };
}

/** Opt into authoring without migrating or replacing any existing session. */
export function initialVersionState(): VersionState {
  return { schemaVersion: 2, selectedEvidenceId: "EV-001", sources: [], customEvidence: null, review: null, outcomes: [] };
}

/** Resolve an immutable source snapshot from the selected session or original fixtures. */
export function evidenceForState(state: DemoState, id: EvidenceId): Evidence {
  if (id !== "EV-004") return getEvidence(id);
  if (state.schemaVersion !== 2 || state.customEvidence === null) {
    throw new ReferenceError("EV-004 is absent from this session. Create and record a synthetic version in a new authoring session first.");
  }
  return AuthoredEvidenceSchema.parse(state.customEvidence.evidence);
}

/** Reject causal reversal before appending a new event to a v2 session. */
function validateEventTime(state: VersionState, recordedAt: string): void {
  const time: string = z.iso.datetime().parse(recordedAt);
  const priorTimes: string[] = [
    getEvidence("EV-001").capturedAt,
    ...state.sources.map((source): string => source.recordedAt),
    ...state.outcomes.map((outcome): string => outcome.recordedAt),
    ...(state.review === null ? [] : [state.review.openedAt]),
  ];
  if (priorTimes.some((prior): boolean => Date.parse(time) < Date.parse(prior))) {
    throw new RangeError("The new event predates existing session history. Check the system clock; records cannot reverse their causal order.");
  }
}

/** Append a source selection without changing previous evidence or outcomes. */
export function selectEvidence(state: DemoState, evidenceId: EvidenceId, eventId: string, recordedAt: string): DemoState {
  if (state.schemaVersion === 2) validateEventTime(state, recordedAt);
  const source = SourceEventSchema.parse({ id: eventId, recordedAt, evidence: evidenceForState(state, evidenceId) });
  return StateSchema.parse({ ...state, selectedEvidenceId: evidenceId, sources: [...state.sources, source] });
}

/** Record one immutable authored capture before any review is opened. */
export function recordEvidenceVersion(state: DemoState, input: EvidenceInput, eventId: string, recordedAt: string): VersionState {
  if (state.schemaVersion !== 2) throw new RangeError("Existing v1 sessions retain their original schema. Create a new authoring session to record EV-004.");
  if (state.customEvidence !== null) throw new RangeError("EV-004 is already recorded in this session. Immutable evidence cannot be edited or replaced; start another authoring session for a different example.");
  if (state.review !== null) throw new RangeError("Record the authored version before opening a review. Existing review evidence cannot be replaced.");
  validateEventTime(state, recordedAt);
  const evidence = AuthoredEvidenceSchema.parse({
    ...EvidenceInputSchema.parse(input), id: "EV-004", sourceId: "SRC-001", sourceName: "Atlas assistant manifest",
    provenance: "Manually authored synthetic version; no operational observations", observedActivity: "Not observed",
  });
  const customEvidence = CustomEvidenceRecordSchema.parse({ id: eventId, recordedAt, evidence });
  const source = SourceEventSchema.parse(customEvidence);
  return VersionStateSchema.parse({ ...state, selectedEvidenceId: "EV-004", customEvidence, sources: [...state.sources, source] });
}

/** Open one review and bind it permanently to the exact changed evidence version. */
export function openReview(state: DemoState, openedAt: string): DemoState {
  const changed: Evidence = evidenceForState(state, state.selectedEvidenceId);
  if (!requiresReview(changed)) throw new RangeError(`Cannot open a review for ${state.selectedEvidenceId}: it does not contradict ASM-001.`);
  if (state.review !== null) {
    if (state.selectedEvidenceId !== state.review.changed.id) throw new RangeError(`REV-001 already concerns ${state.review.changed.id}. Select that exact version to continue; existing review evidence cannot be replaced.`);
    return state;
  }
  if (state.schemaVersion === 2) validateEventTime(state, openedAt);
  const selectedSource = state.sources.at(-1);
  if (selectedSource === undefined) throw new ReferenceError("Select changed evidence before opening REV-001; its source event is missing.");
  const review: Review = ReviewSchema.parse({
    id: "REV-001", decisionId: ORIGINAL_DECISION.id, assumptionId: ORIGINAL_DECISION.assumptionId,
    actor: ORIGINAL_DECISION.actor, openedAt, sourceEventId: selectedSource.id,
    baseline: getEvidence("EV-001"), changed,
  });
  return StateSchema.parse({ ...state, review });
}

/** Append a human outcome only for the exact source version retained by the review. */
export function recordOutcome(state: DemoState, input: ReviewInput, eventId: string, recordedAt: string): DemoState {
  if (state.review === null) throw new ReferenceError("Open REV-001 before recording a human outcome.");
  if (state.selectedEvidenceId !== state.review.changed.id) throw new RangeError(`Select reviewed evidence ${state.review.changed.id} before recording its outcome.`);
  const latest: OutcomeRecord | undefined = state.outcomes.at(-1);
  if (latest !== undefined && latest.outcome !== "defer") {
    throw new RangeError(`Review REV-001 already has a final ${latest.outcome} outcome. Existing outcomes cannot be overwritten.`);
  }
  if (state.schemaVersion === 2) validateEventTime(state, recordedAt);
  const selectedSource = state.sources.at(-1);
  if (selectedSource === undefined) throw new ReferenceError("Select reviewed evidence before recording its outcome; the source event is missing.");
  const outcome: OutcomeRecord = OutcomeRecordSchema.parse({
    ...ReviewInputSchema.parse(input), id: eventId, recordedAt, reviewId: state.review.id,
    sourceEventId: selectedSource.id,
    revision: `DEC-001.${state.outcomes.length + 2}`, baseline: state.review.baseline, changed: state.review.changed,
  });
  return StateSchema.parse({ ...state, outcomes: [...state.outcomes, outcome] });
}
