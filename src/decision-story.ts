import { escapeHtml, getElement } from "./render.ts";
import { sharedBasis, sharedDecision, sharedEvidence, sharedImpact, sharedPendingReview } from "./shared-model.ts";
import type { SharedHistory, SharedEvidence } from "./shared-model.ts";
import { inspectSharedNode } from "./shared-render.ts";
import type { TrailKind } from "./shared-render.ts";
import { outcomeLabel } from "./journey.ts";

function captureLabel(state: SharedHistory, id: string): string {
  const index = state.sources.findIndex((event): boolean => event.evidence.id === id);
  if (index < 0) throw new ReferenceError("The story's evidence has no preserved capture.");
  return `Capture ${index + 1}`;
}

function reference(kind: TrailKind, id: string, label: string, testId: string): string {
  return `<button type="button" class="story-record-link" data-story-kind="${kind}" data-story-id="${escapeHtml(id)}" data-testid="${testId}" aria-controls="shared-inspector">${escapeHtml(label)} <span aria-hidden="true">↗</span></button>`;
}

function evidenceSummary(evidence: SharedEvidence): string {
  const permissions = (values: readonly string[]): string => values.map((value): string => value.replace("documents:", "")).join(", ") || "none";
  return `Requested: ${permissions(evidence.requestedPermissions)} · Declared grants: ${permissions(evidence.grantedPermissions)} · Context: ${evidence.environment}`;
}

