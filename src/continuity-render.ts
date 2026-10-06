import { applicableBasis, pendingReview, reviewNeeded, samePermissions } from "./continuity-model.ts";
import type { ContinuityState, ContinuityPermission, ContinuityEvidence, ContinuityOutcome } from "./continuity-model.ts";
import { evidenceMarkup } from "./authored-render.ts";
import { escapeHtml, getElement } from "./render.ts";
import { outcomeLabel } from "./journey.ts";

function difference(label: string, previous: readonly ContinuityPermission[], current: readonly ContinuityPermission[]): string {
  const added = current.filter((permission): boolean => !previous.includes(permission));
  const removed = previous.filter((permission): boolean => !current.includes(permission));
  return added.length === 0 && removed.length === 0 ? `${label} unchanged.` : `${label}: ${[...added.map((permission): string => `+ ${permission}`), ...removed.map((permission): string => `− ${permission}`)].join("; ")}.`;
}
function versionNumber(state: ContinuityState, evidenceId: string): number {
  const index: number = state.sources.findIndex((event): boolean => event.evidence.id === evidenceId);
  if (index < 0) throw new ReferenceError(`Evidence ${evidenceId} has no captured version in this decision.`);
  return index + 1;
}
function comparisonMarkup(evidence: ContinuityEvidence): string {
  return `<dl class="authored-facts"><dt>Requested</dt><dd>${escapeHtml(evidence.requestedPermissions.join(", "))}</dd><dt>Declared grants</dt><dd>${escapeHtml(evidence.grantedPermissions.join(", "))}</dd><dt>Runtime</dt><dd>Not observed</dd></dl><details><summary>Inspect captured note, time and identifiers</summary>${evidenceMarkup(evidence)}</details>`;
}
function revisionNumber(revision: string): string {
  const number: string = revision.slice(revision.lastIndexOf(".") + 1);
  if (!/^[1-9]\d*$/.test(number)) throw new RangeError(`Decision revision ${revision} has no valid sequence number.`);
  return number;
}
function boundaryDescription(outcome: ContinuityOutcome): string {
  if (outcome.outcome === "defer") return "No new basis; review stays open";
  if (outcome.outcome === "withdraw") return "No active approval";
  if (outcome.outcome === "reaffirm") return `Prior boundary retained: ${outcome.basis.approvedRequestedPermissions.join(", ")}`;
  if (outcome.approvedRequestedPermissions === null) throw new ReferenceError("A revised outcome has no recorded request boundary.");
  return outcome.approvedRequestedPermissions.join(", ");
}
export function renderContinuityMode(): void {
  getElement("page-title").innerHTML = "Does the earlier decision<br /><span>still hold?</span>";
  getElement("workspace-scope-title").textContent = "One decision. Repeated reassessment.";
  getElement("workspace-scope-description").textContent = "Compare each new capture against the evidence and request boundary behind the applicable human decision. Later knowledge never replaces earlier reasoning. All permissions, including documents:delete, are synthetic.";
  getElement("creation-description").textContent = "Create a synthetic read-only approval and its original basis. After each resolved review, capture another version. A revision must explicitly state the next accepted request boundary; prose alone does not change the rule.";
  getElement("assumption-rule-hint").textContent = "Structured rule: requested-permissions-within-boundary. The initial request boundary is documents:read; a human revision explicitly records the next boundary. Grants remain separate.";
  getElement("authored-new").setAttribute("href", "/decisions.html?format=4");
  getElement("continuity-summary").hidden = false;
  getElement("continuity-request-delete-label").hidden = false;
  getElement("continuity-grant-delete-label").hidden = false;
  getElement("capture-title").textContent = "Capture the next source version.";
  getElement("capture-description").textContent = "Every capture is retained. Resolve any open review first; deferral keeps it open. Capturing evidence never records a human outcome or opens a review automatically.";
}

