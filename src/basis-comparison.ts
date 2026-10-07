import { ClarificationStateSchema } from "./clarification-model.ts";
import type { ClarificationState } from "./clarification-model.ts";
import { decisionBasisAt } from "./decision-basis.ts";
import type { BasisInspection, BasisSnapshot } from "./decision-basis.ts";
import type { ContinuityPermission } from "./continuity-model.ts";

export type BasisReference = Readonly<{
  kind: "decision" | "assumption" | "source" | "source-event" | "evidence" | "review" | "outcome" | "replacement";
  id: string;
}>;
export type BasisChangedFact = Readonly<{
  key: string; label: string; fromValue: string; toValue: string;
  fromReferences: readonly BasisReference[]; toReferences: readonly BasisReference[];
}>;
export type BasisRecordChange = Readonly<{
  kind: "review" | "outcome" | "deferral" | "replacement";
  addedIds: readonly string[]; removedIds: readonly string[];
}>;
export type BasisPreservedRule = Readonly<{
  key: string; label: string; value: string; references: readonly BasisReference[];
}>;
export type BasisComparison = Readonly<{
  from: BasisInspection; to: BasisInspection; direction: "same" | "forward" | "backward";
  addedEventIds: readonly string[]; removedEventIds: readonly string[];
  changedFacts: readonly BasisChangedFact[]; recordChanges: readonly BasisRecordChange[];
  preservedOriginalRules: readonly BasisPreservedRule[]; ruleVersionStatus: "unrecorded";
}>;
type SourceCapture = ClarificationState["sources"][number];
type EndpointFact = Readonly<{ key: string; label: string; value: string; references: readonly BasisReference[] }>;

function permissions(values: readonly ContinuityPermission[]): string { return values.toSorted().join(", "); }
function reference(kind: BasisReference["kind"], id: string): BasisReference { return { kind, id }; }
function fact(key: string, label: string, value: string, references: readonly BasisReference[]): EndpointFact {
  return { key, label, value, references };
}
function captureReferences(capture: SourceCapture): readonly BasisReference[] {
  return [reference("source", capture.evidence.sourceId), reference("source-event", capture.id), reference("evidence", capture.evidence.id)];
}

/** Every basis fact cites its original decision or the exact terminal outcome that produced it. */
function activeReferences(snapshot: BasisSnapshot): readonly BasisReference[] {
  const terminal = snapshot.outcomes.filter((outcome): boolean => outcome.outcome !== "defer").at(-1);
  const original = [reference("decision", snapshot.record.decision.id), reference("assumption", snapshot.record.assumption.id)];
  if (terminal === undefined) {
    if (snapshot.support === null) throw new ReferenceError("The original decision basis requires its exact supporting capture.");
    return [...original, ...captureReferences(snapshot.support)];
  }
  return [...original, reference("outcome", terminal.id), reference("review", terminal.reviewId), reference("source-event", terminal.sourceEventId), reference("evidence", terminal.evidenceId)];
}
function activeFacts(snapshot: BasisSnapshot): readonly EndpointFact[] {
  const basis = snapshot.basis, refs = activeReferences(snapshot), absent = "No active basis · withdrawn";
  return [
    fact("active-revision", "Active recorded revision", basis?.revision ?? absent, refs),
    fact("active-scope", "Decision scope", basis?.statement ?? absent, refs),
    fact("active-actor", "Responsible fictional code", basis?.actor ?? absent, refs),
    fact("active-rationale", "Recorded rationale", basis?.rationale ?? absent, refs),
    fact("active-boundary", "Accepted boundary", basis === null ? absent : permissions(basis.acceptedPermissions), refs),
    fact("active-decided-at", "Decision recorded · UTC", basis?.decidedAt ?? absent, refs),
  ];
}

function captureFacts(capture: SourceCapture, prefix: string, label: string): readonly EndpointFact[] {
  const evidence = capture.evidence, refs = captureReferences(capture);
  return [
    fact(`${prefix}-source`, `${label} · canonical source UUID`, evidence.sourceId, refs),
    fact(`${prefix}-source-event`, `${label} · source event UUID`, capture.id, refs),
    fact(`${prefix}-evidence`, `${label} · evidence UUID`, evidence.id, refs),
    fact(`${prefix}-requested`, `${label} · requested access`, permissions(evidence.requestedPermissions), refs),
    fact(`${prefix}-granted`, `${label} · declared granted access`, permissions(evidence.grantedPermissions), refs),
    fact(`${prefix}-environment`, `${label} · declared deployment context`, evidence.environment, refs),
    fact(`${prefix}-captured-at`, `${label} · captured UTC`, evidence.capturedAt, refs),
    fact(`${prefix}-recorded-at`, `${label} · recorded UTC`, capture.recordedAt, refs),
    fact(`${prefix}-source-note`, `${label} · source note`, evidence.sourceNote, refs),
    fact(`${prefix}-runtime`, `${label} · runtime`, evidence.observedActivity, refs),
    fact(`${prefix}-provenance`, `${label} · provenance`, evidence.provenance, refs),
  ];
}
function supportingFacts(snapshot: BasisSnapshot): readonly EndpointFact[] {
  if (snapshot.support !== null) return captureFacts(snapshot.support, "support", "Supporting capture");
  return ["source", "source-event", "evidence", "requested", "granted", "environment", "captured-at", "recorded-at", "source-note", "runtime", "provenance"].map((key): EndpointFact => fact(`support-${key}`, `Supporting capture · ${key}`, "No supporting capture · withdrawn", activeReferences(snapshot)));
}

