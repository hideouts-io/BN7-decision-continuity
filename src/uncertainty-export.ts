import { z } from "zod";
import { SharedEvidenceSchema } from "./shared-model.ts";
import { UncertaintyStateSchema, uncertaintyRecordTimes } from "./uncertainty-model.ts";
import type { UncertaintyState } from "./uncertainty-model.ts";
import { DEMONSTRATION_NOTICE, requireRecoverableSize } from "./history-contract.ts";

export const UncertaintyHistoryExportSchema = z.strictObject({
  exportSchemaVersion: z.literal(6), sessionId: z.uuid(), exportedAt: z.iso.datetime(), demonstration: z.literal(DEMONSTRATION_NOTICE),
  originalDecisions: UncertaintyStateSchema.shape.history.shape.originalDecisions, originalEvidence: SharedEvidenceSchema, session: UncertaintyStateSchema,
}).superRefine((record, context): void => {
  if (record.sessionId !== record.session.id || JSON.stringify(record.originalDecisions) !== JSON.stringify(record.session.history.originalDecisions)
    || JSON.stringify(record.originalEvidence) !== JSON.stringify(record.session.history.sources[0]?.evidence)) context.addIssue({ code: "custom", message: "Uncertainty exports must preserve the separate continuation UUID and every exact original decision, assumption and baseline evidence." });
  if (uncertaintyRecordTimes(record.session).some((time: string): boolean => Date.parse(time) > Date.parse(record.exportedAt))) context.addIssue({ code: "custom", message: "Export time cannot predate any preserved history, enrollment, requirement or resolution." });
});
export type UncertaintyHistoryExport = z.infer<typeof UncertaintyHistoryExportSchema>;
export function uncertaintyHistoryExport(state: UncertaintyState, exportedAt: string): UncertaintyHistoryExport {
  const record = UncertaintyHistoryExportSchema.parse({ exportSchemaVersion: 6, sessionId: state.id, exportedAt, demonstration: DEMONSTRATION_NOTICE, originalDecisions: state.history.originalDecisions, originalEvidence: state.history.sources[0]?.evidence, session: state });
  requireRecoverableSize(JSON.stringify(record, null, 2));
  return record;
}