export function renderContinuityState(state: ContinuityState): void {
  renderContinuityMode();
  getElement("creation").hidden = true;
  getElement("authored-workspace").hidden = false;
  const latest = state.sources.at(-1);
  if (latest === undefined) throw new ReferenceError("Continuity requires captured evidence.");
  const basis = applicableBasis(state);
  const pending = pendingReview(state);
  const outcome = state.outcomes.at(-1);
  const needsReview: boolean = basis !== null && reviewNeeded(basis, latest.evidence);
  const requestsUnchanged: boolean = basis !== null && samePermissions(basis.evidence.requestedPermissions, latest.evidence.requestedPermissions);
  const outside = basis === null ? [] : latest.evidence.requestedPermissions.filter((permission): boolean => !basis.approvedRequestedPermissions.includes(permission));
  getElement("authored-title").textContent = state.originalDecision.title;
  getElement("authored-status").textContent = basis === null ? "Withdrawn" : pending !== null ? "Review open" : needsReview ? "Review suggested" : "Comparison recorded";
  if (basis === null) {
    if (outcome === undefined || outcome.outcome !== "withdraw") throw new ReferenceError("A missing active approval requires its recorded withdrawal outcome.");
    getElement("authored-current").textContent = outcome.statement;
  } else getElement("authored-current").textContent = basis.statement;
  getElement("authored-original").innerHTML = `<p>${escapeHtml(state.originalDecision.statement)}</p><p>${escapeHtml(state.originalDecision.rationale)}</p><p class="history-meta">${state.originalDecision.revision} · ${state.originalDecision.actor} · ${state.originalDecision.decidedAt}</p>`;
  getElement("authored-assumption").textContent = `Original dependency explanation: ${state.assumption.description}`;
  getElement("authored-source-name").textContent = state.source.name;
  getElement("comparison-basis-title").textContent = "Evidence behind the applicable decision";
  getElement("authored-baseline").innerHTML = basis === null ? "<p>No active approval after withdrawal. Prior bases remain in history.</p>" : `<p class="field-label">Version ${versionNumber(state, basis.evidence.id)} · decision revision ${escapeHtml(revisionNumber(basis.revision))}</p>${comparisonMarkup(basis.evidence)}`;
  getElement("authored-changed").innerHTML = `<p class="field-label">Latest capture · version ${state.sources.length}</p>${comparisonMarkup(latest.evidence)}`;
  getElement("continuity-answer").textContent = basis === null ? "The recorded approval was withdrawn."
    : pending !== null ? "An accountable reassessment is open."
      : needsReview ? "Reassessment is suggested under the recorded rule."
        : "No new request-based reassessment is suggested.";
  getElement("continuity-change").textContent = basis === null ? "The last outcome ended the active approval."
    : `${difference("Requests", basis.evidence.requestedPermissions, latest.evidence.requestedPermissions)} ${difference("Declared grants", basis.evidence.grantedPermissions, latest.evidence.grantedPermissions)}`;
  getElement("continuity-why").textContent = basis === null ? "A new approval requires another synthetic decision in this increment."
    : `Applicable decision revision ${revisionNumber(basis.revision)} accepts requests within ${basis.approvedRequestedPermissions.join(", ")}. ${needsReview ? `Changed requests include permissions outside that boundary: ${outside.join(", ")}.` : requestsUnchanged && outside.length > 0 ? `These unchanged requests were already reviewed; ${outside.join(", ")} still exceeds the recorded boundary. No new change is claimed.` : "The capture introduces no changed request outside that boundary. Grant-only changes require a separately recorded grant rule."}`;
  getElement("continuity-owner").textContent = `${state.originalDecision.actor} · fictional code, not an authenticated person`;
  getElement("continuity-unknown").textContent = "These are synthetic declarations. Actual granted access, runtime activity and operational safety are unestablished. This rule does not evaluate grants or arbitrary assumption prose.";
  getElement("continuity-outcome-summary").textContent = outcome === undefined ? "No human review outcome recorded."
    : `${outcomeLabel(outcome.outcome)} for version ${versionNumber(state, outcome.changed.id)}. ${pending !== null ? "The current review remains open." : needsReview ? "That earlier outcome does not resolve this later capture." : "Its rationale and scope remain in history."}`;
  getElement("authored-impact").textContent = basis === null ? "No active basis to compare."
    : `The deterministic rule checks whether requested permissions changed and exceed the accepted boundary of decision revision ${revisionNumber(basis.revision)}. A new timestamp, changed grants or changed prose alone does not satisfy that rule. This is a scoped suggestion, not an assurance verdict.`;
  getElement("authored-path").textContent = "Recorded source → explicit request-boundary dependency → applicable decision → exact review target";
  getElement("continuity-references").hidden = false;
  getElement("continuity-reference-content").textContent = `Source ${state.source.id} → assumption ${state.assumption.id} → basis ${basis?.revision ?? "withdrawn"} (${basis?.evidence.id ?? "none"}) → target ${latest.id} / ${latest.evidence.id}${pending === null ? "" : ` → review ${pending.id}`}`;
  getElement("capture-panel").hidden = pending !== null || basis === null;
  getElement("authored-next").textContent = pending !== null ? "Next: record a human outcome. Deferral keeps this review open."
    : basis === null ? "The approval has ended; export its preserved history or create another decision."
      : needsReview ? "Next: inspect the change and explicitly open the assigned review."
        : "Next: capture another version when conditions change, or export this history.";
  const open = getElement("authored-open-review");
  if (!(open instanceof HTMLButtonElement)) throw new TypeError("The review action must be a button.");
  open.hidden = pending !== null;
  open.disabled = !needsReview || basis === null;
  getElement("authored-review-form").hidden = pending === null;
  getElement("authored-review-context").textContent = pending === null ? `Assigned: ${state.originalDecision.actor}. Opening a review creates no outcome. Earlier resolved reviews remain preserved.`
    : `Review ${state.reviews.length} assesses version ${versionNumber(state, pending.changed.id)} against decision revision ${revisionNumber(pending.basis.revision)} and version ${versionNumber(state, pending.basis.evidence.id)}. ${pending.actor} records the outcome; this code is not authentication.`;
  for (const [id, permission] of [["boundary-read", "documents:read"], ["boundary-write", "documents:write"], ["boundary-delete", "documents:delete"]] as const) {
    const element = getElement(id);
    if (!(element instanceof HTMLInputElement)) throw new TypeError("Request-boundary controls must be checkboxes.");
    element.checked = basis?.approvedRequestedPermissions.includes(permission) === true;
  }
  const entries: string[] = [`<li class="history-entry"><h3>Original approval · revision 1</h3><p>${escapeHtml(state.originalDecision.statement)}</p><p>Rationale: ${escapeHtml(state.originalDecision.rationale)}</p><details><summary>Inspect original responsibility and basis</summary><p class="history-meta">${state.originalDecision.revision} · ${state.originalDecision.actor} · ${state.originalDecision.decidedAt}<br>Assumption ${state.assumption.id} · evidence ${state.originalDecision.evidenceId}</p></details></li>`];
  state.sources.forEach((event, index: number): void => {
    entries.push(`<li class="history-entry" data-testid="continuity-capture-entry"><h3>Version ${index + 1} · ${index === 0 ? "baseline retained" : "capture retained"}</h3><p>${escapeHtml(event.evidence.sourceNote)}</p><details><summary>Inspect exact capture</summary><p class="history-meta">Event ${event.id} · recorded ${event.recordedAt}</p>${evidenceMarkup(event.evidence)}</details></li>`);
    const review = state.reviews.find((candidate): boolean => candidate.sourceEventId === event.id);
    if (review === undefined) return;
    entries.push(`<li class="history-entry" data-testid="continuity-review-entry"><h3>Review ${state.reviews.indexOf(review) + 1} · explicitly opened</h3><p>Version ${index + 1} against decision revision ${escapeHtml(revisionNumber(review.basis.revision))} · ${escapeHtml(review.actor)}</p><details><summary>Inspect the frozen review basis and target</summary><div data-testid="continuity-review-basis"><p class="history-meta">${review.id} · basis ${review.basis.revision} · source event ${review.basis.sourceEventId} → ${review.sourceEventId}</p><p>${escapeHtml(review.basis.statement)}</p><p>Accepted request boundary: ${escapeHtml(review.basis.approvedRequestedPermissions.join(", "))}</p>${evidenceMarkup(review.basis.evidence)}${evidenceMarkup(review.changed)}</div></details></li>`);
    for (const record of state.outcomes.filter((candidate): boolean => candidate.reviewId === review.id)) entries.push(`<li class="history-entry" data-testid="continuity-outcome-entry"><h3>${outcomeLabel(record.outcome)} · revision ${escapeHtml(revisionNumber(record.revision))}</h3><p>${escapeHtml(record.statement)}</p><p>Rationale: ${escapeHtml(record.rationale)}</p><p>Next request boundary: ${escapeHtml(boundaryDescription(record))}</p><details><summary>Inspect responsibility and references</summary><p class="history-meta">${record.actor} · ${record.recordedAt}<br>Outcome ${record.id} · ${record.revision}<br>Review ${record.reviewId} · event ${record.sourceEventId}<br>Applicable basis ${record.basis.revision} · ${record.basis.evidence.id} → ${record.changed.id}</p></details></li>`);
  });
  getElement("authored-history").innerHTML = entries.join("");
}
