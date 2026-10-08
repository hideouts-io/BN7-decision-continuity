import type { BasisChangedFact, BasisComparison, BasisRecordChange, BasisReference } from "./basis-comparison.ts";
import type { BasisInspection, BasisSnapshot } from "./decision-basis.ts";
import type { BasisReceiptContext } from "./basis-receipts.ts";
import type { UncertaintyBasisContext, UncertaintyBasisRequirement } from "./uncertainty-basis.ts";
import type { UncertaintyResolution } from "./uncertainty-model.ts";

export type BasisReviewBriefFact = Readonly<{ key: string; label: string; value: string; references: readonly BasisReference[] }>;
export type BasisReviewBriefSection = Readonly<{
  key: "decision" | "evidence" | "questions" | "human-review"; title: string;
  from: readonly BasisReviewBriefFact[]; to: readonly BasisReviewBriefFact[];
  changes: readonly BasisChangedFact[]; recordChanges: readonly BasisRecordChange[];
}>;
export type BasisReviewBrief = Readonly<{
  direction: BasisComparison["direction"]; sections: readonly BasisReviewBriefSection[]; limitations: readonly string[];
}>;
type Side = "from" | "to";

function reference(kind: BasisReference["kind"], id: string): BasisReference { return { kind, id }; }
function uniqueReferences(items: readonly BasisReference[]): readonly BasisReference[] {
  return items.filter((item, index: number): boolean => items.findIndex((candidate): boolean => candidate.kind === item.kind && candidate.id === item.id) === index);
}
function fact(key: string, label: string, value: string, references: readonly BasisReference[]): BasisReviewBriefFact {
  return { key, label, value, references: uniqueReferences(references) };
}
function captureReferences(capture: BasisSnapshot["knownSource"]): readonly BasisReference[] {
  return [reference("source", capture.evidence.sourceId), reference("source-event", capture.id), reference("evidence", capture.evidence.id)];
}

