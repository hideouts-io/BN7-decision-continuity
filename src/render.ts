import { evidenceForState } from "./model.ts";
import type { DemoState, OutcomeRecord } from "./model.ts";
import { ORIGINAL_DECISION, getEvidence, requiresReview } from "./scenario.ts";
import type { Evidence, Outcome } from "./scenario.ts";
import { journeyForState, outcomeExplanation, outcomeLabel } from "./journey.ts";
import type { Journey, JourneyStage, NavigationAction } from "./journey.ts";

/** Escape all dynamic strings before inserting them into the small HTML templates. */
function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Format timestamps in the user's stated time zone rather than the execution host's zone. */
function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles",
  }).format(new Date(value));
}

/** Fail clearly when the static interface and controller disagree. */
export function getElement(id: string): HTMLElement {
  const element: HTMLElement | null = document.getElementById(id);
  if (element === null) throw new ReferenceError(`Required interface element #${id} is missing from index.html.`);
  return element;
}

function setMarkup(id: string, markup: string): void {
  getElement(id).innerHTML = markup;
}

function setText(id: string, value: string): void {
  getElement(id).textContent = value;
}

function renderNavigation(id: string, action: NavigationAction): void {
  const link: HTMLElement = getElement(id);
  if (!(link instanceof HTMLAnchorElement)) throw new TypeError(`#${id} must be an anchor.`);
  link.href = `#${action.target}`;
  link.textContent = action.label;
}

function renderJourney(state: DemoState): void {
  const journey: Journey = journeyForState(state);
  setText("journey-status", journey.status);
  setText("journey-title", journey.title);
  setText("journey-description", journey.description);
  renderNavigation("journey-next", journey.next);
  setText("step-evidence-status", journey.evidenceStatus);
  setText("step-impact-status", journey.impactStatus);
  setText("step-review-status", journey.reviewStatus);
  setText("step-history-status", journey.historyStatus);
  const stages: readonly JourneyStage[] = ["evidence", "impact", "review", "history"];
  for (const stage of stages) {
    const link: HTMLElement = getElement(`step-${stage}`);
    if (stage === journey.stage) link.setAttribute("aria-current", "step");
    else link.removeAttribute("aria-current");
  }
  setText("review-guidance", journey.reviewGuidance);
  renderNavigation("review-next", journey.reviewNext);
  setText("history-summary", `Original approval retained · ${state.sources.length} source ${state.sources.length === 1 ? "comparison" : "comparisons"} · ${state.review === null ? "no review opened" : "one review opened"} · ${state.outcomes.length} human ${state.outcomes.length === 1 ? "outcome" : "outcomes"}. Export keeps this session's records and evidence together.`);
}

export function renderOutcomeExplanation(outcome: Outcome | ""): void {
  setText("outcome-explanation", outcomeExplanation(outcome));
}

function evidenceMarkup(evidence: Evidence): string {
  return `<dl class="evidence-fields">
    <div class="evidence-field"><dt>Version</dt><dd><code>${evidence.id}</code> · <code>${evidence.sourceId}</code></dd></div>
    <div class="evidence-field"><dt>Requested access</dt><dd>${evidence.requestedPermissions.map((permission: string): string => `<code>${escapeHtml(permission)}</code>`).join(" ")}</dd></div>
    <div class="evidence-field"><dt>Declared granted access</dt><dd><code>${escapeHtml(evidence.grantedPermissions.join(", "))}</code></dd></div>
    <div class="evidence-field"><dt>Runtime activity</dt><dd>${escapeHtml(evidence.observedActivity)}</dd></div>
    <div class="evidence-field"><dt>Synthetic capture</dt><dd>${formatTime(evidence.capturedAt)} Pacific</dd></div>
    ${evidence.id === "EV-004" ? `<div class="evidence-field"><dt>Source note</dt><dd>${escapeHtml(evidence.sourceNote)}</dd></div><div class="evidence-field"><dt>Provenance</dt><dd>Manually entered synthetic manifest; no live source queried.</dd></div>` : ""}
  </dl>`;
}

