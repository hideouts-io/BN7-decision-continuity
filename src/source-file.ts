import { z } from "zod";
import { ClarificationStateSchema } from "./clarification-model.ts";
import type { ClarificationState } from "./clarification-model.ts";
import { samePermissions } from "./continuity-model.ts";
import type { ContinuityPermission } from "./continuity-model.ts";
import { EnvironmentSchema, SharedEvidenceInputSchema, SharedEvidenceSchema, SharedStateSchema, sharedBasis, sharedImpact } from "./shared-model.ts";
import type { SharedEvidence, SharedEvidenceInput, SharedImpact, SharedState } from "./shared-model.ts";

export const SOURCE_FILE_PREFIX = "DC_SOURCE_FILE_V1\n";
export const MAX_SOURCE_FILE_BYTES = 8192;
const normalized = (minimum: number, maximum: number): z.ZodString => z.string().min(minimum).max(maximum).refine((value: string): boolean => value === value.trim(), "Remove leading or trailing whitespace; source declarations are not silently normalized.");
const SourceReferenceSchema = normalized(1, 160).refine((value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" && !value.includes("?") && !value.includes("#") && url.href === value;
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}, "Use a canonical HTTPS source reference without credentials, query parameters or fragments. No reference is fetched.");
const SourceFileFieldsSchema = z.strictObject({
  artifactSchemaVersion: z.literal(1), sourceId: z.uuid(), sourceReference: SourceReferenceSchema,
  revision: normalized(1, 64), sourceUpdatedAt: z.iso.datetime(), capturedAt: z.iso.datetime(),
  requestedPermissions: SharedEvidenceInputSchema.shape.requestedPermissions,
  grantedPermissions: SharedEvidenceInputSchema.shape.grantedPermissions,
  environment: EnvironmentSchema, provenance: z.literal("Synthetic"), observedActivity: z.literal("Not observed"), note: normalized(16, 180),
});
export type SourceFileArtifact = z.infer<typeof SourceFileFieldsSchema>;

function canonicalArtifact(artifact: SourceFileArtifact): SourceFileArtifact {
  return {
    artifactSchemaVersion: 1, sourceId: artifact.sourceId, sourceReference: artifact.sourceReference, revision: artifact.revision,
    sourceUpdatedAt: artifact.sourceUpdatedAt, capturedAt: artifact.capturedAt,
    requestedPermissions: [...artifact.requestedPermissions].sort(), grantedPermissions: [...artifact.grantedPermissions].sort(),
    environment: artifact.environment, provenance: "Synthetic", observedActivity: "Not observed", note: artifact.note,
  };
}
function encodedReceipt(artifact: SourceFileArtifact): string {
  return `${SOURCE_FILE_PREFIX}${JSON.stringify(canonicalArtifact(artifact))}`;
}
/** A bounded synthetic declaration, not an authenticated revision, fetched source or runtime observation. */
export const SourceFileArtifactSchema = SourceFileFieldsSchema.superRefine((artifact, context): void => {
  if (Date.parse(artifact.sourceUpdatedAt) > Date.parse(artifact.capturedAt)) context.addIssue({ code: "custom", message: "Source update time cannot follow its declared capture time." });
  if (encodedReceipt(artifact).length > 1000) context.addIssue({ code: "custom", message: "The complete source receipt exceeds the existing 1000-character evidence note limit. Shorten the reference, revision or note; nothing was truncated." });
});

export type SourceFileRecord = Readonly<{ sourceEventId: string; evidenceId: string; recordedAt: string; artifact: SourceFileArtifact }>;
export type SourceFileChanges = Readonly<{ requestedAdded: readonly ContinuityPermission[]; requestedRemoved: readonly ContinuityPermission[]; grantedAdded: readonly ContinuityPermission[]; grantedRemoved: readonly ContinuityPermission[]; environmentChanged: boolean }>;
export type SourceFileDecisionImpact = Readonly<{ decisionId: string; title: string; status: SharedImpact["status"]; explanation: string }>;
export type SourceFilePreview = Readonly<{ artifact: SourceFileArtifact; sourceEventId: string; evidenceId: string; payloadStatus: "changed" | "unchanged"; changes: SourceFileChanges; impacts: readonly SourceFileDecisionImpact[] }>;

