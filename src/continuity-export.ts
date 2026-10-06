import { z } from "zod";
import { AuthoredDecisionSchema } from "./authored-model.ts";
import { ContinuityEvidenceSchema, ContinuityStateSchema } from "./continuity-model.ts";
import type { ContinuityState } from "./continuity-model.ts";
import { DEMONSTRATION_NOTICE, requireRecoverableSize } from "./history-contract.ts";

export const ContinuityHistoryExportSchema = z.object({
  exportSchemaVersion: z.literal(3), sessionId: z.uuid(), exportedAt: z.iso.datetime(), demonstration: z.literal(DEMONSTRATION_NOTICE),
  originalDecision: AuthoredDecisionSchema, originalEvidence: ContinuityEvidenceSchema, session: ContinuityStateSchema,
}).superRefine((record, context): void => {
  if (record.sessionId !== record.session.id || JSON.stringify(record.originalDecision) !== JSON.stringify(record.session.originalDecision)
    || JSON.stringify(record.originalEvidence) !== JSON.stringify(record.session.sources[0]?.evidence)) context.addIssue({ code: "custom", message: "Continuity exports must preserve their exact original basis and session UUID." });
  const times: string[] = [...record.session.sources.map((event): string => event.recordedAt), ...record.session.reviews.map((review): string => review.openedAt), ...record.session.outcomes.map((outcome): string => outcome.recordedAt)];
  if (times.some((time: string): boolean => Date.parse(time) > Date.parse(record.exportedAt))) context.addIssue({ code: "custom", message: "Export time cannot predate the preserved continuity sequence." });
});
export type ContinuityHistoryExport = z.infer<typeof ContinuityHistoryExportSchema>;

export function continuityHistoryExport(state: ContinuityState, exportedAt: string): ContinuityHistoryExport {
  const record = ContinuityHistoryExportSchema.parse({ exportSchemaVersion: 3, sessionId: state.id, exportedAt, demonstration: DEMONSTRATION_NOTICE, originalDecision: state.originalDecision, originalEvidence: state.sources[0]?.evidence, session: state });
  requireRecoverableSize(JSON.stringify(record, null, 2));
  return record;
}