/** Explain preserved relationships; visual sequence never supplies a new decision, rule result or causal link. */
export function decisionStoryMarkup(state: SharedHistory, decisionId: string): string {
  const record = sharedDecision(state, decisionId), basis = sharedBasis(state, decisionId);
  const latest = state.sources.at(-1), pending = sharedPendingReview(state, decisionId);
  if (latest === undefined) throw new ReferenceError("A decision story requires a preserved capture.");
  const support = basis === null ? null : sharedEvidence(state, basis.evidenceId);
  const impact = sharedImpact(state, record, basis, latest.evidence);
  const review = state.reviews.filter((item): boolean => item.decisionId === decisionId).at(-1);
  const outcome = state.outcomes.filter((item): boolean => item.reviewId === review?.id).at(-1);
  const activeOutcome = state.outcomes.filter((item): boolean => item.decisionId === decisionId && item.outcome !== "defer").at(-1);
  const field = record.assumption.field;
  const previous = support?.[field];
  const added = previous === undefined ? [] : latest.evidence[field].filter((value): boolean => !previous.includes(value));
  const removed = previous === undefined ? [] : previous.filter((value): boolean => !latest.evidence[field].includes(value));
  const changes = [...added.map((value): string => `Added ${value.replace("documents:", "")}`), ...removed.map((value): string => `Removed ${value.replace("documents:", "")}`)];
  const permissionChange = support === null ? "No active decision basis to compare." : changes.join(" · ") || "No change to the monitored permissions.";
  const contextChange = support === null ? "" : `Declared context: ${support.environment} → ${latest.evidence.environment}.`;
  const labels = { affected: "Review needed", unchanged: "No relevant change", unresolved: "Context unresolved", inactive: "Decision withdrawn" } as const;
  return `<div class="story-header"><div><p class="eyebrow">Follow one decision</p><h3 id="story-title">${escapeHtml(record.decision.title)}</h3></div><div class="story-picker"><label for="story-decision">Decision</label><select id="story-decision" data-testid="story-decision" aria-controls="decision-story">${state.originalDecisions.map((item): string => `<option value="${escapeHtml(item.decision.id)}"${item.decision.id === decisionId ? " selected" : ""}>${escapeHtml(item.decision.title)}</option>`).join("")}</select></div></div>
    <div class="story-actions"><button type="button" class="btn primary" data-testid="story-next-review" data-story-review="${escapeHtml(decisionId)}">${pending === null ? "Go to human review" : "Continue this human review"} <span aria-hidden="true">→</span></button>${basis === null ? "" : `<button type="button" class="btn secondary" data-testid="story-compare" data-story-compare="${escapeHtml(decisionId)}" data-story-from="${escapeHtml(activeOutcome?.id ?? basis.sourceEventId)}">Compare recorded states</button>`}</div><ol class="story-steps">
      <li class="story-step"><span class="story-step-label">Earlier decision</span><div class="story-record"><h4>${basis === null ? "No active decision" : "Evidence supporting the active decision"}</h4><p>${escapeHtml(basis?.statement ?? "This decision was withdrawn. Its original basis and earlier outcomes remain preserved.")}</p>${support === null ? "" : `<p class="story-change">${escapeHtml(evidenceSummary(support))}</p>${reference("evidence", support.id, `${captureLabel(state, support.id)} · supporting evidence`, "story-support")} `}${reference("decision", decisionId, "Inspect decision and rationale", "story-basis")}</div></li>
      <li class="story-step"><span class="story-step-label">Changed evidence</span><div class="story-record"><h4>Latest captured evidence <span class="status ${impact.status}" data-testid="story-status">${labels[impact.status]}</span></h4><p class="story-change" data-testid="story-delta">${escapeHtml(permissionChange)} ${escapeHtml(contextChange)}</p><p>${escapeHtml(evidenceSummary(latest.evidence))}</p>${reference("evidence", latest.evidence.id, `${captureLabel(state, latest.evidence.id)} · latest capture`, "story-latest")}<p class="history-meta">Monitored field: ${field === "requestedPermissions" ? "requested permissions" : "declared granted permissions"}. Requests and grants are separate declarations.</p></div></li>
      <li class="story-step"><span class="story-step-label">Reason for review</span><div class="story-record"><h4>${pending === null ? "Current rule result" : "Open review · frozen evidence target"}</h4><p data-testid="story-reason">${escapeHtml(impact.explanation)}</p>${reference("assumption", record.assumption.id, "Inspect the explicit rule", "story-rule")}${pending === null ? `<p class="history-meta">${review === undefined ? "No human review has been opened for this decision." : "No open human review. Earlier review records remain in history."}</p>` : `<div class="story-frozen" data-testid="story-frozen"><p>${escapeHtml(captureLabel(state, pending.evidenceId))} remains the target of this open review${pending.evidenceId !== latest.evidence.id ? `; ${escapeHtml(captureLabel(state, latest.evidence.id))} is a later capture` : ""}. Later captures do not retarget it.</p>${reference("evidence", pending.evidenceId, `${captureLabel(state, pending.evidenceId)} · open review target`, "story-target")} ${reference("review", pending.id, "Inspect frozen review and its reason", "story-review")}<p class="history-meta">The current rule result above uses the latest capture; the review record preserves its reason at opening.</p></div>`}</div></li>
      <li class="story-step"><span class="story-step-label">Recorded human outcome</span><div class="story-record"><h4 data-testid="story-outcome-label">${outcome === undefined ? "No outcome recorded" : escapeHtml(outcomeLabel(outcome.outcome))}</h4><p>${outcome === undefined ? "A person must explicitly open a review and record an outcome with a rationale. Capturing evidence does neither." : escapeHtml(outcome.rationale)}</p>${outcome === undefined ? "" : reference("outcome", outcome.id, "Inspect responsible code and recorded outcome", "story-outcome")}${outcome?.outcome === "defer" ? "<p class=\"history-meta\">Deferral keeps the review open and the earlier decision basis in place.</p>" : ""}</div></li>
    </ol><p class="history-meta">Record-supported explanation · synthetic evidence · runtime not observed. An answered evidence question is separate from a human decision outcome.</p>`;
}