function outcomeMarkup(outcome: OutcomeRecord): string {
  return `<li class="history-entry" data-testid="outcome-entry">
    <div class="history-entry-head"><strong>${escapeHtml(outcome.revision)} · ${outcomeLabel(outcome.outcome)}</strong><time datetime="${outcome.recordedAt}">${formatTime(outcome.recordedAt)} Pacific</time></div>
    <p>${escapeHtml(outcome.statement)}</p>
    <p><span class="field-label">Rationale</span> ${escapeHtml(outcome.rationale)}</p>
    <p class="history-meta">${escapeHtml(outcome.actor)} · ${outcome.reviewId} · ${outcome.baseline.id} → ${outcome.changed.id}</p>
    <details><summary>Inspect evidence retained with this outcome</summary><div class="history-evidence">${evidenceMarkup(outcome.baseline)}${evidenceMarkup(outcome.changed)}</div></details>
  </li>`;
}

function historyMarkup(state: DemoState): string {
  const sourceEntries: { recordedAt: string; markup: string }[] = state.sources.map((source): { recordedAt: string; markup: string } => ({ recordedAt: source.recordedAt, markup: state.schemaVersion === 2 && state.customEvidence?.id === source.id
    ? `<li class="history-entry" data-testid="capture-entry"><div class="history-entry-head"><strong>Recorded &amp; selected synthetic version EV-004</strong><time datetime="${source.recordedAt}">${formatTime(source.recordedAt)} Pacific</time></div><p>${escapeHtml(state.customEvidence.evidence.sourceNote)}</p><p class="history-meta">Manual entry · ${source.id} · ${source.evidence.sourceId}</p><details><summary>Inspect the immutable capture</summary>${evidenceMarkup(source.evidence)}</details></li>`
    : `<li class="history-entry" data-testid="source-entry">
    <div class="history-entry-head"><strong>Selected evidence ${source.evidence.id}</strong><time datetime="${source.recordedAt}">${formatTime(source.recordedAt)} Pacific</time></div>
    <p>Requested: ${escapeHtml(source.evidence.requestedPermissions.join(", "))}. Declared grant: ${escapeHtml(source.evidence.grantedPermissions.join(", "))}. Activity: not observed.</p>
  </li>` }));
  const reviewEntry: string = state.review === null ? "" : `<li class="history-entry" data-testid="review-entry">
    <div class="history-entry-head"><strong>${state.review.id} · Human review opened</strong><time datetime="${state.review.openedAt}">${formatTime(state.review.openedAt)} Pacific</time></div>
    <p>${state.review.decisionId} → ${state.review.assumptionId} → ${state.review.baseline.id} / ${state.review.changed.id}</p>
    <p class="history-meta">Assigned to ${escapeHtml(state.review.actor)}. No decision outcome was generated automatically.</p>
  </li>`;
  const entries: { recordedAt: string; markup: string }[] = [
    ...sourceEntries,
    ...(state.review === null ? [] : [{ recordedAt: state.review.openedAt, markup: reviewEntry }]),
    ...state.outcomes.map((outcome): { recordedAt: string; markup: string } => ({ recordedAt: outcome.recordedAt, markup: outcomeMarkup(outcome) })),
  ];
  const eventMarkup: string = entries.sort((left, right): number => left.recordedAt.localeCompare(right.recordedAt)).map((entry): string => entry.markup).join("");
  return `<ol class="history-list">
    <li class="history-entry" data-testid="original-entry"><div class="history-entry-head"><strong>${ORIGINAL_DECISION.revision} · Original approval</strong><time datetime="${ORIGINAL_DECISION.decidedAt}">${formatTime(ORIGINAL_DECISION.decidedAt)} Pacific</time></div><p>${escapeHtml(ORIGINAL_DECISION.statement)}</p><p class="history-meta">${escapeHtml(ORIGINAL_DECISION.actor)} · ${ORIGINAL_DECISION.assumptionId} · ${ORIGINAL_DECISION.evidenceId}</p></li>
    ${eventMarkup}
  </ol>`;
}