/** Negative statements concern this selected cut, anchored to its preserved decision and included records. */
function cutReferences(snapshot: BasisSnapshot): readonly BasisReference[] {
  return uniqueReferences([
    reference("decision", snapshot.record.decision.id), reference("assumption", snapshot.record.assumption.id), ...captureReferences(snapshot.knownSource),
    ...snapshot.reviews.map((item): BasisReference => reference("review", item.id)),
    ...snapshot.outcomes.map((item): BasisReference => reference("outcome", item.id)),
    ...snapshot.replacements.map((item): BasisReference => reference("replacement", item.id)),
  ]);
}
function activeReferences(snapshot: BasisSnapshot): readonly BasisReference[] {
  const terminal = snapshot.outcomes.filter((item): boolean => item.outcome !== "defer").at(-1);
  const original = [reference("decision", snapshot.record.decision.id), reference("assumption", snapshot.record.assumption.id)];
  if (terminal !== undefined) return [...original, reference("outcome", terminal.id), reference("review", terminal.reviewId), reference("source-event", terminal.sourceEventId), reference("evidence", terminal.evidenceId)];
  if (snapshot.support === null) throw new ReferenceError("A review brief requires the original supporting capture or the exact terminal outcome that produced withdrawal.");
  return [...original, ...captureReferences(snapshot.support)];
}
function decisionFacts(comparison: BasisComparison, side: Side): readonly BasisReviewBriefFact[] {
  const snapshot = comparison[side].historical, basis = snapshot.basis, refs = activeReferences(snapshot), absent = "No active decision basis · withdrawn";
  return [
    fact("active-scope", "Recorded decision scope", basis?.statement ?? absent, refs),
    fact("active-revision", "Active recorded revision", basis?.revision ?? absent, refs),
    fact("active-boundary", "Recorded accepted boundary · grants no access", basis?.acceptedPermissions.toSorted().join(", ") ?? absent, refs),
    fact("active-actor", "Responsible fictional code", basis?.actor ?? absent, refs),
    fact("active-rationale", "Accountable recorded rationale", basis?.rationale ?? absent, refs),
    ...comparison.preservedOriginalRules.map((rule): BasisReviewBriefFact => fact(`original-${rule.key}`, rule.label, rule.value, rule.references)),
  ];
}
function receiptFacts(context: BasisReceiptContext, snapshot: BasisSnapshot): readonly BasisReviewBriefFact[] {
  const role = context.role, capture = context.capture, label = role === "known" ? "Latest capture known at this endpoint" : role === "support" ? "Active basis supporting capture" : "Frozen pending-review target";
  const refs = capture === null ? cutReferences(snapshot) : captureReferences(capture);
  const declaration = capture === null ? context.message : `${capture.evidence.environment} · requested: ${capture.evidence.requestedPermissions.toSorted().join(", ")} · declared grants: ${capture.evidence.grantedPermissions.toSorted().join(", ")}`;
  const receipt = context.status === "declared" ? `Declared reference: ${context.artifact.sourceReference}\nOpaque revision: ${context.artifact.revision}\nDeclared source update · UTC: ${context.artifact.sourceUpdatedAt}` : `${context.status} · ${context.message}`;
  return [
    fact(`${role}-declaration`, label, declaration, refs),
    fact(`${role}-receipt`, `${label} · source declaration`, receipt, refs),
    fact(`${role}-runtime`, `${label} · recorded runtime status`, capture?.evidence.observedActivity ?? context.message, refs),
    ...(capture === null ? [] : [fact(`${role}-capture`, `${label} · exact capture`, `Source event ${capture.id}\nEvidence ${capture.evidence.id}\nCaptured · UTC ${capture.evidence.capturedAt}\nRecorded · UTC ${capture.recordedAt}`, refs)]),
  ];
}
function evidenceFacts(comparison: BasisComparison, side: Side): readonly BasisReviewBriefFact[] {
  const contexts = comparison.receiptContexts[side];
  return (["known", "support", "pending"] as const).flatMap((role): readonly BasisReviewBriefFact[] => {
    const matching = contexts.filter((item): boolean => item.role === role), context = matching[0];
    if (context === undefined || matching.length !== 1) throw new ReferenceError(`A review brief requires one exact ${side} ${role} source context. No receipt role was substituted.`);
    return receiptFacts(context, comparison[side].historical);
  });
}
function requirementReferences(context: UncertaintyBasisRequirement): readonly BasisReference[] {
  const item = context.requirement;
  return [reference("requirement", item.id), reference("review", item.reviewId), reference("outcome", item.deferredOutcomeId), reference("source-event", item.sourceEventId), reference("evidence", item.evidenceId)];
}
function responseReferences(item: UncertaintyResolution): readonly BasisReference[] {
  return [reference("resolution", item.id), reference("requirement", item.requirementId), reference("source-event", item.sourceEventId), reference("evidence", item.evidenceId)];
}
function statusReferences(context: UncertaintyBasisRequirement): readonly BasisReference[] {
  const response = context.resolutions.at(-1);
  return uniqueReferences([...requirementReferences(context), ...(response === undefined ? [] : responseReferences(response))]);
}
function requirementFacts(context: UncertaintyBasisRequirement): readonly BasisReviewBriefFact[] {
  const item = context.requirement, refs = requirementReferences(context), key = `requirement-${item.id}`;
  return [
    fact(`${key}-question`, "Recorded evidence question", item.question, refs),
    fact(`${key}-required-evidence`, "Recorded required evidence", item.requiredEvidence, refs),
    fact(`${key}-trigger`, "Recorded reassessment trigger", item.triggerDescription, refs),
    fact(`${key}-criterion`, "Structured declared-context criterion", `${item.field} = ${item.expectedEnvironment}`, refs),
    fact(`${key}-actor`, "Assigned fictional code", item.actor, refs),
    fact(`${key}-status`, "Evidence requirement state · separate from approval", context.status, statusReferences(context)),
    ...context.resolutions.map((response): BasisReviewBriefFact => fact(`response-${response.id}`, "Recorded accountable evidence response · separate from decision outcome", `${response.result} · ${response.actor}\nRecorded · UTC ${response.recordedAt}\n${response.rationale}`, responseReferences(response))),
  ];
}
function questionFacts(snapshot: BasisSnapshot, context: UncertaintyBasisContext | null): readonly BasisReviewBriefFact[] {
  if (context === null) return [fact("questions-state", "Evidence-question context", "The v7 evidence-question journal is not part of this comparison. No requirement state was inferred.", cutReferences(snapshot))];
  const summary = context.requirements.length === 0 ? "No evidence requirement is included in this selected cut." : context.requirements.map((item): string => item.status).join(" · ");
  const references = context.requirements.length === 0 ? cutReferences(snapshot) : context.requirements.flatMap(statusReferences);
  return [fact("questions-state", "Recorded evidence requirement states · separate from approval", summary, references), ...context.requirements.flatMap(requirementFacts)];
}
function humanReviewFacts(snapshot: BasisSnapshot): readonly BasisReviewBriefFact[] {
  const review = snapshot.pendingReview, outcome = snapshot.outcomes.at(-1), replacement = snapshot.replacements.at(-1), absent = cutReferences(snapshot);
  const reviewRefs = review === null ? absent : [reference("review", review.id), reference("source-event", review.sourceEventId), reference("evidence", review.evidenceId), reference("source-event", review.basis.sourceEventId), reference("evidence", review.basis.evidenceId)];
  return [
    fact("pending-review", "Pending human review · frozen basis and target", review === null ? "No pending review is included in this selected cut." : `${review.actor} · ${review.trigger} · review pending`, reviewRefs),
    fact("pending-review-basis", "Exact frozen review basis · distinct from the latest capture", review === null ? "No frozen pending-review basis applies in this selected cut." : `Revision ${review.basis.revision}\n${review.basis.statement}\nAccepted boundary: ${review.basis.acceptedPermissions.toSorted().join(", ")}`, reviewRefs),
    fact("latest-outcome", "Last included accountable outcome · deferral preserves the earlier basis", outcome === undefined ? "No human outcome is included in this selected cut." : `${outcome.outcome} · ${outcome.actor}\n${outcome.statement}\n${outcome.rationale}`, outcome === undefined ? absent : [reference("outcome", outcome.id), reference("review", outcome.reviewId), reference("source-event", outcome.sourceEventId), reference("evidence", outcome.evidenceId)]),
    fact("latest-replacement", "Last included atomic review replacement · separate from decision change", replacement === undefined ? "No review replacement is included in this selected cut." : `${replacement.oldReviewId} → ${replacement.newReviewId}\n${replacement.rationale}`, replacement === undefined ? absent : [reference("replacement", replacement.id), reference("review", replacement.oldReviewId), reference("review", replacement.newReviewId), reference("outcome", replacement.deferredOutcomeId)]),
  ];
}

