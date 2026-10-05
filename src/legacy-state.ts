import { z } from "zod";
import { FixtureEvidenceIdSchema, FixtureEvidenceSchema, OutcomeSchema, getEvidence } from "./scenario.ts";
import type { FixtureEvidence } from "./scenario.ts";

const SourceEventSchema = z.object({
  id: z.uuid(),
  recordedAt: z.iso.datetime(),
  evidence: FixtureEvidenceSchema,
});

const ReviewSchema = z.object({
  id: z.literal("REV-001"),
  decisionId: z.literal("DEC-001"),
  assumptionId: z.literal("ASM-001"),
  actor: z.literal("Morgan Lee — synthetic reviewer"),
  openedAt: z.iso.datetime(),
  baseline: FixtureEvidenceSchema,
  changed: FixtureEvidenceSchema,
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
  baseline: FixtureEvidenceSchema,
  changed: FixtureEvidenceSchema,
});

export const LegacyStateSchema = z.object({
  schemaVersion: z.literal(1),
  selectedEvidenceId: FixtureEvidenceIdSchema,
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
  const records: FixtureEvidence[] = [
    ...state.sources.map((source): FixtureEvidence => source.evidence),
    ...(state.review === null ? [] : [state.review.baseline, state.review.changed]),
    ...state.outcomes.flatMap((outcome): FixtureEvidence[] => [outcome.baseline, outcome.changed]),
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

export type LegacyState = z.infer<typeof LegacyStateSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type ReviewInput = z.infer<typeof ReviewInputSchema>;
export type OutcomeRecord = z.infer<typeof OutcomeRecordSchema>;