function renderVersionEntry(state: DemoState): void {
  getElement("version-entry").hidden = state.schemaVersion !== 2;
  getElement("evidence-form").hidden = state.schemaVersion !== 2 || state.customEvidence !== null || state.review !== null;
  if (state.schemaVersion !== 2) return;
  setText("version-status", state.customEvidence !== null ? "EV-004 preserved" : (state.review !== null ? "Capture closed" : "No version recorded"));
  setText("version-guidance", state.customEvidence !== null
    ? "EV-004 and its source note are preserved. Use Load entered version to return to this comparison. Start another version session to enter different evidence."
    : (state.review !== null ? "This session's review has already opened against a preset version. Its evidence cannot be replaced. Start another version session to record a new capture."
      : "Record one fictional Atlas manifest. Requested access and declared grants are independent; runtime activity remains unobserved. Use synthetic material only."));
}

function permissionDifference(label: string, baseline: readonly string[], current: readonly string[]): string {
  const added: readonly string[] = current.filter((value: string): boolean => !baseline.includes(value));
  const removed: readonly string[] = baseline.filter((value: string): boolean => !current.includes(value));
  const rows: string[] = [
    ...added.map((value: string): string => `<div class="diff-row diff-added"><span class="diff-label">Added ${label}</span><code>+ ${escapeHtml(value)}</code></div>`),
    ...removed.map((value: string): string => `<div class="diff-row diff-removed"><span class="diff-label">Removed ${label}</span><code>− ${escapeHtml(value)}</code></div>`),
  ];
  return rows.length === 0 ? `<div class="diff-row"><span class="diff-label">${label === "request" ? "Requested access" : "Declared grants"} unchanged</span><code>${escapeHtml(current.join(", "))}</code></div>` : rows.join("");
}

function comparisonMarkup(current: Evidence): string {
  const original: Evidence = getEvidence("EV-001");
  const grantChanged: boolean = current.grantedPermissions.length !== original.grantedPermissions.length || current.grantedPermissions.some((permission): boolean => !original.grantedPermissions.includes(permission));
  const explanation: string = requiresReview(current)
    ? "The requested write access challenges ASM-001 and suggests review. Declared grants are separate source claims; no runtime activity is observed."
    : (grantChanged ? "No request-assumption contradiction. Declared grants differ and need separate assessment; the narrow ASM-001 trigger does not cover grant changes. This comparison does not establish that the approval is safe."
      : "No relevant change under the ASM-001 request rule. Permission content matches the original basis. This comparison suggests no review; activity remains unobserved.");
  return `${permissionDifference("request", original.requestedPermissions, current.requestedPermissions)}${permissionDifference("grant", original.grantedPermissions, current.grantedPermissions)}<p>${explanation}</p>`;
}

