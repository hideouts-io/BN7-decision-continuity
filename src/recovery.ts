import { z } from "zod";
import { StateSchema } from "./model.ts";
import type { DemoState } from "./model.ts";
import { FixtureEvidenceSchema, ORIGINAL_DECISION, getEvidence } from "./scenario.ts";
import { SessionIdSchema, sessionForId } from "./sessions.ts";
import type { DemoSession, SessionId } from "./sessions.ts";
import { AuthoredStateSchema, AuthoredDecisionSchema } from "./authored-model.ts";
import type { AuthoredState } from "./authored-model.ts";
import { authoredStorageKey, readAuthoredState } from "./authored-storage.ts";
import { ContinuityHistoryExportSchema, continuityHistoryExport } from "./continuity-export.ts";
import { continuityStorageKey, readContinuityState } from "./continuity-storage.ts";
import { SharedHistoryExportSchema, sharedHistoryExport } from "./shared-export.ts";
import { sharedStorageKey, readSharedState } from "./shared-storage.ts";
import { ClarificationHistoryExportSchema, clarificationHistoryExport } from "./clarification-export.ts";
import { clarificationStorageKey, readClarificationState } from "./clarification-storage.ts";
import { MAX_IMPORT_BYTES, DEMONSTRATION_NOTICE } from "./history-contract.ts";

export { MAX_IMPORT_BYTES, DEMONSTRATION_NOTICE } from "./history-contract.ts";

const OriginalDecisionSchema = z.object({
  id: z.literal(ORIGINAL_DECISION.id), revision: z.literal(ORIGINAL_DECISION.revision),
  statement: z.literal(ORIGINAL_DECISION.statement), rationale: z.literal(ORIGINAL_DECISION.rationale),
  assumptionId: z.literal(ORIGINAL_DECISION.assumptionId), assumption: z.literal(ORIGINAL_DECISION.assumption),
  evidenceId: z.literal(ORIGINAL_DECISION.evidenceId), decidedAt: z.literal(ORIGINAL_DECISION.decidedAt),
  actor: z.literal(ORIGINAL_DECISION.actor),
});

const PreservedNarrativeSchema = z.string().refine(
  (value: string): boolean => value === value.trim(),
  "Exported narratives must already be normalized. Import will not silently trim historical evidence or rationale.",
);
const PreservedStateSchema = z.object({
  outcomes: z.array(z.object({ rationale: PreservedNarrativeSchema, statement: PreservedNarrativeSchema }).passthrough()),
  customEvidence: z.object({ evidence: z.object({ sourceNote: PreservedNarrativeSchema }).passthrough() }).passthrough().nullable().optional(),
}).passthrough().pipe(StateSchema);

export const LegacyHistoryExportSchema = z.object({
  exportSchemaVersion: z.literal(1), sessionId: SessionIdSchema, exportedAt: z.iso.datetime(),
  demonstration: z.literal(DEMONSTRATION_NOTICE), originalDecision: OriginalDecisionSchema,
  originalEvidence: FixtureEvidenceSchema.refine(
    (evidence): boolean => JSON.stringify(evidence) === JSON.stringify(getEvidence("EV-001")),
    "The exported original evidence differs from this demonstration's immutable approval basis.",
  ),
  session: PreservedStateSchema,
}).superRefine((record, context): void => {
  const times: string[] = [
    ORIGINAL_DECISION.decidedAt, ...record.session.sources.map((source): string => source.recordedAt),
    ...(record.session.review === null ? [] : [record.session.review.openedAt]),
    ...record.session.outcomes.map((outcome): string => outcome.recordedAt),
  ];
  if (times.some((time: string): boolean => Date.parse(time) > Date.parse(record.exportedAt))) {
    context.addIssue({ code: "custom", path: ["exportedAt"], message: "Export time predates the preserved decision or session history. Check the export and system clock." });
  }
});
export const AuthoredHistoryExportSchema = z.object({
  exportSchemaVersion: z.literal(2), sessionId: z.uuid(), exportedAt: z.iso.datetime(),
  demonstration: z.literal(DEMONSTRATION_NOTICE), originalDecision: AuthoredDecisionSchema,
  originalEvidence: AuthoredStateSchema.shape.sources.element.shape.evidence, session: AuthoredStateSchema,
}).superRefine((record, context): void => {
  if (record.sessionId !== record.session.id || JSON.stringify(record.originalDecision) !== JSON.stringify(record.session.originalDecision)
    || JSON.stringify(record.originalEvidence) !== JSON.stringify(record.session.sources[0]?.evidence)) {
    context.addIssue({ code: "custom", message: "The export must preserve the exact authored session UUID, original decision and baseline evidence." });
  }
  const times: string[] = [...record.session.sources.map((event): string => event.recordedAt), ...(record.session.review === null ? [] : [record.session.review.openedAt]), ...record.session.outcomes.map((outcome): string => outcome.recordedAt)];
  if (times.some((time: string): boolean => Date.parse(time) > Date.parse(record.exportedAt))) context.addIssue({ code: "custom", message: "Export time cannot predate preserved history." });
});
export const HistoryExportSchema = z.discriminatedUnion("exportSchemaVersion", [LegacyHistoryExportSchema, AuthoredHistoryExportSchema, ContinuityHistoryExportSchema, SharedHistoryExportSchema, ClarificationHistoryExportSchema]);
export type HistoryExport = z.infer<typeof HistoryExportSchema>;
export type LegacyHistoryExport = z.infer<typeof LegacyHistoryExportSchema>;