function selectRecordedState(id: string, value: string): void {
  const picker = getElement(id);
  if (!(picker instanceof HTMLSelectElement)) throw new TypeError(`${id} must be a recorded-state selector.`);
  if (![...picker.options].some((option): boolean => option.value === value)) throw new ReferenceError(`The requested recorded state is unavailable in ${id}. Choose an available state in the comparison panel.`);
  picker.value = value;
  picker.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Keep selection and inspector return context temporary; every history refresh invalidates the origin. */
export function connectDecisionStory(goToReview: (decisionId: string) => void, perform: (work: () => void) => void): (state: SharedHistory) => void {
  const root = getElement("decision-story"), back = getElement("story-return");
  let state: SharedHistory | null = null, selected: string | null = null;
  let origin: Readonly<{ button: HTMLButtonElement; top: number; left: number }> | null = null;
  function invalidate(): void { origin = null; back.hidden = true; }
  function render(): void {
    if (state === null || selected === null) throw new ReferenceError("Select a preserved decision before following its story.");
    root.innerHTML = decisionStoryMarkup(state, selected);
    const compare = root.querySelector<HTMLButtonElement>("[data-story-compare]");
    if (compare !== null) compare.hidden = getElement("basis-panel").hidden;
  }
  root.addEventListener("change", (event: Event): void => perform((): void => {
    if (!(event.target instanceof HTMLSelectElement) || event.target.id !== "story-decision") return;
    if (state === null) throw new ReferenceError("A saved workspace is required to select a decision.");
    sharedDecision(state, event.target.value);
    selected = event.target.value; invalidate(); render(); getElement("story-decision").focus({ preventScroll: true });
  }));
  root.addEventListener("click", (event: MouseEvent): void => perform((): void => {
    if (!(event.target instanceof Element)) throw new TypeError("Story interaction requires an element.");
    const button = event.target.closest("button");
    if (!(button instanceof HTMLButtonElement) || state === null) return;
    if (button.dataset.storyReview !== undefined) { invalidate(); goToReview(button.dataset.storyReview); return; }
    if (button.dataset.storyCompare !== undefined) {
      invalidate();
      const panel = getElement("basis-panel");
      if (panel.hidden) throw new RangeError("Recorded-state comparison requires a v6 or v7 workspace. Open a clarification workspace to compare recorded states.");
      const from = button.dataset.storyFrom;
      if (from === undefined) throw new ReferenceError("The active basis has no exact source event.");
      selectRecordedState("basis-decision", button.dataset.storyCompare);
      selectRecordedState("basis-event", from);
      selectRecordedState("basis-compare-event", "latest");
      panel.focus(); panel.scrollIntoView({ block: "start", behavior: "instant" }); return;
    }
    const kind = button.dataset.storyKind, id = button.dataset.storyId;
    if (kind === undefined || id === undefined) throw new TypeError("A story reference requires an exact record kind and ID.");
    if (kind !== "decision" && kind !== "evidence" && kind !== "review" && kind !== "outcome" && kind !== "assumption") throw new TypeError("Unsupported story reference kind.");
    inspectSharedNode(state, { kind, id });
    origin = { button, top: window.scrollY, left: window.scrollX }; back.hidden = false;
    const inspector = getElement("shared-inspector"); inspector.focus(); inspector.scrollIntoView({ block: "start", behavior: "instant" });
  }));
  back.addEventListener("click", (): void => perform((): void => {
    const saved = origin; invalidate();
    if (saved === null || !saved.button.isConnected) throw new ReferenceError("The original explanation has changed. Choose the decision again to inspect its current story.");
    saved.button.focus({ preventScroll: true }); window.scrollTo({ top: saved.top, left: saved.left, behavior: "instant" });
  }));
  for (const id of ["shared-trail", "workspace-attention", "clarification-events"]) getElement(id).addEventListener("click", invalidate);
  document.addEventListener("change", (event: Event): void => { if (event.target instanceof HTMLInputElement && event.target.type === "file") invalidate(); });
  return (next: SharedHistory): void => {
    invalidate(); state = next;
    if (selected === null || !next.originalDecisions.some((record): boolean => record.decision.id === selected)) selected = next.originalDecisions[0]?.decision.id ?? null;
    render();
  };
}