function changedSection(key: string): BasisReviewBriefSection["key"] {
  if (key.startsWith("active-")) return "decision";
  if (key.startsWith("support-") || key.startsWith("known-")) return "evidence";
  if (key.startsWith("pending-") || key.startsWith("recorded-")) return "human-review";
  throw new ReferenceError(`Review brief cannot classify changed fact ${key}. Preserve its full comparison and add an explicit supported section; no change was hidden.`);
}
/** Empty comparison references express absence at this cut; anchors cite its records, not invented missing metadata. */
function anchoredChange(comparison: BasisComparison, item: BasisChangedFact): BasisChangedFact {
  return { ...item, fromReferences: item.fromReferences.length === 0 ? cutReferences(comparison.from.historical) : item.fromReferences, toReferences: item.toReferences.length === 0 ? cutReferences(comparison.to.historical) : item.toReferences };
}

/** A reference must resolve inside its selected cut; `.latest` and opposite-endpoint records supply no evidence. */
function requireReferences(inspection: BasisInspection, receipts: readonly BasisReceiptContext[], journal: UncertaintyBasisContext | null, references: readonly BasisReference[]): void {
  const snapshot = inspection.historical, requirements = journal?.requirements ?? [], responses = requirements.flatMap((item): readonly UncertaintyResolution[] => item.resolutions);
  const captures = [snapshot.knownSource, ...(snapshot.support === null ? [] : [snapshot.support]), ...receipts.flatMap((item): readonly BasisSnapshot["knownSource"][] => item.capture === null ? [] : [item.capture])];
  const sourceIds = [snapshot.record.assumption.sourceId, ...captures.map((item): string => item.evidence.sourceId)];
  const sourceEventIds = [...captures.map((item): string => item.id), ...snapshot.reviews.flatMap((item): readonly string[] => [item.sourceEventId, item.basis.sourceEventId]), ...snapshot.outcomes.map((item): string => item.sourceEventId), ...snapshot.replacements.flatMap((item): readonly string[] => [item.oldSourceEventId, item.newSourceEventId]), ...requirements.map((item): string => item.requirement.sourceEventId), ...responses.map((item): string => item.sourceEventId)];
  const evidenceIds = [snapshot.record.decision.evidenceId, snapshot.record.assumption.baselineId, ...captures.map((item): string => item.evidence.id), ...snapshot.reviews.flatMap((item): readonly string[] => [item.evidenceId, item.basis.evidenceId]), ...snapshot.outcomes.map((item): string => item.evidenceId), ...snapshot.replacements.flatMap((item): readonly string[] => [item.oldEvidenceId, item.newEvidenceId]), ...requirements.map((item): string => item.requirement.evidenceId), ...responses.map((item): string => item.evidenceId)];
  for (const item of references) {
    let included: boolean;
    switch (item.kind) {
      case "decision": included = item.id === snapshot.record.decision.id; break;
      case "assumption": included = item.id === snapshot.record.assumption.id; break;
      case "source": included = sourceIds.includes(item.id); break;
      case "source-event": included = sourceEventIds.includes(item.id) && inspection.includedEventIds.includes(item.id); break;
      case "evidence": included = evidenceIds.includes(item.id); break;
      case "review": included = snapshot.reviews.some((record): boolean => record.id === item.id); break;
      case "outcome": included = snapshot.outcomes.some((record): boolean => record.id === item.id); break;
      case "replacement": included = snapshot.replacements.some((record): boolean => record.id === item.id); break;
      case "requirement": included = requirements.some((record): boolean => record.requirement.id === item.id) && inspection.includedEventIds.includes(item.id); break;
      case "resolution": included = responses.some((record): boolean => record.id === item.id) && inspection.includedEventIds.includes(item.id); break;
    }
    if (!included) throw new ReferenceError(`Review brief reference ${item.kind} ${item.id} is not supported inside its selected endpoint. No later or opposite-endpoint record was substituted.`);
  }
}