/** Reuse the existing export format; only the export timestamp changes on re-export. */
export function historyExport(id: SessionId, state: DemoState, exportedAt: string): LegacyHistoryExport {
  return LegacyHistoryExportSchema.parse({
    exportSchemaVersion: 1, sessionId: id, exportedAt, demonstration: DEMONSTRATION_NOTICE,
    originalDecision: ORIGINAL_DECISION, originalEvidence: getEvidence("EV-001"), session: state,
  });
}

export function authoredHistoryExport(state: AuthoredState, exportedAt: string): z.infer<typeof AuthoredHistoryExportSchema> {
  return AuthoredHistoryExportSchema.parse({ exportSchemaVersion: 2, sessionId: state.id, exportedAt, demonstration: DEMONSTRATION_NOTICE, originalDecision: state.originalDecision, originalEvidence: state.sources[0]?.evidence, session: state });
}

/** Bound file decoding and validate all required fields before inspecting destination storage. */
export function parseHistoryExport(content: string): HistoryExport {
  if (new TextEncoder().encode(content).byteLength > MAX_IMPORT_BYTES) {
    throw new RangeError("Import exceeds the 1 MiB limit. Choose a smaller Decision Continuity history export.");
  }
  const record: HistoryExport = HistoryExportSchema.parse(JSON.parse(content));
  if (record.exportSchemaVersion === 3) continuityHistoryExport(record.session, record.exportedAt);
  if (record.exportSchemaVersion === 5) clarificationHistoryExport(record.session, record.exportedAt);
  if (record.exportSchemaVersion === 4) sharedHistoryExport(record.session, record.exportedAt);
  return record;
}

/** Compare typed records; object-key order and unrelated extra fields do not change identity. */
export function recoveryDestination(storage: Storage, record: HistoryExport): DemoSession {
  const session: DemoSession = record.exportSchemaVersion === 5 ? { id: record.sessionId, storageKey: clarificationStorageKey(record.sessionId) } : record.exportSchemaVersion === 4 ? { id: record.sessionId, storageKey: sharedStorageKey(record.sessionId) } : record.exportSchemaVersion === 3 ? { id: record.sessionId, storageKey: continuityStorageKey(record.sessionId) } : record.exportSchemaVersion === 2 ? { id: record.sessionId, storageKey: authoredStorageKey(record.sessionId) } : sessionForId(record.sessionId);
  const existing: string | null = storage.getItem(session.storageKey);
  const stored = existing === null ? null : record.exportSchemaVersion === 5 ? readClarificationState(storage, record.sessionId) : record.exportSchemaVersion === 4 ? readSharedState(storage, record.sessionId) : record.exportSchemaVersion === 3 ? readContinuityState(storage, record.sessionId) : record.exportSchemaVersion === 2 ? readAuthoredState(storage, record.sessionId) : StateSchema.parse(JSON.parse(existing));
  if (stored !== null && JSON.stringify(stored) !== JSON.stringify(record.session)) {
    throw new RangeError(`Session ${record.sessionId} already contains different history in this browser. Nothing was replaced. Use a separate browser profile to inspect this export.`);
  }
  return session;
}

/** Recheck at confirmation; one atomic setItem stores a missing record, never an existing one. */
export function recoverHistory(storage: Storage, record: HistoryExport): DemoSession {
  const validated: HistoryExport = HistoryExportSchema.parse(record);
  if (validated.exportSchemaVersion === 3) continuityHistoryExport(validated.session, validated.exportedAt);
  if (validated.exportSchemaVersion === 5) clarificationHistoryExport(validated.session, validated.exportedAt);
  if (validated.exportSchemaVersion === 4) sharedHistoryExport(validated.session, validated.exportedAt);
  const session: DemoSession = recoveryDestination(storage, validated);
  if (storage.getItem(session.storageKey) === null) {
    try {
      storage.setItem(session.storageKey, JSON.stringify(validated.session));
    } catch (error) {
      if (!(error instanceof DOMException)) throw error;
      throw new Error(`Could not restore session ${session.id}: ${error.name}: ${error.message}. Browser storage may be full or unavailable. No success was recorded.`, { cause: error });
    }
  }
  return session;
}