/** Parse local bytes only. Unknown fields, malformed JSON and declarations outside the closed contract fail explicitly. */
export function parseSourceFile(content: string): SourceFileArtifact {
  if (new TextEncoder().encode(content).byteLength > MAX_SOURCE_FILE_BYTES) throw new RangeError("Source file exceeds the 8 KiB limit. Select a bounded synthetic artifact; no file was recorded.");
  try {
    return canonicalArtifact(SourceFileArtifactSchema.parse(JSON.parse(content)));
  } catch (error) {
    if (error instanceof SyntaxError) throw new SyntaxError("Source file is not valid JSON. Correct the versioned synthetic artifact before inspecting it.", { cause: error });
    throw error;
  }
}
/** Persist the entire validated declaration inside the existing immutable evidence note, preserving every prior schema and export format. */
export function sourceFileReceipt(artifact: SourceFileArtifact): string {
  return encodedReceipt(SourceFileArtifactSchema.parse(artifact));
}
/** Reserved receipts must agree with their enclosing evidence. Unmarked legacy notes remain ordinary prose. */
export function sourceFileFromEvidence(evidence: SharedEvidence): SourceFileArtifact | null {
  const current = SharedEvidenceSchema.parse(evidence);
  if (!current.sourceNote.startsWith("DC_SOURCE_FILE_V1")) return null;
  if (!current.sourceNote.startsWith(SOURCE_FILE_PREFIX)) throw new RangeError("Recorded source evidence contains a malformed reserved receipt marker. Preserve the history and inspect its original export; file intake is blocked.");
  const artifact = parseSourceFile(current.sourceNote.slice(SOURCE_FILE_PREFIX.length));
  if (artifact.sourceId !== current.sourceId || artifact.capturedAt !== current.capturedAt
    || !samePermissions(artifact.requestedPermissions, current.requestedPermissions) || !samePermissions(artifact.grantedPermissions, current.grantedPermissions)
    || artifact.environment !== current.environment || artifact.provenance !== current.provenance || artifact.observedActivity !== current.observedActivity) throw new RangeError("Recorded source receipt contradicts its enclosing evidence identity, capture time or declared fields. Preserve the history and inspect its original export; file intake is blocked.");
  return artifact;
}
function validatedHistory(state: SharedState | ClarificationState): SharedState | ClarificationState {
  return state.schemaVersion === 5 ? SharedStateSchema.parse(state) : ClarificationStateSchema.parse(state);
}
function sameSourcePayload(left: SourceFileArtifact, right: SourceFileArtifact): boolean {
  return left.sourceReference === right.sourceReference && left.note === right.note && left.environment === right.environment
    && samePermissions(left.requestedPermissions, right.requestedPermissions) && samePermissions(left.grantedPermissions, right.grantedPermissions);
}
function requireNextReceipt(records: readonly SourceFileRecord[], artifact: SourceFileArtifact): void {
  const first = records[0], last = records.at(-1);
  if (first !== undefined && artifact.sourceReference !== first.artifact.sourceReference) throw new RangeError("Source reference differs from this workspace's recorded file stream. Use its exact original reference; a different stream requires a separate workspace.");
  const previousRevision = records.find((record): boolean => record.artifact.revision === artifact.revision);
  if (previousRevision !== undefined) {
    if (!sameSourcePayload(previousRevision.artifact, artifact) || previousRevision.artifact.sourceUpdatedAt !== artifact.sourceUpdatedAt) throw new RangeError("Source revision conflicts with its earlier recorded declaration. A revision cannot identify different source contents or update times; no capture was recorded.");
    throw new RangeError("This source revision was already captured. Inspect its preserved evidence instead of duplicating the capture.");
  }
  if (last !== undefined) {
    const update = Date.parse(artifact.sourceUpdatedAt), previousUpdate = Date.parse(last.artifact.sourceUpdatedAt);
    if (update < previousUpdate) throw new RangeError("Source update time predates the latest recorded file revision. Inspect the newer evidence; no stale candidate was captured.");
    if (update === previousUpdate && !sameSourcePayload(last.artifact, artifact)) throw new RangeError("Changed source contents require a strictly later declared update time. Equal-time conflicting contents cannot establish revision order; no capture was recorded.");
  }
}
/** Validate every marked receipt and its stream relationships without changing or reinterpreting unmarked history. */
export function sourceFileArtifacts(state: SharedState | ClarificationState): readonly SourceFileRecord[] {
  const current = validatedHistory(state), records: SourceFileRecord[] = [];
  for (const event of current.sources) {
    const artifact = sourceFileFromEvidence(event.evidence);
    if (artifact !== null) {
      requireNextReceipt(records, artifact);
      records.push({ sourceEventId: event.id, evidenceId: event.evidence.id, recordedAt: event.recordedAt, artifact });
    }
  }
  return records;
}
/** Candidate impact uses current recorded bases. The transient target reuses no new persisted identity and cannot create a review or outcome. */
export function previewSourceFile(state: SharedState | ClarificationState, artifact: SourceFileArtifact, checkedAt: string): SourceFilePreview {
  const current = validatedHistory(state), candidate = canonicalArtifact(SourceFileArtifactSchema.parse(artifact)), records = sourceFileArtifacts(current);
  const checked = z.iso.datetime().parse(checkedAt), latest = current.sources.at(-1);
  if (latest === undefined) throw new ReferenceError("Source file inspection requires the workspace's canonical baseline.");
  if (candidate.sourceId !== current.source.id) throw new RangeError("Source file belongs to a different canonical source. Download a template from this workspace before preparing its candidate.");
  if (Date.parse(candidate.capturedAt) < Date.parse(latest.evidence.capturedAt)) throw new RangeError("Candidate capture time predates the latest evidence. Prepare a later capture; no history was changed.");
  const recordedTimes = [
    ...current.sources.map((event): string => event.recordedAt), ...current.reviews.map((review): string => review.openedAt),
    ...current.outcomes.map((outcome): string => outcome.recordedAt),
    ...(current.schemaVersion === 6 ? current.replacements.map((replacement): string => replacement.recordedAt) : []),
  ];
  if (Date.parse(candidate.capturedAt) > Date.parse(checked) || recordedTimes.some((time): boolean => Date.parse(time) > Date.parse(checked))) throw new RangeError("Candidate capture or recorded history is later than this inspection time. Correct the declared times before inspection; no evidence was recorded.");
  requireNextReceipt(records, candidate);
  const previous = latest.evidence;
  const changes: SourceFileChanges = {
    requestedAdded: candidate.requestedPermissions.filter((permission): boolean => !previous.requestedPermissions.includes(permission)),
    requestedRemoved: previous.requestedPermissions.filter((permission): boolean => !candidate.requestedPermissions.includes(permission)).sort(),
    grantedAdded: candidate.grantedPermissions.filter((permission): boolean => !previous.grantedPermissions.includes(permission)),
    grantedRemoved: previous.grantedPermissions.filter((permission): boolean => !candidate.grantedPermissions.includes(permission)).sort(),
    environmentChanged: previous.environment !== candidate.environment,
  };
  const target: SharedEvidence = { ...previous, capturedAt: candidate.capturedAt, sourceNote: sourceFileReceipt(candidate), requestedPermissions: candidate.requestedPermissions, grantedPermissions: candidate.grantedPermissions, environment: candidate.environment };
  const changed = changes.requestedAdded.length > 0 || changes.requestedRemoved.length > 0 || changes.grantedAdded.length > 0 || changes.grantedRemoved.length > 0 || changes.environmentChanged;
  return {
    artifact: candidate, sourceEventId: latest.id, evidenceId: previous.id, payloadStatus: changed ? "changed" : "unchanged", changes,
    impacts: current.originalDecisions.map((record): SourceFileDecisionImpact => ({ decisionId: record.decision.id, title: record.decision.title, ...sharedImpact(current, record, sharedBasis(current, record.decision.id), target) })),
  };
}
/** Recheck the complete current history at the explicit human capture boundary; preview alone never appends evidence. */
export function sourceFileEvidenceInput(state: SharedState | ClarificationState, artifact: SourceFileArtifact, recordedAt: string): SharedEvidenceInput {
  const candidate = previewSourceFile(state, artifact, recordedAt).artifact;
  return SharedEvidenceInputSchema.parse({ capturedAt: candidate.capturedAt, sourceNote: sourceFileReceipt(candidate), requestedPermissions: candidate.requestedPermissions, grantedPermissions: candidate.grantedPermissions, environment: candidate.environment });
}
/** Downloadable preparation copies declared fields only; timestamps and opaque revisions confer no source authenticity or runtime assurance. */
export function createSourceFileTemplate(state: SharedState | ClarificationState, capturedAt: string): SourceFileArtifact {
  const current = validatedHistory(state), records = sourceFileArtifacts(current), latest = current.sources.at(-1);
  if (latest === undefined) throw new ReferenceError("A canonical source capture is required before preparing a source file template.");
  const capture = z.iso.datetime().parse(capturedAt);
  return canonicalArtifact(SourceFileArtifactSchema.parse({
    artifactSchemaVersion: 1, sourceId: current.source.id, sourceReference: records[0]?.artifact.sourceReference ?? `https://example.org/synthetic/${current.source.id}.json`,
    revision: `synthetic-${capture}`, sourceUpdatedAt: capture, capturedAt: capture,
    requestedPermissions: latest.evidence.requestedPermissions, grantedPermissions: latest.evidence.grantedPermissions, environment: latest.evidence.environment,
    provenance: "Synthetic", observedActivity: "Not observed", note: "Synthetic local source declaration for technical rehearsal only; this file does not authenticate a source or observe runtime activity.",
  }));
}