/**
 * A concise record-supported projection, not a fresh assurance verdict or rule evaluation.
 * Every existing changed fact, receipt change, clarification change and membership list remains
 * available. Context uses only the two selected historical snapshots; no live/latest state fills
 * gaps. Requirement satisfaction remains separate from frozen review and accountable outcomes.
 */
export function basisReviewBrief(comparison: BasisComparison): BasisReviewBrief {
  if (comparison.ruleVersionStatus !== "unrecorded") throw new RangeError("The review brief supports preserved records with unrecorded historical rule versions only. No rule execution or version was inferred.");
  if (comparison.from.historical.record.decision.id !== comparison.to.historical.record.decision.id) throw new ReferenceError("A review brief requires two perspectives of the same exact preserved decision.");
  const changes = comparison.changedFacts.map((item): Readonly<{ section: BasisReviewBriefSection["key"]; fact: BasisChangedFact }> => ({ section: changedSection(item.key), fact: anchoredChange(comparison, item) }));
  const sections: readonly BasisReviewBriefSection[] = [
    { key: "decision", title: "Recorded decision basis", from: decisionFacts(comparison, "from"), to: decisionFacts(comparison, "to"), changes: changes.filter((item): boolean => item.section === "decision").map((item): BasisChangedFact => item.fact), recordChanges: [] },
    { key: "evidence", title: "Evidence and source declarations", from: evidenceFacts(comparison, "from"), to: evidenceFacts(comparison, "to"), changes: [...changes.filter((item): boolean => item.section === "evidence").map((item): BasisChangedFact => item.fact), ...comparison.receiptChanges.map((item): BasisChangedFact => anchoredChange(comparison, item))], recordChanges: [] },
    { key: "questions", title: "Evidence questions and responses", from: questionFacts(comparison.from.historical, comparison.clarificationContexts?.from ?? null), to: questionFacts(comparison.to.historical, comparison.clarificationContexts?.to ?? null), changes: comparison.clarificationChanges.map((item): BasisChangedFact => anchoredChange(comparison, item)), recordChanges: [] },
    { key: "human-review", title: "Separate human review and outcomes", from: humanReviewFacts(comparison.from.historical), to: humanReviewFacts(comparison.to.historical), changes: changes.filter((item): boolean => item.section === "human-review").map((item): BasisChangedFact => item.fact), recordChanges: comparison.recordChanges },
  ];
  for (const side of ["from", "to"] as const) {
    const inspection = comparison[side], receipts = comparison.receiptContexts[side], journal = comparison.clarificationContexts?.[side] ?? null;
    for (const section of sections) {
      for (const item of section[side]) requireReferences(inspection, receipts, journal, item.references);
      for (const item of section.changes) requireReferences(inspection, receipts, journal, side === "from" ? item.fromReferences : item.toReferences);
      for (const item of section.recordChanges) requireReferences(inspection, receipts, journal, (side === "from" ? item.removedIds : item.addedIds).map((id): BasisReference => reference(item.kind === "deferral" ? "outcome" : item.kind, id)));
    }
  }
  return { direction: comparison.direction, sections, limitations: [
    "This brief compares preserved records; it does not freshly evaluate whether the decision still holds or recommend approval.",
    "Requested permissions, declared grants and accepted decision boundaries are independent. Declarations do not authenticate a source or demonstrate runtime behavior.",
    "Historical rule versions were not recorded. Original assumptions are cited as preserved records, not reconstructed historical rule execution.",
    "Satisfaction addresses only the recorded evidence requirement. A separate accountable review outcome changes a decision; deferral and replacement supply no approval.",
    "An assigned fictional code does not authenticate a person. Internal references and selected cuts do not prove completeness of omitted upstream records, practitioner usefulness or demand.",
  ] };
}
