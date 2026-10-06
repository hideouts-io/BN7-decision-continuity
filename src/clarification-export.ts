import { z } from "zod";
import { ClarificationStateSchema } from "./clarification-model.ts";
import { SharedEvidenceSchema } from "./shared-model.ts";
import type { ClarificationState } from "./clarification-model.ts";
import { DEMONSTRATION_NOTICE, requireRecoverableSize } from "./history-contract.ts";

export const ClarificationHistoryExportSchema = z.object({
  exportSchemaVersion: z.literal(5), sessionId: z.uuid(), exportedAt: z.iso.datetime(), demonstration: z.literal(DEMONSTRATION_NOTICE),
  originalDecisions: ClarificationStateSchema.shape.originalDecisions, originalEvidence: SharedEvidenceSchema, session: ClarificationStateSchema,
}).superRefine((record, context): void => {
  if (record.sessionId !== record.session.id || JSON.stringify(record.originalDecisions) !== JSON.stringify(record.session.originalDecisions)
    || JSON.stringify(record.originalEvidence) !== JSON.stringify(record.session.sources[0]?.evidence)) context.addIssue({ code: "custom", message: "Shared exports must preserve all three exact original decisions, their assumptions, baseline and workspace UUID." });
  const times: string[] = [...record.session.sources.map((event): string => event.recordedAt), ...record.session.reviews.map((review): string => review.openedAt), ...record.session.outcomes.map((outcome): string => outcome.recordedAt), ...record.session.replacements.map((event): string => event.recordedAt)];
  if (times.some((time: string): boolean => Date.parse(time) > Date.parse(record.exportedAt))) context.addIssue({ code: "custom", message: "Export time cannot predate any recorded shared-source event." });
});
export type ClarificationHistoryExport = z.infer<typeof ClarificationHistoryExportSchema>;
export function clarificationHistoryExport(state: ClarificationState, exportedAt: string): ClarificationHistoryExport {
  const record = ClarificationHistoryExportSchema.parse({ exportSchemaVersion: 5, sessionId: state.id, exportedAt, demonstration: DEMONSTRATION_NOTICE, originalDecisions: state.originalDecisions, originalEvidence: state.sources[0]?.evidence, session: state });
  requireRecoverableSize(JSON.stringify(record, null, 2));
  return record;
}
