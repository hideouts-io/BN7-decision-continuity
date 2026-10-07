import { z } from "zod";
import { ClarificationStateSchema } from "./clarification-model.ts";
import type { ClarificationState, ClarificationHistory } from "./clarification-model.ts";
import type { BasisChangedFact, BasisReference } from "./basis-comparison.ts";
import type { BasisInspection } from "./decision-basis.ts";
import { sourceFileFromEvidence } from "./source-file.ts";
import type { SourceFileArtifact } from "./source-file.ts";

export type BasisReceiptRole = "support" | "known" | "pending";
type SourceCapture = ClarificationState["sources"][number];
type CapturedContext = Readonly<{ role: BasisReceiptRole; capture: SourceCapture; message: string }>;
export type BasisReceiptContext =
  | Readonly<{ role: BasisReceiptRole; status: "absent"; capture: null; message: string }>
  | (CapturedContext & Readonly<{ status: "manual" | "invalid" }>)
  | (CapturedContext & Readonly<{ status: "declared"; artifact: SourceFileArtifact }>);
type ReceiptFact = Readonly<{ key: string; label: string; value: string; references: readonly BasisReference[] }>;
const roles: readonly BasisReceiptRole[] = ["support", "known", "pending"];

function captureReferences(capture: SourceCapture | null): readonly BasisReference[] {
  if (capture === null) return [];
  return [
    { kind: "source", id: capture.evidence.sourceId },
    { kind: "source-event", id: capture.id },
    { kind: "evidence", id: capture.evidence.id },
  ];
}

/** A selected role must resolve the exact record inside this cut, never a later receipt for the same source. */
function exactCapture(state: ClarificationHistory, inspection: BasisInspection, sourceEventId: string, evidenceId: string): SourceCapture {
  const capture = state.sources.find((event): boolean => event.id === sourceEventId && event.evidence.id === evidenceId);
  if (capture === undefined || !inspection.includedEventIds.includes(capture.id)) throw new ReferenceError("Source receipt context requires the exact source-event/evidence pair inside its selected recorded endpoint. No later capture was substituted.");
  return capture;
}

function invalidMessage(error: z.ZodError | SyntaxError | RangeError): string {
  if (error instanceof z.ZodError) {
    const fields = [...new Set(error.issues.map((issue): string => `${issue.path.join(".") || "artifact"} (${issue.code})`))];
    return `Stored source receipt fails its closed declaration contract: ${fields.join(", ")}. Inspect the exact preserved note; no source metadata was inferred.`;
  }
  return `${error.message} Historical receipt context is unavailable; the exact capture and saved history remain preserved.`;
}

/** Validate only this immutable capture's receipt, not the entire stream or the authenticity of its source. */
function capturedContext(role: BasisReceiptRole, capture: SourceCapture): BasisReceiptContext {
  try {
    const artifact = sourceFileFromEvidence(capture.evidence);
    if (artifact === null) return { role, status: "manual", capture, message: "This exact capture has an unmarked source note. Declared source reference, revision and update time were not recorded; a later receipt cannot fill them." };
    return { role, status: "declared", capture, artifact, message: "This synthetic declaration validates against its exact enclosing evidence. It does not authenticate the source, certify stream order or establish runtime behavior." };
  } catch (error) {
    if (!(error instanceof z.ZodError || error instanceof SyntaxError || error instanceof RangeError)) throw error;
    return { role, status: "invalid", capture, message: invalidMessage(error) };
  }
}

/**
 * Explain the selected causal cut's support, latest known capture and frozen pending-review target.
 * Missing or invalid metadata remains explicit; no `.latest` snapshot, stream scan, revision sorting,
 * current rule evaluation, network request or history mutation contributes to this read-only view.
 */
export function basisReceiptContexts(input: ClarificationState, inspection: BasisInspection): readonly BasisReceiptContext[] {
  return basisReceiptContextsFromRecords(ClarificationStateSchema.parse(input), inspection);
}

