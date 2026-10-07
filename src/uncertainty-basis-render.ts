import type { ClarificationHistory } from "./clarification-model.ts";
import type { BasisColumn } from "./decision-basis-render.ts";
import type { UncertaintyBasisContext } from "./uncertainty-basis.ts";
import type { UncertaintyResolution } from "./uncertainty-model.ts";
import { escapeHtml } from "./render.ts";

type CaptureArchive = Pick<ClarificationHistory, "sources">;
type RequirementContext = UncertaintyBasisContext["requirements"][number];
type Fact = readonly [string, string, string];

function facts(prefix: string, entries: readonly Fact[]): string {
  return `<dl class="basis-facts">${entries.map(([key, label, value]): string => `<div><dt>${escapeHtml(label)}</dt><dd id="${prefix}-${key}" data-testid="${prefix}-${key}">${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
}
function responseMarkup(archive: CaptureArchive, response: UncertaintyResolution, prefix: BasisColumn): string {
  const capture = archive.sources.find((event): boolean => event.id === response.sourceEventId && event.evidence.id === response.evidenceId);
  if (capture === undefined) throw new ReferenceError("Historical evidence responses require their exact preserved source-event/evidence pair.");
  const id = `${prefix}-resolution-${response.id}`, evidence = capture.evidence;
  const label = response.result === "satisfied" ? "Declared-context requirement addressed" : "Insufficient · question remains open";
  return `<li class="basis-block" id="${id}" data-testid="${id}" data-resolution-id="${escapeHtml(response.id)}" data-result="${response.result}"><h4>${label}</h4>${facts(id, [
    ["result", "Recorded response", response.result], ["rationale", "Accountable response rationale", response.rationale],
    ["actor", "Responsible fictional code", response.actor], ["recorded-at", "Response recorded · UTC", response.recordedAt],
  ])}<details><summary data-testid="${id}-references">Exact response and evaluated capture</summary>${facts(`${id}-references`, [
    ["resolution", "Response UUID", response.id], ["requirement", "Requirement UUID", response.requirementId],
    ["source-event", "Evaluated source event UUID", capture.id], ["evidence", "Evaluated evidence UUID", evidence.id],
    ["source", "Canonical source UUID", evidence.sourceId], ["captured-at", "Captured · UTC", evidence.capturedAt],
    ["recorded-at", "Capture recorded · UTC", capture.recordedAt], ["environment", "Declared deployment context", evidence.environment],
    ["requested", "Requested access", evidence.requestedPermissions.join(", ")], ["granted", "Declared granted access · independent", evidence.grantedPermissions.join(", ")],
    ["note", "Source note", evidence.sourceNote], ["runtime", "Runtime", evidence.observedActivity], ["provenance", "Provenance", evidence.provenance],
  ])}</details><p class="basis-note">This response evaluates only the recorded evidence requirement. It does not approve production, replace the review or revise its decision.</p></li>`;
}
function requirementMarkup(archive: CaptureArchive, context: RequirementContext, prefix: BasisColumn): string {
  const requirement = context.requirement, id = `${prefix}-requirement-${requirement.id}`;
  const status = context.status === "satisfied" ? "Declared-context requirement addressed" : context.status === "insufficient" ? "Still open · later evidence needed" : "Awaiting later evidence and human response";
  return `<article class="basis-block basis-requirement" id="${id}" data-testid="${id}" data-requirement-id="${escapeHtml(requirement.id)}" data-review-id="${escapeHtml(requirement.reviewId)}" data-status="${context.status}" aria-labelledby="${id}-title"><h4 id="${id}-title">${status}</h4>${facts(id, [
    ["question", "Recorded question", requirement.question], ["required-evidence", "Required evidence", requirement.requiredEvidence],
    ["trigger", "Reassessment trigger", requirement.triggerDescription], ["actor", "Responsible fictional code", requirement.actor],
    ["recorded-at", "Requirement recorded · UTC", requirement.recordedAt], ["criterion", "Structured criterion", `${requirement.field} = ${requirement.expectedEnvironment}`],
  ])}<details><summary data-testid="${id}-references">Exact question and frozen deferred-review references</summary>${facts(`${id}-references`, [
    ["requirement", "Requirement UUID", requirement.id], ["decision", "Decision UUID", requirement.decisionId], ["assumption", "Assumption UUID", requirement.assumptionId],
    ["source", "Canonical source UUID", requirement.sourceId], ["review", "Frozen review UUID", requirement.reviewId], ["deferral", "Preserved deferral UUID", requirement.deferredOutcomeId],
    ["source-event", "Frozen source event UUID", requirement.sourceEventId], ["evidence", "Frozen evidence UUID", requirement.evidenceId],
  ])}</details>${context.resolutions.length === 0 ? '<p class="basis-note">No human evidence response was recorded in this selected perspective.</p>' : `<ol class="basis-records">${context.resolutions.map((response): string => responseMarkup(archive, response, prefix)).join("")}</ol>`}<p class="basis-note">The explanatory question, required evidence and trigger are preserved text. Only the narrow declared-context criterion is structured; satisfaction supplies no approval or runtime assurance.</p></article>`;
}

/** Render only the selected causal cut's questions and responses; later journal attempts never fill earlier gaps. */
export function uncertaintyBasisMarkup(archive: CaptureArchive, context: UncertaintyBasisContext, prefix: BasisColumn): string {
  return `<section class="basis-block basis-clarification" id="${prefix}-requirements" data-testid="${prefix}-requirements"><h4>Recorded evidence questions and human responses</h4>${context.requirements.length === 0 ? '<p data-testid="' + prefix + '-requirements-empty">No evidence requirement was recorded in this selected perspective.</p>' : context.requirements.map((requirement): string => requirementMarkup(archive, requirement, prefix)).join("")}<p class="basis-note">Only records inside this endpoint are shown. A continuation envelope timestamp does not prove a question existed earlier. Satisfaction answers an evidence question; a separate accountable review outcome changes the decision.</p></section>`;
}
