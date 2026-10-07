import type { ClarificationState } from "./clarification-model.ts";
import type { BasisInspection, BasisSnapshot } from "./decision-basis.ts";
import type { SharedReview } from "./shared-model.ts";
import { outcomeLabel } from "./journey.ts";
import { escapeHtml } from "./render.ts";

export type BasisColumn = "basis-historical" | "basis-latest";
type SourceCapture = ClarificationState["sources"][number];
type Fact = readonly [string, string, string];

function facts(prefix: string, entries: readonly Fact[]): string {
  return `<dl class="basis-facts">${entries.map(([suffix, label, value]): string => `<div><dt>${escapeHtml(label)}</dt><dd id="${prefix}-${suffix}" data-testid="${prefix}-${suffix}">${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
}

function captureFacts(prefix: string, capture: SourceCapture): string {
  const evidence = capture.evidence;
  return facts(prefix, [
    ["source", "Canonical source UUID", evidence.sourceId],
    ["source-event", "Source event UUID", capture.id],
    ["evidence-id", "Evidence UUID", evidence.id],
    ["requested", "Requested access", evidence.requestedPermissions.join(", ")],
    ["granted", "Declared granted access", evidence.grantedPermissions.join(", ")],
    ["environment", "Declared deployment context", evidence.environment],
    ["captured-at", "Captured · UTC", evidence.capturedAt],
    ["recorded-at", "Recorded · UTC", capture.recordedAt],
    ["runtime", "Runtime", evidence.observedActivity],
    ["provenance", "Provenance", evidence.provenance],
    ["note", "Source note", evidence.sourceNote],
  ]);
}

function reviewTarget(state: ClarificationState, review: SharedReview): SourceCapture {
  const capture = state.sources.find((item): boolean => item.id === review.sourceEventId && item.evidence.id === review.evidenceId);
  if (capture === undefined) throw new ReferenceError(`Review ${review.id} has no matching frozen source event and evidence.`);
  return capture;
}

function original(snapshot: BasisSnapshot, prefix: BasisColumn): string {
  const record = snapshot.record, assumption = record.assumption, decision = record.decision;
  return `<details class="basis-block" id="${prefix}-original" data-testid="${prefix}-original"><summary>Original decision and assumption · preserved</summary>${facts(`${prefix}-original`, [
    ["decision", "Decision UUID", decision.id], ["assumption", "Assumption UUID", assumption.id],
    ["field", "Monitored field", assumption.field], ["scope", "Applicability scope", assumption.scope],
    ["description", "Assumption description", assumption.description],
    ["boundary", "Original accepted boundary · read-only", assumption.acceptedPermissions.join(", ")],
    ["statement", "Original decision scope", decision.statement], ["revision", "Original revision", decision.revision],
    ["actor", "Responsible fictional code", decision.actor], ["rationale", "Original rationale", decision.rationale],
    ["recorded-at", "Decided · UTC", decision.decidedAt], ["source", "Canonical source UUID", assumption.sourceId],
    ["evidence", "Original evidence UUID", decision.evidenceId],
  ])}</details>`;
}

function activeBasis(snapshot: BasisSnapshot, prefix: BasisColumn): string {
  const basis = snapshot.basis;
  if (basis === null) return `<section class="basis-block"><h4>Active recorded decision basis</h4><p id="${prefix}-scope" data-testid="${prefix}-scope">Withdrawn. No active decision basis remains.</p><p class="basis-note">The original assumption, earlier scopes and recorded outcomes remain preserved.</p></section>`;
  return `<section class="basis-block"><h4>Active recorded decision basis</h4>${facts(prefix, [
    ["scope", "Decision scope", basis.statement], ["revision", "Revision", basis.revision],
    ["actor", "Responsible fictional code", basis.actor], ["rationale", "Recorded rationale", basis.rationale],
    ["boundary", "Accepted boundary", basis.acceptedPermissions.join(", ")],
    ["applicability", "Assumption applicability", snapshot.record.assumption.scope],
    ["decided-at", "Decided · UTC", basis.decidedAt],
  ])}<p class="basis-note">An accepted boundary records a decision; it grants no access.</p></section>`;
}

function supportingEvidence(snapshot: BasisSnapshot, prefix: BasisColumn): string {
  const support = snapshot.support;
  if (support === null) return `<section class="basis-block" id="${prefix}-evidence" data-testid="${prefix}-evidence"><h4>Supporting evidence for the active basis</h4><p>No active basis after withdrawal. Earlier evidence remains in the recorded history.</p></section>`;
  return `<details class="basis-block" id="${prefix}-evidence" data-testid="${prefix}-evidence"><summary>Supporting source and evidence for the active basis</summary>${captureFacts(`${prefix}-support`, support)}</details>`;
}

function pendingReview(state: ClarificationState, snapshot: BasisSnapshot, prefix: BasisColumn): string {
  const review = snapshot.pendingReview;
  if (review === null) return `<section class="basis-block" id="${prefix}-pending" data-testid="${prefix}-pending"><h4>Pending review</h4><p>No pending review in this recorded state.</p></section>`;
  const target = reviewTarget(state, review);
  return `<section class="basis-block basis-pending" id="${prefix}-pending" data-testid="${prefix}-pending"><h4>Pending review · frozen question</h4>${facts(`${prefix}-pending`, [
    ["review-id", "Review UUID", review.id], ["actor", "Assigned fictional code", review.actor],
    ["opened-at", "Opened · UTC", review.openedAt], ["trigger", "Recorded trigger", review.trigger],
    ["scope", "Frozen decision scope", review.basis.statement], ["revision", "Frozen basis revision", review.basis.revision],
    ["boundary", "Frozen accepted boundary", review.basis.acceptedPermissions.join(", ")],
    ["basis-source", "Frozen basis source event", review.basis.sourceEventId], ["basis-evidence", "Frozen basis evidence", review.basis.evidenceId],
    ["target-source", "Frozen target source event", review.sourceEventId], ["target-evidence", "Frozen target evidence", review.evidenceId],
    ["target-environment", "Frozen target declaration", target.evidence.environment],
  ])}<details><summary>Inspect the exact reviewed capture</summary>${captureFacts(`${prefix}-pending-target`, target)}</details><p class="basis-note">This target remains fixed when later captures arrive. A deferral or replacement supplies no approval.</p></section>`;
}

function reviewHistory(snapshot: BasisSnapshot, prefix: BasisColumn): string {
  return `<details class="basis-block" data-testid="${prefix}-reviews"><summary>Recorded reviews · ${snapshot.reviews.length}</summary>${snapshot.reviews.length === 0 ? "<p>No review recorded.</p>" : `<ol class="basis-records">${snapshot.reviews.map((review): string => `<li data-review-id="${escapeHtml(review.id)}"><strong>${escapeHtml(review.id)}</strong>${facts(`${prefix}-review-${review.id}`, [
    ["actor", "Assigned fictional code", review.actor], ["opened-at", "Opened · UTC", review.openedAt],
    ["trigger", "Recorded trigger", review.trigger], ["basis", "Frozen basis revision", review.basis.revision],
    ["scope", "Frozen decision scope", review.basis.statement], ["target", "Frozen source event / evidence", `${review.sourceEventId} / ${review.evidenceId}`],
  ])}</li>`).join("")}</ol>`}</details>`;
}

function outcomeHistory(snapshot: BasisSnapshot, prefix: BasisColumn): string {
  return `<details class="basis-block" id="${prefix}-outcomes" data-testid="${prefix}-outcomes"><summary>Recorded outcomes · ${snapshot.outcomes.length}</summary>${snapshot.outcomes.length === 0 ? "<p>No outcome recorded.</p>" : `<ol class="basis-records">${snapshot.outcomes.map((outcome): string => `<li data-outcome-id="${escapeHtml(outcome.id)}"><strong>${escapeHtml(outcomeLabel(outcome.outcome))}</strong>${facts(`${prefix}-outcome-${outcome.id}`, [
    ["id", "Outcome UUID", outcome.id], ["revision", "Recorded outcome revision", outcome.revision],
    ["actor", "Responsible fictional code", outcome.actor], ["recorded-at", "Recorded · UTC", outcome.recordedAt],
    ["rationale", "Recorded rationale", outcome.rationale], ["scope", "Resulting scope or interim action", outcome.statement],
    ["boundary", "Explicit revised boundary", outcome.acceptedPermissions === null ? "No boundary change recorded by this outcome" : outcome.acceptedPermissions.join(", ")],
    ["review", "Review UUID", outcome.reviewId], ["target", "Source event / evidence", `${outcome.sourceEventId} / ${outcome.evidenceId}`],
  ])}<p class="basis-note">${outcome.outcome === "defer" ? "Deferral preserves the prior basis; this interim statement is not a new approval basis." : "This outcome belongs to this decision and its frozen review target."}</p></li>`).join("")}</ol>`}</details>`;
}

function replacementHistory(snapshot: BasisSnapshot, prefix: BasisColumn): string {
  return `<details class="basis-block" id="${prefix}-replacements" data-testid="${prefix}-replacements"><summary>Explicit review replacements · ${snapshot.replacements.length}</summary>${snapshot.replacements.length === 0 ? "<p>No replacement recorded.</p>" : `<ol class="basis-records">${snapshot.replacements.map((replacement): string => `<li data-replacement-id="${escapeHtml(replacement.id)}"><strong>Old question preserved · new review opened</strong>${facts(`${prefix}-replacement-${replacement.id}`, [
    ["id", "Replacement UUID", replacement.id], ["actor", "Responsible fictional code", replacement.actor],
    ["recorded-at", "Recorded · UTC", replacement.recordedAt], ["rationale", "Recorded rationale", replacement.rationale],
    ["old-review", "Old review", replacement.oldReviewId], ["new-review", "New review", replacement.newReviewId],
    ["deferral", "Preserved deferral", replacement.deferredOutcomeId],
    ["old-target", "Old source event / evidence", `${replacement.oldSourceEventId} / ${replacement.oldEvidenceId}`],
    ["new-target", "New source event / evidence", `${replacement.newSourceEventId} / ${replacement.newEvidenceId}`],
  ])}<p class="basis-note">Replacement and the new review were recorded together. The decision basis stays unchanged until a separate terminal outcome.</p></li>`).join("")}</ol>`}</details>`;
}

/** Render only preserved facts and exact references; never re-evaluate past rules. */
export function basisSnapshotMarkup(state: ClarificationState, snapshot: BasisSnapshot, prefix: BasisColumn, heading: string): string {
  return `<h3>${escapeHtml(heading)}</h3><p class="basis-decision-title">${escapeHtml(snapshot.record.decision.title)}</p>${activeBasis(snapshot, prefix)}${original(snapshot, prefix)}${supportingEvidence(snapshot, prefix)}<section class="basis-block" id="${prefix}-known-source" data-testid="${prefix}-known-source"><h4>Latest capture known in this recorded state</h4>${captureFacts(`${prefix}-known-source`, snapshot.knownSource)}<p class="basis-note">Requested access and declared grants are separate. Deployment is declared; runtime is Not observed.</p></section>${pendingReview(state, snapshot, prefix)}${reviewHistory(snapshot, prefix)}${outcomeHistory(snapshot, prefix)}${replacementHistory(snapshot, prefix)}`;
}

/** Compare stored facts, without turning either snapshot into an impact verdict. */
export function basisDifferencesMarkup(inspection: BasisInspection): string {
  const historical = inspection.historical, latest = inspection.latest;
  const entries: readonly (readonly [string, string, string])[] = [
    ["Active revision", historical.basis?.revision ?? "Withdrawn", latest.basis?.revision ?? "Withdrawn"],
    ["Decision scope", historical.basis?.statement ?? "No active basis", latest.basis?.statement ?? "No active basis"],
    ["Responsible fictional code", historical.basis?.actor ?? "No active basis", latest.basis?.actor ?? "No active basis"],
    ["Recorded rationale", historical.basis?.rationale ?? "No active basis", latest.basis?.rationale ?? "No active basis"],
    ["Accepted boundary", historical.basis?.acceptedPermissions.join(", ") ?? "No active basis", latest.basis?.acceptedPermissions.join(", ") ?? "No active basis"],
    ["Supporting evidence", historical.support?.evidence.id ?? "No active basis", latest.support?.evidence.id ?? "No active basis"],
    ["Latest known evidence", historical.knownSource.evidence.id, latest.knownSource.evidence.id],
    ["Known requested access", historical.knownSource.evidence.requestedPermissions.join(", "), latest.knownSource.evidence.requestedPermissions.join(", ")],
    ["Known declared grants", historical.knownSource.evidence.grantedPermissions.join(", "), latest.knownSource.evidence.grantedPermissions.join(", ")],
    ["Known deployment declaration", historical.knownSource.evidence.environment, latest.knownSource.evidence.environment],
    ["Known capture time · UTC", historical.knownSource.evidence.capturedAt, latest.knownSource.evidence.capturedAt],
    ["Known source record time · UTC", historical.knownSource.recordedAt, latest.knownSource.recordedAt],
    ["Pending review", historical.pendingReview?.id ?? "None", latest.pendingReview?.id ?? "None"],
    ["Pending frozen target evidence", historical.pendingReview?.evidenceId ?? "None", latest.pendingReview?.evidenceId ?? "None"],
    ["Recorded outcomes", String(historical.outcomes.length), String(latest.outcomes.length)],
    ["Review replacements", String(historical.replacements.length), String(latest.replacements.length)],
  ];
  const changed = entries.filter(([, before, after]): boolean => before !== after);
  return `<h3>What differs from the latest recorded state?</h3>${changed.length === 0 ? "<p>The displayed basis, evidence, pending review and record counts match the latest recorded state.</p>" : `<dl class="basis-differences-list">${changed.map(([label, before, after]): string => `<div><dt>${escapeHtml(label)}</dt><dd><span><small>Selected state</small>${escapeHtml(before)}</span><span><small>Latest recorded state</small>${escapeHtml(after)}</span></dd></div>`).join("")}</dl>`}<details class="basis-cut-details"><summary>Exact event cut · ${inspection.includedEventIds.length} included / ${inspection.excludedEventIds.length} excluded</summary>${facts("basis-cut", [["included", "Included event UUIDs", inspection.includedEventIds.join(", ")], ["excluded", "Excluded event UUIDs", inspection.excludedEventIds.length === 0 ? "None" : inspection.excludedEventIds.join(", ")]])}</details><p class="basis-note">These are recorded facts. Historical rule evaluation is unavailable because rule versions were not recorded. No approval, safety or runtime conclusion is inferred.</p>`;
}
