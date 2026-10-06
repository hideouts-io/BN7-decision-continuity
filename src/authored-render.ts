import type { AuthoredEvidence, AuthoredState } from "./authored-model.ts";
import { escapeHtml, getElement } from "./render.ts";
import { outcomeLabel } from "./journey.ts";
import type { ContinuityEvidence } from "./continuity-model.ts";

export function evidenceMarkup(evidence: AuthoredEvidence | ContinuityEvidence): string {
  return `<dl class="authored-facts"><dt>Requested</dt><dd>${escapeHtml(evidence.requestedPermissions.join(", "))}</dd><dt>Declared grants</dt><dd>${escapeHtml(evidence.grantedPermissions.join(", "))}</dd><dt>Runtime</dt><dd>Not observed</dd><dt>Captured · UTC</dt><dd>${escapeHtml(evidence.capturedAt)}</dd></dl><p>${escapeHtml(evidence.sourceNote)}</p><p class="history-meta">Evidence ${evidence.id} · source ${evidence.sourceId}</p>`;
}

export function renderAuthoredState(state: AuthoredState): void {
  getElement("creation").hidden = true;
  getElement("authored-workspace").hidden = false;
  const baseline = state.sources[0];
  if (baseline === undefined) throw new ReferenceError("The decision has no baseline evidence.");
  const changed = state.sources[1];
  const latest = state.outcomes.at(-1);
  const affected: boolean = changed?.evidence.requestedPermissions.includes("documents:write") === true;
  const terminal: boolean = latest !== undefined && latest.outcome !== "defer";
  getElement("authored-title").textContent = state.originalDecision.title;
  getElement("authored-status").textContent = latest === undefined ? "Original approval" : outcomeLabel(latest.outcome);
  getElement("authored-current").textContent = latest?.statement ?? state.originalDecision.statement;
  getElement("authored-original").innerHTML = `<p>${escapeHtml(state.originalDecision.statement)}</p><p>${escapeHtml(state.originalDecision.rationale)}</p><p class="history-meta">${state.originalDecision.revision} · ${state.originalDecision.actor} · ${state.originalDecision.decidedAt}</p>`;
  getElement("authored-assumption").textContent = state.assumption.description;
  getElement("authored-source-name").textContent = state.source.name;
  getElement("authored-baseline").innerHTML = evidenceMarkup(baseline.evidence);
  getElement("authored-changed").innerHTML = changed === undefined ? "<p>No later capture yet. Record one version below; inspecting this page writes nothing.</p>" : evidenceMarkup(changed.evidence);
  getElement("capture-panel").hidden = changed !== undefined;
  getElement("authored-impact").textContent = changed === undefined
    ? "No later evidence: the original approval remains the comparison basis."
    : affected ? "Added request: + documents:write. The structured read-only request rule is contradicted; review is suggested, not opened automatically. Declared grants and unobserved runtime do not establish execution."
      : "No relevant change to the read-only request rule. A grant-only change does not contradict this particular rule; a separate grant assumption would require its own assessment.";
  getElement("authored-path").textContent = `Source ${state.source.id} → evidence ${changed?.evidence.id ?? baseline.evidence.id} → assumption ${state.assumption.id} → original decision ${state.originalDecision.revision}${state.review === null ? "" : ` → review ${state.review.id}`}`;
  getElement("authored-next").textContent = changed === undefined ? "Next: capture a later synthetic source version."
    : terminal ? "Complete: inspect and export the preserved decision history."
      : state.review !== null ? "Next: record an accountable outcome. Deferral keeps the review open." : affected ? "Next: trace the link, then explicitly open the assigned review." : "Comparison complete: no review suggested by this rule. Export this control or create another decision.";
  const open: HTMLElement = getElement("authored-open-review");
  if (!(open instanceof HTMLButtonElement)) throw new TypeError("The review control must be a button.");
  open.hidden = state.review !== null;
  open.disabled = !affected;
  getElement("authored-review-form").hidden = state.review === null || terminal;
  getElement("authored-review-context").textContent = state.review === null ? `Assigned fictional reviewer: ${state.originalDecision.actor}. Opening a review records responsibility and evidence, but no decision outcome.` : `Review ${state.review.id} · ${state.review.actor} · opened ${state.review.openedAt}. ${terminal ? "Final outcome preserved; further outcomes are blocked." : "Only this assigned code may record the synthetic outcome; it is not authentication."}`;
  getElement("authored-history").innerHTML = [
    `<li class="history-entry"><h3>Original approval · revision 1</h3><p>${escapeHtml(state.originalDecision.statement)}</p><p>Rationale: ${escapeHtml(state.originalDecision.rationale)}</p><p class="history-meta">${state.originalDecision.revision} · ${state.originalDecision.actor} · ${state.originalDecision.decidedAt}</p></li>`,
    ...state.sources.map((event, index: number): string => `<li class="history-entry" data-testid="authored-capture-entry"><h3>${index === 0 ? "Baseline retained" : "Later capture retained"}</h3><p class="history-meta">Event ${event.id} · recorded ${event.recordedAt}</p><details><summary>Inspect exact source snapshot</summary>${evidenceMarkup(event.evidence)}</details></li>`),
    ...(state.review === null ? [] : [`<li class="history-entry"><h3>Review explicitly opened</h3><p class="history-meta">${state.review.id} · ${state.review.actor} · event ${state.review.sourceEventId}</p></li>`]),
    ...state.outcomes.map((outcome): string => `<li class="history-entry" data-testid="authored-outcome-entry"><h3>${outcomeLabel(outcome.outcome)}</h3><p>${escapeHtml(outcome.statement)}</p><p>Rationale: ${escapeHtml(outcome.rationale)}</p><p class="history-meta">${outcome.revision} · outcome ${outcome.id} · ${outcome.actor} · ${outcome.recordedAt}<br>Review ${outcome.reviewId} · source event ${outcome.sourceEventId}<br>Evidence ${outcome.baseline.id} → ${outcome.changed.id}</p></li>`),
  ].join("");
}
