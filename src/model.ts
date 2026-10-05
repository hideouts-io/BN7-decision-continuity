import { z } from "zod";
import { EvidenceIdSchema, EvidenceSchema, ORIGINAL_DECISION, OutcomeSchema, getEvidence, requiresReview } from "./scenario.ts";
import type { Evidence, EvidenceId } from "./scenario.ts";

const SourceEventSchema = z.object({
  id: z.uuid(),
  recordedAt: z.iso.datetime(),
  evidence: EvidenceSchema,
});

const ReviewSchema = z.object({
  id: z.literal("REV-001"),
  decisionId: z.literal("DEC-001"),
  assumptionId: z.literal("ASM-001"),
  actor: z.literal("Morgan Lee — synthetic reviewer"),
  openedAt: z.iso.datetime(),
  baseline: EvidenceSchema,
  changed: EvidenceSchema,
});

export const ReviewInputSchema = z.object({
  actor: z.literal("Morgan Lee — synthetic reviewer"),
  outcome: OutcomeSchema,
  rationale: z.string().trim().min(16, "Explain the reason for your outcome in at least 16 characters.").max(2000),
  statement: z.string().trim().min(16, "Describe the resulting decision scope or next step in at least 16 characters.").max(1000),
});

const OutcomeRecordSchema = ReviewInputSchema.extend({
  id: z.uuid(),
  reviewId: z.literal("REV-001"),
  recordedAt: z.iso.datetime(),
  revision: z.string().regex(/^DEC-001\.([2-9]|[1-9][0-9]+)$/),
  baseline: EvidenceSchema,
  changed: EvidenceSchema,
});

export const StateSchema = z.object({
  schemaVersion: z.literal(1),
  selectedEvidenceId: EvidenceIdSchema,
  sources: z.array(SourceEventSchema),
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
  if (state.outcomes.length > 0 && state.review === null) {
    context.addIssue({ code: "custom", message: "Saved outcomes require their original review record." });
  }
  if (state.outcomes.slice(0, -1).some((outcome): boolean => outcome.outcome !== "defer")) {
    context.addIssue({ code: "custom", message: "A terminal outcome cannot be followed by another outcome. Final review history cannot be reopened or overwritten." });
  }
  const records: Evidence[] = [
    ...state.sources.map((source): Evidence => source.evidence),
    ...(state.review === null ? [] : [state.review.baseline, state.review.changed]),
    ...state.outcomes.flatMap((outcome): Evidence[] => [outcome.baseline, outcome.changed]),
  ];
  for (const record of records) {
    if (JSON.stringify(record) !== JSON.stringify(getEvidence(record.id))) {
      context.addIssue({ code: "custom", message: `Saved evidence ${record.id} differs from its versioned fixture. Export or inspect the saved data; it will not be silently replaced.` });
    }
  }
  if (state.review !== null && (state.review.baseline.id !== "EV-001" || state.review.changed.id !== "EV-002")) {
    context.addIssue({ code: "custom", message: "REV-001 must preserve the EV-001 to EV-002 comparison." });
  }
  if (state.review !== null) {
    const openedAt: string = state.review.openedAt;
    if (!state.sources.some((source): boolean => source.evidence.id === "EV-002" && Date.parse(source.recordedAt) <= Date.parse(openedAt))) {
      context.addIssue({ code: "custom", message: "Review REV-001 requires changed evidence selected at or before review opening." });
    }
  }
  state.outcomes.forEach((outcome, index): void => {
    if (outcome.baseline.id !== "EV-001" || outcome.changed.id !== "EV-002" || outcome.revision !== `DEC-001.${index + 2}`) {
      context.addIssue({ code: "custom", message: "Outcome evidence and decision revision sequence are inconsistent." });
    }
    const previousTime: string | undefined = index === 0 ? state.review?.openedAt : state.outcomes[index - 1]?.recordedAt;
    if (previousTime !== undefined && Date.parse(outcome.recordedAt) < Date.parse(previousTime)) {
      context.addIssue({ code: "custom", message: `Outcome ${outcome.revision} predates its review or preceding outcome. Check the system clock; records cannot reverse their causal order.` });
    }
  });
});

export type DemoState = z.infer<typeof StateSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type ReviewInput = z.infer<typeof ReviewInputSchema>;
export type OutcomeRecord = z.infer<typeof OutcomeRecordSchema>;

/** Create an empty local session; the original decision and evidence are fixed fixtures. */
export function initialState(): DemoState {
  return { schemaVersion: 1, selectedEvidenceId: "EV-001", sources: [], review: null, outcomes: [] };
}

/** Append a source selection without changing previous evidence or outcomes. */
export function selectEvidence(state: DemoState, evidenceId: EvidenceId, eventId: string, recordedAt: string): DemoState {
  const source = SourceEventSchema.parse({ id: eventId, recordedAt, evidence: getEvidence(evidenceId) });
  return StateSchema.parse({ ...state, selectedEvidenceId: evidenceId, sources: [...state.sources, source] });
}

/** Create the one supported review once; repeated requests preserve its identity. */
export function openReview(state: DemoState, openedAt: string): DemoState {
  if (!requiresReview(getEvidence(state.selectedEvidenceId))) {
    throw new RangeError(`Cannot open a review for ${state.selectedEvidenceId}: it does not contradict ASM-001.`);
  }
  if (state.review !== null) return state;
  const review: Review = ReviewSchema.parse({
    id: "REV-001", decisionId: ORIGINAL_DECISION.id, assumptionId: ORIGINAL_DECISION.assumptionId,
    actor: ORIGINAL_DECISION.actor, openedAt,
    baseline: getEvidence("EV-001"), changed: getEvidence(state.selectedEvidenceId),
  });
  return StateSchema.parse({ ...state, review });
}

/** Append a human outcome; a deferred review can later receive another outcome. */
export function recordOutcome(state: DemoState, input: ReviewInput, eventId: string, recordedAt: string): DemoState {
  if (state.review === null) throw new ReferenceError("Open REV-001 before recording a human outcome.");
  if (state.selectedEvidenceId !== "EV-002") throw new RangeError("Select changed evidence EV-002 before recording its outcome.");
  const latest: OutcomeRecord | undefined = state.outcomes.at(-1);
  if (latest !== undefined && latest.outcome !== "defer") {
    throw new RangeError(`Review REV-001 already has a final ${latest.outcome} outcome. Existing outcomes cannot be overwritten.`);
  }
  const outcome: OutcomeRecord = OutcomeRecordSchema.parse({
    ...ReviewInputSchema.parse(input), id: eventId, recordedAt, reviewId: state.review.id,
    revision: `DEC-001.${state.outcomes.length + 2}`, baseline: state.review.baseline, changed: state.review.changed,
  });
  return StateSchema.parse({ ...state, outcomes: [...state.outcomes, outcome] });
}
