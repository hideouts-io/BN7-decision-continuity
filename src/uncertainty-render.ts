import { escapeHtml } from "./render.ts";
import { sharedDecision } from "./shared-model.ts";
import { uncertaintyResolutionsForRequirement } from "./uncertainty-model.ts";
import type { UncertaintyState, UncertaintyRequirement, UncertaintyResolution } from "./uncertainty-model.ts";

function facts(entries: readonly (readonly [string, string])[]): string {
  return `<dl class="shared-facts">${entries.map(([label, value]): string => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`;
}

function resolutionMarkup(state: UncertaintyState, resolution: UncertaintyResolution, requirementIndex: number, resolutionIndex: number): string {
  const captureIndex = state.history.sources.findIndex((event): boolean => event.id === resolution.sourceEventId);
  const capture = state.history.sources[captureIndex];
  if (capture === undefined || capture.evidence.id !== resolution.evidenceId) throw new ReferenceError("A human evidence response requires its exact preserved source event and evidence.");
  const label = resolution.result === "satisfied" ? "Declared-context requirement addressed" : "Insufficient · question remains open";
  return `<li data-testid="uncertainty-resolution-${requirementIndex}-${resolutionIndex}" data-resolution-id="${resolution.id}" data-result="${resolution.result}" data-source-event-id="${capture.id}" data-evidence-id="${capture.evidence.id}"><h4>${resolutionIndex + 1}. ${label}</h4><p>${escapeHtml(resolution.rationale)}</p><p class="history-meta">${escapeHtml(resolution.actor)} · recorded ${escapeHtml(resolution.recordedAt)} · Version ${captureIndex + 1} declares ${capture.evidence.environment}. Runtime Not observed.</p><details><summary data-testid="uncertainty-resolution-references-${requirementIndex}-${resolutionIndex}">Exact response and capture references</summary>${facts([["Human response UUID", resolution.id], ["Requirement UUID", resolution.requirementId], ["Source event", capture.id], ["Evidence UUID", capture.evidence.id], ["Canonical source", capture.evidence.sourceId], ["Captured · UTC", capture.evidence.capturedAt], ["Source recorded · UTC", capture.recordedAt], ["Declared context", capture.evidence.environment], ["Requested", capture.evidence.requestedPermissions.join(", ")], ["Declared granted · independent", capture.evidence.grantedPermissions.join(", ")], ["Source note", capture.evidence.sourceNote], ["Runtime", capture.evidence.observedActivity], ["Provenance", capture.evidence.provenance]])}</details></li>`;
}

function requirementMarkup(state: UncertaintyState, requirement: UncertaintyRequirement, index: number): string {
  const responses = uncertaintyResolutionsForRequirement(state, requirement.id);
  const finalResponse = responses.at(-1);
  const label = finalResponse?.result === "satisfied" ? "Declared-context requirement addressed" : finalResponse === undefined ? "Awaiting later evidence and human response" : "Still open · later evidence needed";
  const decision = sharedDecision(state.history, requirement.decisionId);
  return `<article class="uncertainty-record" data-testid="uncertainty-requirement-${index}" data-requirement-id="${requirement.id}" data-review-id="${requirement.reviewId}" data-status="${finalResponse?.result === "satisfied" ? "satisfied" : "open"}" aria-labelledby="uncertainty-record-title-${index}"><div class="uncertainty-record-heading"><div><p class="eyebrow">${escapeHtml(decision.decision.title)}</p><h4 id="uncertainty-record-title-${index}">${escapeHtml(requirement.question)}</h4></div><span class="shared-status">${label}</span></div>${facts([["Required evidence", requirement.requiredEvidence], ["Reassessment trigger", requirement.triggerDescription], ["Structured contract", "Later evidence declares Production; explanatory text is not automatically evaluated"], ["Responsible fictional code", requirement.actor], ["Requirement recorded · UTC", requirement.recordedAt]])}<details><summary data-testid="uncertainty-references-${index}">Exact question and deferred-review references</summary>${facts([["Requirement UUID", requirement.id], ["Decision UUID", requirement.decisionId], ["Assumption UUID", requirement.assumptionId], ["Canonical source", requirement.sourceId], ["Frozen review", requirement.reviewId], ["Preserved deferral", requirement.deferredOutcomeId], ["Frozen source event", requirement.sourceEventId], ["Frozen evidence", requirement.evidenceId], ["Criterion", `${requirement.field} = ${requirement.expectedEnvironment}`]])}</details>${responses.length === 0 ? '<p class="history-meta">No human response recorded. The deferred decision remains intact.</p>' : `<ol class="uncertainty-responses">${responses.map((response, responseIndex: number): string => resolutionMarkup(state, response, index, responseIndex)).join("")}</ol>`}<p class="history-meta">These responses do not approve or revise a decision. Reviewer codes are unauthenticated; runtime remains Not observed.</p></article>`;
}

/** Render preserved requirements and responses without deriving a decision outcome. */
export function uncertaintyHistoryMarkup(state: UncertaintyState): string {
  return state.requirements.length === 0 ? "<p>No evidence requirement has been recorded. Select a deferred Unknown production review, then explain the question and evidence needed.</p>" : state.requirements.map((requirement, index: number): string => requirementMarkup(state, requirement, index)).join("");
}

export function uncertaintyProvenanceMarkup(state: UncertaintyState): string {
  return facts([["v7 continuation UUID", state.id], ["Continuation created · UTC", state.createdAt], ["Preserved original history UUID", state.history.id], ["Original decision format", "v6 embedded unchanged at enrollment; subsequent records append inside this continuation"], ["Storage boundary", "One continuation record contains decision history, requirements and responses. Enrollment does not overwrite the original v6 record."], ["Limits", "Synthetic evidence, unauthenticated reviewer codes, editable local storage, no live source monitor"]]);
}