/** Resolve only an exact frozen reference proven to exist inside this endpoint's causal cut. */
function pendingTarget(state: ClarificationState, inspection: BasisInspection): SourceCapture | null {
  const pending = inspection.historical.pendingReview;
  if (pending === null) return null;
  const target = state.sources.find((capture): boolean => capture.id === pending.sourceEventId && capture.evidence.id === pending.evidenceId);
  if (target === undefined || !inspection.includedEventIds.includes(target.id)) throw new ReferenceError(`Pending review ${pending.id} has no exact source/evidence capture inside this recorded endpoint.`);
  return target;
}
function pendingFacts(state: ClarificationState, inspection: BasisInspection): readonly EndpointFact[] {
  const snapshot = inspection.historical, pending = snapshot.pendingReview, target = pendingTarget(state, inspection);
  const deferrals = pending === null ? [] : snapshot.outcomes.filter((outcome): boolean => outcome.reviewId === pending.id && outcome.outcome === "defer");
  const refs = pending === null ? activeReferences(snapshot) : [reference("review", pending.id), reference("assumption", pending.assumptionId), reference("source-event", pending.sourceEventId), reference("evidence", pending.evidenceId)];
  const basisRefs = pending === null ? refs : [...refs, reference("source-event", pending.basis.sourceEventId), reference("evidence", pending.basis.evidenceId)];
  const status = pending === null ? "No pending review" : deferrals.length === 0 ? "Awaiting human outcome" : `Deferred · ${deferrals.length} recorded deferral${deferrals.length === 1 ? "" : "s"}`;
  return [
    fact("pending-review", "Pending review UUID", pending?.id ?? "None", refs),
    fact("pending-actor", "Assigned reviewer", pending?.actor ?? "None", refs),
    fact("pending-opened-at", "Review opened · UTC", pending?.openedAt ?? "None", refs),
    fact("pending-trigger", "Frozen review trigger", pending?.trigger ?? "None", refs),
    fact("pending-target-source-event", "Frozen review target · source event UUID", pending?.sourceEventId ?? "None", refs),
    fact("pending-target-evidence", "Frozen review target · evidence UUID", pending?.evidenceId ?? "None", refs),
    fact("pending-target-environment", "Frozen review target · deployment declaration", target?.evidence.environment ?? "None", refs),
    fact("pending-basis-revision", "Frozen review basis revision", pending?.basis.revision ?? "None", basisRefs),
    fact("pending-basis-scope", "Frozen review decision scope", pending?.basis.statement ?? "None", basisRefs),
    fact("pending-basis-boundary", "Frozen review accepted boundary", pending === null ? "None" : permissions(pending.basis.acceptedPermissions), basisRefs),
    fact("pending-basis-source-event", "Frozen review basis · source event UUID", pending?.basis.sourceEventId ?? "None", basisRefs),
    fact("pending-basis-evidence", "Frozen review basis · evidence UUID", pending?.basis.evidenceId ?? "None", basisRefs),
    fact("pending-status", "Pending review status", status, [...refs, ...deferrals.map((outcome): BasisReference => reference("outcome", outcome.id))]),
  ];
}
function historicalFacts(snapshot: BasisSnapshot): readonly EndpointFact[] {
  return [
    fact("recorded-reviews", "Recorded reviews", String(snapshot.reviews.length), snapshot.reviews.map((review): BasisReference => reference("review", review.id))),
    fact("recorded-outcomes", "Recorded outcomes", String(snapshot.outcomes.length), snapshot.outcomes.map((outcome): BasisReference => reference("outcome", outcome.id))),
    fact("recorded-deferrals", "Recorded deferrals", String(snapshot.outcomes.filter((outcome): boolean => outcome.outcome === "defer").length), snapshot.outcomes.filter((outcome): boolean => outcome.outcome === "defer").map((outcome): BasisReference => reference("outcome", outcome.id))),
    fact("recorded-replacements", "Recorded review replacements", String(snapshot.replacements.length), snapshot.replacements.map((replacement): BasisReference => reference("replacement", replacement.id))),
  ];
}
function endpointFacts(state: ClarificationState, inspection: BasisInspection): readonly EndpointFact[] {
  const snapshot = inspection.historical;
  return [...activeFacts(snapshot), ...supportingFacts(snapshot), ...captureFacts(snapshot.knownSource, "known", "Latest capture known at this endpoint"), ...pendingFacts(state, inspection), ...historicalFacts(snapshot)];
}
function changedFacts(from: readonly EndpointFact[], to: readonly EndpointFact[]): readonly BasisChangedFact[] {
  return from.flatMap((before): readonly BasisChangedFact[] => {
    const after = to.find((item): boolean => item.key === before.key);
    if (after === undefined) throw new ReferenceError(`Recorded-basis comparison requires fact ${before.key} at both endpoints.`);
    return before.value === after.value ? [] : [{ key: before.key, label: before.label, fromValue: before.value, toValue: after.value, fromReferences: before.references, toReferences: after.references }];
  });
}
function difference(left: readonly string[], right: readonly string[]): readonly string[] {
  const other = new Set(right);
  return left.filter((id): boolean => !other.has(id));
}
function recordChange(kind: BasisRecordChange["kind"], from: readonly string[], to: readonly string[]): BasisRecordChange {
  return { kind, addedIds: difference(to, from), removedIds: difference(from, to) };
}
function recordChanges(from: BasisSnapshot, to: BasisSnapshot): readonly BasisRecordChange[] {
  return [
    recordChange("review", from.reviews.map((review): string => review.id), to.reviews.map((review): string => review.id)),
    recordChange("outcome", from.outcomes.map((outcome): string => outcome.id), to.outcomes.map((outcome): string => outcome.id)),
    recordChange("deferral", from.outcomes.filter((outcome): boolean => outcome.outcome === "defer").map((outcome): string => outcome.id), to.outcomes.filter((outcome): boolean => outcome.outcome === "defer").map((outcome): string => outcome.id)),
    recordChange("replacement", from.replacements.map((replacement): string => replacement.id), to.replacements.map((replacement): string => replacement.id)),
  ].filter((change): boolean => change.addedIds.length > 0 || change.removedIds.length > 0);
}
function originalRules(snapshot: BasisSnapshot): readonly BasisPreservedRule[] {
  const assumption = snapshot.record.assumption, refs = [reference("decision", snapshot.record.decision.id), reference("assumption", assumption.id), reference("source", assumption.sourceId), reference("evidence", assumption.baselineId)];
  return [
    { key: "monitored-field", label: "Preserved original monitored field", value: assumption.field, references: refs },
    { key: "applicability-scope", label: "Preserved original applicability scope", value: assumption.scope, references: refs },
    { key: "assumption-description", label: "Preserved original assumption", value: assumption.description, references: refs },
    { key: "original-boundary", label: "Preserved original accepted boundary", value: permissions(assumption.acceptedPermissions), references: refs },
  ];
}

