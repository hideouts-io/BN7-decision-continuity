import { escapeHtml, getElement } from "./render.ts";
import { sharedBasis, sharedDecision, sharedEvidence, sharedImpact, sharedPendingReview } from "./shared-model.ts";
import type { SharedHistory, SharedEvidence, SharedDecision } from "./shared-model.ts";
import { outcomeLabel } from "./journey.ts";

export type TrailKind = "source" | "evidence" | "assumption" | "decision" | "review" | "outcome";
export type TrailSelection = Readonly<{ kind: TrailKind; id: string }>;
function facts(entries: readonly (readonly [string, string])[]): string {
  return `<dl class="shared-facts">${entries.map(([label, value]): string => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`;
}
function version(state: SharedHistory, evidenceId: string): string {
  const index: number = state.sources.findIndex((event): boolean => event.evidence.id === evidenceId);
  if (index < 0) throw new ReferenceError(`Evidence ${evidenceId} has no shared source version.`);
  return `Version ${index + 1}`;
}
function evidenceDetails(state: SharedHistory, evidence: SharedEvidence): string {
  return facts([["Version", version(state, evidence.id)], ["Evidence UUID", evidence.id], ["Canonical source", evidence.sourceId], ["Captured · UTC", evidence.capturedAt], ["Requested", evidence.requestedPermissions.join(", ")], ["Declared granted", evidence.grantedPermissions.join(", ")], ["Deployment declaration", evidence.environment], ["Runtime", evidence.observedActivity], ["Provenance", evidence.provenance], ["Source note", evidence.sourceNote]]);
}
function node(kind: TrailKind, id: string, label: string, detail: string, testId: string): string {
  return `<button type="button" class="trail-node" data-testid="${testId}" data-trail-kind="${kind}" data-trail-id="${escapeHtml(id)}" aria-controls="shared-inspector"><span>${escapeHtml(label)}</span><strong>${escapeHtml(detail)}</strong><span class="trail-inspect">Inspect ↗</span></button>`;
}
function decisionPath(state: SharedHistory, record: SharedDecision, index: number, latest: SharedEvidence): string {
  const basis = sharedBasis(state, record.decision.id), impact = sharedImpact(state, record, basis, latest);
  const review = state.reviews.filter((item): boolean => item.decisionId === record.decision.id).at(-1);
  const pending = sharedPendingReview(state, record.decision.id);
  const outcome = state.outcomes.filter((item): boolean => item.reviewId === review?.id).at(-1);
  const labels = { affected: "Affected · review needed", unchanged: "No relevant change", unresolved: "Unresolved applicability", inactive: "Withdrawn" } as const;
  return `<article class="shared-path shared-${impact.status}" data-testid="shared-decision-${index}" aria-labelledby="shared-title-${index}"><div class="shared-path-heading"><div><p class="eyebrow">Decision ${index + 1} / ${record.assumption.scope === "Any" ? "Any declared context" : "Production only"}</p><h3 id="shared-title-${index}">${escapeHtml(record.decision.title)}</h3></div><span class="shared-status" data-testid="shared-status-${index}" data-status="${impact.status}">${labels[impact.status]}</span></div><p class="shared-explanation" data-testid="shared-explanation-${index}">${escapeHtml(impact.explanation)}</p><div class="shared-path-nodes">
    ${node("assumption", record.assumption.id, "Assumption", record.assumption.field === "requestedPermissions" ? "Request boundary" : "Grant boundary", `trail-assumption-${index}`)}
    ${node("decision", record.decision.id, "Applicable decision", basis === null ? "Withdrawn" : `Revision ${basis.revision.split(".").at(-1)}`, `trail-decision-${index}`)}
    ${review === undefined ? `<div class="trail-placeholder"><span>Assigned review</span><strong>Not opened</strong></div>` : node("review", review.id, "Assigned review", `${pending === null ? "Resolved" : "Pending"} · ${version(state, review.evidenceId)}`, `trail-review-${index}`)}
    ${outcome === undefined ? `<div class="trail-placeholder"><span>Recorded outcome</span><strong>None</strong></div>` : node("outcome", outcome.id, "Human-entered outcome", outcomeLabel(outcome.outcome), `trail-outcome-${index}`)}
    </div><p class="history-meta">${escapeHtml(record.decision.actor)} · ${pending === null ? "No pending review" : `Review stays tied to ${version(state, pending.evidenceId)}, independently of the latest capture`}. Runtime Not observed.</p></article>`;
}
function comparison(state: SharedHistory, record: SharedDecision): string {
  const basis = sharedBasis(state, record.decision.id), latest = state.sources.at(-1);
  if (latest === undefined) throw new ReferenceError("A decision comparison requires shared evidence.");
  if (basis === null) return "<p>This decision was withdrawn. Its original basis and earlier outcomes remain below.</p>";
  const previous = sharedEvidence(state, basis.evidenceId), field = record.assumption.field;
  const added = latest.evidence[field].filter((permission): boolean => !previous[field].includes(permission));
  const removed = previous[field].filter((permission): boolean => !latest.evidence[field].includes(permission));
  return facts([["Applicable revision", basis.revision], ["Decision scope", basis.statement], ["Accountable rationale", basis.rationale], ["Basis evidence", `${version(state, basis.evidenceId)} · ${basis.evidenceId}`], ["Basis source event", basis.sourceEventId], ["Compared evidence", `${version(state, latest.evidence.id)} · ${latest.evidence.id}`], ["Compared source event", latest.id], ["Monitored field", field === "requestedPermissions" ? "Requested permissions" : "Declared granted permissions"], ["Field change", [...added.map((permission): string => `+ ${permission}`), ...removed.map((permission): string => `− ${permission}`)].join("; ") || "No permission change"], ["Deployment change", `${previous.environment} → ${latest.evidence.environment}`], ["Accepted boundary", basis.acceptedPermissions.join(", ")], ["Rule scope", record.assumption.scope], ["Responsible code", basis.actor], ["Rule result", sharedImpact(state, record, basis, latest.evidence).explanation], ["Still unknown", "Runtime activity and real permissions are unobserved. Reviewer codes are unauthenticated. Applicability uses declared context only."]]);
}
export function inspectSharedNode(state: SharedHistory, selection: TrailSelection): void {
  let title: string, content: string;
  if (selection.kind === "source") {
    if (selection.id !== state.source.id) throw new ReferenceError("Selected source is not the canonical shared source.");
    title = state.source.name;
    content = facts([["Source UUID", state.source.id], ["Storage", "One canonical source; every decision references its versions. No external connector or monitor."], ["Versions", String(state.sources.length)]]) + state.sources.map((event, index: number): string => `<details><summary>Version ${index + 1} · ${escapeHtml(event.evidence.capturedAt)} UTC</summary>${facts([["Source event", event.id], ["Recorded · UTC", event.recordedAt]])}${evidenceDetails(state, event.evidence)}</details>`).join("");
  } else if (selection.kind === "evidence") {
    const evidence = sharedEvidence(state, selection.id);
    title = `${version(state, selection.id)} · immutable evidence`;
    content = evidenceDetails(state, evidence);
  } else if (selection.kind === "assumption") {
    const record = state.originalDecisions.find((item): boolean => item.assumption.id === selection.id);
    if (record === undefined) throw new ReferenceError("Selected assumption has no recorded decision.");
    title = `${record.decision.title} · explicit assumption`;
    content = facts([["Assumption UUID", record.assumption.id], ["Decision UUID", record.decision.id], ["Source UUID", record.assumption.sourceId], ["Original evidence", record.assumption.baselineId], ["Rule", record.assumption.description], ["Scope", record.assumption.scope]]) + comparison(state, record);
  } else if (selection.kind === "decision") {
    const record = sharedDecision(state, selection.id);
    title = record.decision.title;
    content = comparison(state, record) + `<details><summary>Immutable original decision and basis</summary>${facts([["Original revision", record.decision.revision], ["Original scope", record.decision.statement], ["Original rationale", record.decision.rationale], ["Assumption UUID", record.assumption.id], ["Baseline UUID", record.decision.evidenceId], ["Simulated responsible code", record.decision.actor], ["Recorded · UTC", record.decision.decidedAt]])}</details>`;
  } else if (selection.kind === "review") {
    const review = state.reviews.find((item): boolean => item.id === selection.id);
    if (review === undefined) throw new ReferenceError("Selected review is absent from recorded history.");
    title = "Assigned review · frozen basis";
    content = `<div data-testid="frozen-review-snapshot" data-review-id="${review.id}" data-evidence-id="${review.evidenceId}" data-environment="${sharedEvidence(state, review.evidenceId).environment}">` + facts([["Review UUID", review.id], ["Decision UUID", review.decisionId], ["Assumption UUID", review.assumptionId], ["Assigned code", review.actor], ["Opened · UTC", review.openedAt], ["Trigger", review.trigger], ["Viewed perspective", "This review at opening; later evidence does not replace its target"], ["Target deployment declaration", sharedEvidence(state, review.evidenceId).environment], ["Explanation from frozen references", sharedImpact(state, sharedDecision(state, review.decisionId), review.basis, sharedEvidence(state, review.evidenceId)).explanation], ["Frozen decision revision", review.basis.revision], ["Frozen decision scope", review.basis.statement], ["Frozen decision rationale", review.basis.rationale], ["Basis evidence", review.basis.evidenceId], ["Basis source event", review.basis.sourceEventId], ["Target evidence", review.evidenceId], ["Target source event", review.sourceEventId], ["Accepted boundary at opening", review.basis.acceptedPermissions.join(", ")]]) + `<details><summary>Inspect exact reviewed evidence</summary>${evidenceDetails(state, sharedEvidence(state, review.evidenceId))}</details></div>`;
  } else {
    const outcome = state.outcomes.find((item): boolean => item.id === selection.id);
    if (outcome === undefined) throw new ReferenceError("Selected outcome is absent from recorded history.");
    title = `${outcomeLabel(outcome.outcome)} · preserved human entry`;
    content = facts([["Outcome UUID", outcome.id], ["Decision revision", outcome.revision], ["Review UUID", outcome.reviewId], ["Exact source event", outcome.sourceEventId], ["Exact evidence", outcome.evidenceId], ["Responsible code", outcome.actor], ["Recorded · UTC", outcome.recordedAt], ["Rationale", outcome.rationale], ["Resulting scope or interim action", outcome.statement], ["New accepted boundary", outcome.acceptedPermissions?.join(", ") ?? (outcome.outcome === "withdraw" ? "No active decision" : outcome.outcome === "defer" ? "No new basis; review remains open" : "Prior boundary retained")], ["Validation limit", "This is an unauthenticated human-entered rehearsal outcome, not verified practitioner participation."]]);
  }
  getElement("inspector-title").textContent = title;
  getElement("shared-inspection").innerHTML = content;
}
export function renderSharedState(state: SharedHistory): void {
  const latest = state.sources.at(-1), baseline = state.sources[0];
  if (latest === undefined || baseline === undefined) throw new ReferenceError("Shared-source rendering requires a baseline.");
  getElement("shared-creation").hidden = true;
  getElement("shared-workspace").hidden = false;
  getElement("shared-trail").innerHTML = `<div class="shared-source-nodes">${node("source", state.source.id, "Canonical source", state.source.name, "trail-source")}<svg class="shared-source-arrow" viewBox="0 0 50 24" aria-hidden="true"><path d="M0 12 H44 M36 4 L44 12 L36 20" /></svg>${node("evidence", latest.evidence.id, "Latest evidence", `${version(state, latest.evidence.id)} · ${latest.evidence.environment}`, "trail-evidence")}</div><div class="shared-paths">${state.originalDecisions.map((record, index: number): string => decisionPath(state, record, index, latest.evidence)).join("")}</div>`;
  const original: string = `<li class="history-entry"><h3>Shared baseline and three simulated starting decisions</h3>${evidenceDetails(state, baseline.evidence)}${state.originalDecisions.map((record): string => `<details><summary>${escapeHtml(record.decision.title)} · original revision 1</summary>${facts([["Revision", record.decision.revision], ["Scope", record.decision.statement], ["Rationale", record.decision.rationale], ["Assumption", record.assumption.id], ["Rule", record.assumption.description], ["Responsible code", record.decision.actor]])}</details>`).join("")}</li>`;
  const entries: Readonly<{ time: string; markup: string }>[] = [
    ...state.sources.slice(1).map((event): Readonly<{ time: string; markup: string }> => ({ time: event.recordedAt, markup: `<li class="history-entry"><h3>${escapeHtml(version(state, event.evidence.id))} · canonical capture</h3>${facts([["Source event", event.id], ["Recorded · UTC", event.recordedAt]])}<details><summary>Inspect immutable evidence</summary>${evidenceDetails(state, event.evidence)}</details></li>` })),
    ...state.reviews.map((review): Readonly<{ time: string; markup: string }> => ({ time: review.openedAt, markup: `<li class="history-entry"><h3>${escapeHtml(sharedDecision(state, review.decisionId).decision.title)} · review opened</h3>${facts([["Review", review.id], ["Assumption", review.assumptionId], ["Assigned", review.actor], ["Opened · UTC", review.openedAt], ["Frozen basis", review.basis.revision], ["Basis evidence", review.basis.evidenceId], ["Target evidence", review.evidenceId], ["Source event", review.sourceEventId], ["Trigger", review.trigger]])}</li>` })),
    ...state.outcomes.map((outcome): Readonly<{ time: string; markup: string }> => ({ time: outcome.recordedAt, markup: `<li class="history-entry"><h3>${escapeHtml(sharedDecision(state, outcome.decisionId).decision.title)} · ${outcomeLabel(outcome.outcome)}</h3>${facts([["Revision", outcome.revision], ["Review", outcome.reviewId], ["Source event", outcome.sourceEventId], ["Target evidence", outcome.evidenceId], ["Responsible code", outcome.actor], ["Recorded · UTC", outcome.recordedAt], ["Rationale", outcome.rationale], ["Scope or interim action", outcome.statement], ["Explicit new boundary", outcome.acceptedPermissions?.join(", ") ?? "No boundary change"]])}</li>` })),
  ];
  getElement("shared-history").innerHTML = original + entries.toSorted((left, right): number => Date.parse(left.time) - Date.parse(right.time)).map((entry): string => entry.markup).join("");
}
