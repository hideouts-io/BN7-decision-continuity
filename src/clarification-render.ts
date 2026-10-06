import { escapeHtml, getElement } from "./render.ts";
import { sharedEvidence, sharedDecision } from "./shared-model.ts";
import type { ClarificationState } from "./clarification-model.ts";

function facts(entries: readonly (readonly [string, string])[]): string {
  return `<dl class="shared-facts">${entries.map(([label, value]): string => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`;
}
function version(state: ClarificationState, id: string): string {
  const index = state.sources.findIndex((event): boolean => event.evidence.id === id);
  if (index < 0) throw new ReferenceError("A replacement target requires its recorded evidence.");
  return `Version ${index + 1}`;
}
export function renderClarificationHistory(state: ClarificationState): void {
  getElement("clarification-history").hidden = false;
  getElement("clarification-events").innerHTML = state.replacements.length === 0 ? "<p>No review has been replaced. Capture and clarification never create an approval or replacement automatically.</p>" : state.replacements.map((event, index: number): string => `<article class="panel authored-panel" data-testid="replacement-event-${index}"><p class="eyebrow">Explicit review replacement / no decision change</p><h3>${escapeHtml(sharedDecision(state, event.decisionId).decision.title)}</h3><p>Earlier question: deployment context was Unknown. Later declaration: Production. The old review and deferral remain intact; the new review asks about the clarified capture. Runtime remains Not observed.</p><div class="shared-source-nodes"><button type="button" class="trail-node" data-testid="replacement-old-${index}" data-review-id="${event.oldReviewId}" aria-controls="shared-inspector"><span>Replaced review · historical context</span><strong>${version(state, event.oldEvidenceId)} · Unknown</strong><span class="trail-inspect">Inspect frozen question ↗</span></button><svg class="shared-source-arrow" viewBox="0 0 50 24" aria-hidden="true"><path d="M0 12 H44 M36 4 L44 12 L36 20" /></svg><button type="button" class="trail-node" data-testid="replacement-new-${index}" data-review-id="${event.newReviewId}" aria-controls="shared-inspector"><span>Replacement review · separate outcome</span><strong>${version(state, event.newEvidenceId)} · Production</strong><span class="trail-inspect">Inspect clarified question ↗</span></button></div>${facts([["Initiated by", event.actor], ["Recorded · UTC", event.recordedAt], ["Reason", event.rationale], ["Replacement event", event.id], ["Old review", event.oldReviewId], ["New review", event.newReviewId], ["Old source event / evidence", `${event.oldSourceEventId} / ${event.oldEvidenceId}`], ["New source event / evidence", `${event.newSourceEventId} / ${event.newEvidenceId}`]])}</article>`).join("");
}
/** Annotate the selected review with its exact replacement link; never substitute latest evidence. */
export function annotateClarificationReview(state: ClarificationState, id: string): void {
  const event = state.replacements.find((item): boolean => item.oldReviewId === id || item.newReviewId === id);
  if (event === undefined) return;
  const oldTarget = sharedEvidence(state, event.oldEvidenceId), newTarget = sharedEvidence(state, event.newEvidenceId);
  getElement("shared-inspection").insertAdjacentHTML("beforeend", `<section class="continuity-summary" data-testid="replacement-inspection"><h3>${event.oldReviewId === id ? "Replaced review · earlier unanswered question" : "Replacement review · clarified question"}</h3><p>This is the selected review's frozen context. Replacement does not resolve the old question as approved, alter its evidence, or establish runtime behavior.</p>${facts([["Deployment declaration", `${oldTarget.environment} → ${newTarget.environment}`], ["Old reviewed evidence", event.oldEvidenceId], ["New reviewed evidence", event.newEvidenceId], ["Recorded replacement reason", event.rationale], ["Responsible code", event.actor], ["Remaining uncertainty", "Actual deployment, effective grants and runtime behavior remain unobserved. A declaration is not operational verification."]])}</section>`);
}