/**
 * Compare two preserved v6 perspectives without evaluating historical rules or mutating history.
 * Each endpoint reuses the validated, bounded causal inspector: atomic event aliases share a cut;
 * ambiguous/cyclic histories fail explicitly. Direction is set containment, never capture-time order.
 * Facts use only each inspection's historical snapshot; inherited `.latest` is not an endpoint.
 * Permission lists are compared as declared sets. Rule versions were not recorded, so this is a
 * record comparison rather than a reconstructed rule execution or an assurance verdict.
 */
export function compareDecisionBases(input: ClarificationState, decisionId: string, fromEventId: string, toEventId: string): BasisComparison {
  const state = ClarificationStateSchema.parse(input);
  const from = decisionBasisAt(state, decisionId, fromEventId), to = decisionBasisAt(state, decisionId, toEventId);
  const addedEventIds = difference(to.includedEventIds, from.includedEventIds), removedEventIds = difference(from.includedEventIds, to.includedEventIds);
  if (addedEventIds.length > 0 && removedEventIds.length > 0) throw new RangeError("The selected recorded endpoints have non-nested causal cuts. Their before/after direction cannot be established; select endpoints with a proven inclusive order. No history was changed.");
  const direction = addedEventIds.length > 0 ? "forward" : removedEventIds.length > 0 ? "backward" : "same";
  return { from, to, direction, addedEventIds, removedEventIds, changedFacts: changedFacts(endpointFacts(state, from), endpointFacts(state, to)), recordChanges: recordChanges(from.historical, to.historical), preservedOriginalRules: originalRules(from.historical), ruleVersionStatus: "unrecorded" };
}