/** Render the selected comparison against the preserved original decision basis. */
export function renderState(state: DemoState): void {
  const current: Evidence = evidenceForState(state, state.selectedEvidenceId);
  const affected: boolean = requiresReview(current);
  const latest: OutcomeRecord | undefined = state.outcomes.at(-1);
  const finalOutcome: boolean = latest !== undefined && latest.outcome !== "defer";
  setText("decision-status", latest === undefined ? "Original approval" : outcomeLabel(latest.outcome));
  setText("decision-current", latest === undefined ? ORIGINAL_DECISION.statement : latest.statement);
  setMarkup("decision-original", `<p>${escapeHtml(ORIGINAL_DECISION.statement)}</p><p>${escapeHtml(ORIGINAL_DECISION.rationale)}</p><p class="history-meta">${ORIGINAL_DECISION.revision} · ${ORIGINAL_DECISION.evidenceId} · ${escapeHtml(ORIGINAL_DECISION.actor)}</p>`);
  setText("assumption-status", affected ? "Requested write access contradicts ASM-001" : "ASM-001 remains supported by this comparison");
  setMarkup("source-baseline", evidenceMarkup(getEvidence("EV-001")));
  setMarkup("source-current", evidenceMarkup(current));
  setMarkup("evidence-diff", comparisonMarkup(current));
  setMarkup("impact-path", `<ol class="impact-list" aria-label="Explore the evidence-to-review relationship">
    <li class="impact-node"><details><summary data-testid="trace-source-toggle"><span>SRC-001 / ${current.id}</span><strong>${affected ? "Write access requested" : "Read-only request"}</strong></summary><p>Requested: ${escapeHtml(current.requestedPermissions.join(", "))}. Declared granted: ${escapeHtml(current.grantedPermissions.join(", "))}. Runtime activity is not observed. The trigger checks requested write access against ASM-001; changed grants need separate assessment.</p></details></li>
    <li class="impact-node"><details><summary data-testid="trace-assumption-toggle"><span>ASM-001</span><strong>${affected ? "Read-only assumption challenged" : "Read-only assumption supported"}</strong></summary><p>The original approval assumes requests remain read-only. ${affected ? "The new request contradicts that assumption; it does not prove write access was granted or used." : "This selected comparison does not contradict the assumption."}</p></details></li>
    <li class="impact-node"><details><summary data-testid="trace-decision-toggle"><span>DEC-001.1</span><strong>Original approval for summarization</strong></summary><p>${escapeHtml(ORIGINAL_DECISION.rationale)} This path describes the preserved original basis, even after a later human outcome.</p></details></li>
    <li class="impact-node"><details><summary data-testid="trace-review-toggle"><span>REV-001 · Morgan Lee</span><strong>${state.review === null ? (affected ? "Review suggested; not opened" : "No review from this comparison") : (latest === undefined ? "Awaiting a human outcome" : outcomeLabel(latest.outcome))}</strong></summary><p>${state.review === null ? "Viewing this relationship records no outcome. When changed evidence warrants it, a person opens the assigned review and explains their decision." : `The opened review retains EV-001 and ${state.review.changed.id}. A different selected comparison does not erase that review or any recorded outcome. Return to its exact evidence version to record an outcome.`}</p></details></li>
  </ol>`);
  setText("review-id", state.review === null ? "Not opened" : `${state.review.id} · ${state.review.baseline.id} → ${state.review.changed.id}`);
  setText("review-status", state.review === null
    ? (affected ? "Review suggested · original decision preserved" : "No review opened")
    : (latest === undefined ? "Pending human outcome" : outcomeLabel(latest.outcome)));
  const openButton: HTMLElement = getElement("open-review");
  if (!(openButton instanceof HTMLButtonElement)) throw new TypeError("#open-review must be a button.");
  openButton.disabled = !affected || state.review !== null;
  openButton.hidden = state.review !== null;
  const form: HTMLElement = getElement("review-form");
  form.hidden = state.review === null || state.selectedEvidenceId !== state.review.changed.id || finalOutcome;
  setMarkup("history", historyMarkup(state));
  getElement("load-changed").setAttribute("aria-pressed", String(current.id === "EV-002"));
  getElement("load-control").setAttribute("aria-pressed", String(current.id === "EV-003"));
  getElement("load-authored").hidden = state.schemaVersion !== 2 || state.customEvidence === null;
  getElement("load-authored").setAttribute("aria-pressed", String(current.id === "EV-004"));
  renderVersionEntry(state);
  getElement("load-control").classList.toggle("primary", current.id === "EV-001");
  getElement("load-control").classList.toggle("secondary", current.id !== "EV-001");
  getElement("load-changed").classList.toggle("primary", current.id !== "EV-001");
  getElement("load-changed").classList.toggle("secondary", current.id === "EV-001");
  renderJourney(state);
}

export function announce(message: string): void {
  setText("feedback-message", message);
}

/** Surface errors without resetting data or swallowing the original browser error. */
export function showError(error: Error): void {
  const element: HTMLElement = getElement("error-message");
  element.hidden = false;
  element.textContent = `${error.name}: ${error.message} Local history was not reset. Inspect the error before continuing.`;
  setText("journey-status", "Session unavailable");
  setText("journey-title", "Inspect the saved record before continuing.");
  setText("journey-description", "The session could not be validated. The error below explains what failed; local history has not been replaced.");
  getElement("journey-next").hidden = true;
  console.error("decision_continuity_error", { name: error.name, message: error.message });
  for (const id of ["load-changed", "load-control", "load-authored", "record-evidence", "open-review", "record-outcome"]) {
    const control: HTMLElement = getElement(id);
    if (!(control instanceof HTMLButtonElement)) throw new TypeError(`#${id} must be a button.`);
    control.disabled = true;
  }
}