/** Capture-local explanation for records already validated by their own history contract. */
export function basisReceiptContextsFromRecords(state: ClarificationHistory, inspection: BasisInspection): readonly BasisReceiptContext[] {
  const snapshot = inspection.historical;
  const basis = snapshot.basis, support = snapshot.support;
  let supporting: BasisReceiptContext;
  if (basis === null) {
    if (support !== null) throw new ReferenceError("A withdrawn decision cannot supply an active supporting capture for receipt inspection.");
    supporting = { role: "support", status: "absent", capture: null, message: "This selected decision was withdrawn. No active supporting capture applies; its earlier recorded evidence remains preserved." };
  } else {
    if (support === null || support.id !== basis.sourceEventId || support.evidence.id !== basis.evidenceId) throw new ReferenceError("Active decision receipt context requires its exact recorded basis source-event/evidence references.");
    supporting = capturedContext("support", exactCapture(state, inspection, basis.sourceEventId, basis.evidenceId));
  }
  const known = exactCapture(state, inspection, snapshot.knownSource.id, snapshot.knownSource.evidence.id);
  const lastIncluded = state.sources.filter((event): boolean => inspection.includedEventIds.includes(event.id)).at(-1);
  if (lastIncluded === undefined || lastIncluded.id !== known.id) throw new ReferenceError("Latest known source receipt context must use the last capture included in this endpoint, not the application's latest capture.");
  const review = snapshot.pendingReview;
  let pending: BasisReceiptContext;
  if (review === null) pending = { role: "pending", status: "absent", capture: null, message: "No pending review was recorded in this selected perspective. No frozen review target applies." };
  else {
    const recorded = state.reviews.find((item): boolean => item.id === review.id);
    if (recorded === undefined || !snapshot.reviews.some((item): boolean => item.id === review.id)
      || recorded.sourceEventId !== review.sourceEventId || recorded.evidenceId !== review.evidenceId) throw new ReferenceError("Pending review receipt context requires its exact frozen review and source-event/evidence references in this endpoint.");
    pending = capturedContext("pending", exactCapture(state, inspection, review.sourceEventId, review.evidenceId));
  }
  return [supporting, capturedContext("known", known), pending];
}

function roleContext(contexts: readonly BasisReceiptContext[], role: BasisReceiptRole): BasisReceiptContext {
  const found = contexts.filter((context): boolean => context.role === role);
  const context = found[0];
  if (context === undefined || found.length !== 1) throw new ReferenceError(`Receipt comparison requires exactly one ${role} context at each selected endpoint.`);
  return context;
}

function receiptFacts(context: BasisReceiptContext): readonly ReceiptFact[] {
  const role = context.role, label = role === "support" ? "Supporting capture" : role === "known" ? "Latest capture known at endpoint" : "Frozen pending-review target";
  const refs = captureReferences(context.capture), unavailable = context.status === "absent" ? context.message : context.status === "manual" ? "Not recorded in this unmarked capture" : "Unavailable · invalid reserved receipt";
  const artifact = context.status === "declared" ? context.artifact : null;
  const note = context.status === "declared" ? context.artifact.note : context.status === "manual" ? context.capture.evidence.sourceNote : unavailable;
  const values: readonly (readonly [string, string, string])[] = [
    ["status", "receipt status", `${context.status} · ${context.message}`],
    ["source-event", "source event UUID", context.capture?.id ?? unavailable],
    ["evidence", "evidence UUID", context.capture?.evidence.id ?? unavailable],
    ["source-reference", "declared source reference", artifact?.sourceReference ?? unavailable],
    ["revision", "declared opaque source revision", artifact?.revision ?? unavailable],
    ["source-updated-at", "declared source update · UTC", artifact?.sourceUpdatedAt ?? unavailable],
    ["captured-at", "capture declaration · UTC", context.capture?.evidence.capturedAt ?? unavailable],
    ["recorded-at", "capture recorded · UTC", context.capture?.recordedAt ?? unavailable],
    ["note", "recorded declaration note", note],
  ];
  return values.map(([key, detail, value]): ReceiptFact => ({ key: `receipt-${role}-${key}`, label: `${label} · ${detail}`, value, references: refs }));
}

/** Compare validated endpoint-local declarations; opaque revisions and update times establish no causal direction. */
export function compareReceiptContexts(from: readonly BasisReceiptContext[], to: readonly BasisReceiptContext[]): readonly BasisChangedFact[] {
  return roles.flatMap((role): readonly BasisChangedFact[] => {
    const before = receiptFacts(roleContext(from, role)), after = receiptFacts(roleContext(to, role));
    return before.flatMap((fact): readonly BasisChangedFact[] => {
      const next = after.find((item): boolean => item.key === fact.key);
      if (next === undefined) throw new ReferenceError(`Receipt comparison requires ${fact.key} at both selected endpoints.`);
      return fact.value === next.value ? [] : [{ key: fact.key, label: fact.label, fromValue: fact.value, toValue: next.value, fromReferences: fact.references, toReferences: next.references }];
    });
  });
}
