import { z } from "zod";
import { appPath } from "./app-path.ts";
import { finishApplicationLoading } from "./app-ready.ts";
import { getElement } from "./render.ts";
import { createSharedState, appendSharedEvidence, openSharedReview, appendSharedOutcome, EnvironmentSchema, sharedBasis, sharedDecision, sharedImpact, sharedPendingReview } from "./shared-model.ts";
import type { SharedState } from "./shared-model.ts";
import { createClarificationState, appendClarificationEvidence, openClarificationReview, appendClarificationOutcome, replaceClarificationReview } from "./clarification-model.ts";
import type { ClarificationState } from "./clarification-model.ts";
import { listClarificationIds, persistClarificationState, readClarificationState } from "./clarification-storage.ts";
import { clarificationHistoryExport } from "./clarification-export.ts";
import { renderClarificationHistory, annotateClarificationReview } from "./clarification-render.ts";
type SharedWorkspace = SharedState | ClarificationState;
import type { ContinuityPermission } from "./continuity-model.ts";
import { listSharedIds, persistSharedState, readSharedState } from "./shared-storage.ts";
import { sharedHistoryExport } from "./shared-export.ts";
import { inspectSharedNode, renderSharedState } from "./shared-render.ts";
import { connectRecovery } from "./recovery-ui.ts";
import { urlForSession } from "./sessions.ts";
import { OutcomeSchema } from "./scenario.ts";
import { outcomeExplanation } from "./journey.ts";

function field(id: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const element = getElement(id);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) throw new TypeError(`${id} must be a typed input, textarea or select.`);
  return element;
}
function form(id: string): HTMLFormElement {
  const element = getElement(id);
  if (!(element instanceof HTMLFormElement)) throw new TypeError(`${id} must be a form.`);
  return element;
}
function checked(id: string): boolean {
  const element = field(id);
  if (!(element instanceof HTMLInputElement) || element.type !== "checkbox") throw new TypeError(`${id} must be a checkbox.`);
  return element.checked;
}
function permissions(prefix: string): ContinuityPermission[] {
  return (["read", "write", "delete"] as const).filter((suffix): boolean => checked(`${prefix}-${suffix}`)).map((suffix): ContinuityPermission => `documents:${suffix}`);
}
function displayError(error: Error): void {
  const message = getElement("shared-error");
  message.textContent = `${error.name}: ${error.message} No existing history was replaced.`;
  message.hidden = false;
  message.scrollIntoView({ block: "center" });
  console.error("decision_continuity_shared_error", { name: error.name, message: error.message });
}
function action(work: () => void): void {
  getElement("shared-error").hidden = true;
  try { work(); } catch (error) {
    if (!(error instanceof Error)) throw error;
    displayError(error);
  }
}
function explainOutcome(): void {
  const value: string = field("shared-outcome").value;
  getElement("shared-boundary").hidden = value !== "revise";
  getElement("shared-outcome-explanation").textContent = outcomeExplanation(value === "" ? "" : OutcomeSchema.parse(value));
  const statement = field("shared-statement");
  if (!(statement instanceof HTMLTextAreaElement)) throw new TypeError("Decision statement must be a textarea.");
  statement.readOnly = state?.schemaVersion === 6 && value === "reaffirm";
  if (statement.readOnly && state !== null) {
    const pending = sharedPendingReview(state, field("shared-review-decision").value);
    if (pending !== null) statement.value = pending.basis.statement;
    getElement("shared-outcome-explanation").textContent += " Reaffirm preserves the exact earlier scope, including a production hold; use Revise for a changed scope.";
  }
}
const storage: Storage = window.localStorage;
let state: SharedWorkspace | null = null;
const selectedFormat: string | null = new URL(window.location.href).searchParams.get("format");
function current(): SharedWorkspace {
  if (state === null) throw new ReferenceError("Create or restore a shared-source rehearsal first.");
  return state;
}
function refreshReview(): void {
  const record = current(), decisionId: string = field("shared-review-decision").value;
  const decision = sharedDecision(record, decisionId), pending = sharedPendingReview(record, decisionId), target = record.sources.at(-1);
  if (target === undefined) throw new ReferenceError("A review requires captured shared evidence.");
  const impact = sharedImpact(record, decision, sharedBasis(record, decisionId), target.evidence);
  const alreadyReviewed: boolean = record.reviews.some((review): boolean => review.decisionId === decisionId && review.sourceEventId === target.id);
  const open = getElement("shared-open-review");
  if (!(open instanceof HTMLButtonElement)) throw new TypeError("shared-open-review must be a button.");
  open.disabled = pending !== null || alreadyReviewed || impact.status === "unchanged" || impact.status === "inactive";
  getElement("shared-outcome-form").hidden = pending === null;
  field("shared-reviewer").value = decision.decision.actor;
  const outcome = field("shared-outcome");
  if (!(outcome instanceof HTMLSelectElement)) throw new TypeError("Outcome must be a select.");
  for (const option of outcome.options) option.disabled = pending?.trigger === "unresolved" && (option.value === "reaffirm" || option.value === "revise");
  getElement("shared-review-context").textContent = pending === null ? `${impact.explanation}${alreadyReviewed ? " This exact capture already received a terminal review outcome. Preserve it; record a later capture before reassessing again." : ""}` : `Assigned ${pending.actor} · Review ${pending.id} freezes revision ${pending.basis.revision} and evidence ${pending.evidenceId}. Latest capture: ${target.evidence.id}. ${pending.trigger === "unresolved" ? "Applicability of the reviewed capture is unresolved: defer or withdraw only; neither supplies approval." : "An outcome applies only to this frozen capture; newer evidence is assessed separately."}`;
  const replacementForm = form("shared-replacement-form");
  replacementForm.hidden = record.schemaVersion !== 6 || pending === null || pending.trigger !== "unresolved";
  if (record.schemaVersion === 6 && pending !== null) {
    field("replacement-actor").value = pending.actor;
    const replaceButton = getElement("replace-review");
    if (!(replaceButton instanceof HTMLButtonElement)) throw new TypeError("Replacement action must be a button.");
    const deferred = record.outcomes.filter((item): boolean => item.reviewId === pending.id).at(-1)?.outcome === "defer";
    replaceButton.disabled = pending.trigger !== "unresolved" || !deferred || target.evidence.environment !== "Production" || target.evidence.id === pending.evidenceId;
    getElement("replacement-context").textContent = `Frozen question: ${pending.evidenceId} (${record.sources.find((item): boolean => item.id === pending.sourceEventId)?.evidence.environment}). Latest declaration: ${target.evidence.id} (${target.evidence.environment}). Defer the Unknown review and capture a later Production declaration before replacement. The production hold and other decisions remain unchanged.`;
  }
  explainOutcome();
}
function show(next: SharedWorkspace): void {
  renderSharedState(next);
  if (next.schemaVersion === 6) renderClarificationHistory(next);
  const selection = field("shared-review-decision"), previous: string = selection.value;
  if (!(selection instanceof HTMLSelectElement)) throw new TypeError("Decision picker must be a select.");
  selection.replaceChildren(...next.originalDecisions.map((record): HTMLOptionElement => {
    const option = document.createElement("option"); option.value = record.decision.id; option.textContent = record.decision.title; return option;
  }));
  if (previous !== "") selection.value = previous;
  const latest = next.sources.at(-1);
  if (latest === undefined) throw new ReferenceError("A shared workspace requires evidence.");
  inspectSharedNode(next, { kind: "evidence", id: latest.evidence.id });
  field("shared-time").value = new Date().toISOString().slice(0, -1);
  refreshReview();
}
function save(next: SharedWorkspace, message: string): void {
  if (next.schemaVersion === 6) {
    if (state !== null && state.schemaVersion !== 6) throw new RangeError("Creation and updates cannot migrate an existing v5 workspace.");
    persistClarificationState(storage, state, next);
  } else {
    if (state !== null && state.schemaVersion !== 5) throw new RangeError("A v6 workspace cannot be written into the v5 namespace.");
    persistSharedState(storage, state, next);
  }
  state = next;
  show(next);
  getElement("shared-feedback").textContent = message;
}

try {
  if (selectedFormat !== null && selectedFormat !== "6") throw new RangeError("Shared impact accepts the original v5 route or explicit format=6 only. No record was migrated.");
  if (selectedFormat === "6") {
    getElement("page-title").innerHTML = "What can we<br /><span>reassess now?</span>";
    getElement("shared-scope-label").textContent = "Clarified review rehearsal · v6";
    getElement("clarification-introduction").hidden = false;
    getElement("clarification-start").hidden = true;
    document.title = "BN7 | Reassessment after clarification";
    const newLink = getElement("shared-new");
    if (!(newLink instanceof HTMLAnchorElement)) throw new TypeError("New rehearsal must be a link.");
    newLink.href = `${appPath("impact.html")}?format=6`;
  }
  const picker = field("shared-select");
  if (!(picker instanceof HTMLSelectElement)) throw new TypeError("Workspace picker must be a select.");
  for (const id of selectedFormat === "6" ? listClarificationIds(storage) : listSharedIds(storage)) {
    const record = selectedFormat === "6" ? readClarificationState(storage, id) : readSharedState(storage, id), option = document.createElement("option");
    option.value = record.id; option.textContent = `${record.source.name} · ${id.slice(0, 8)}`; picker.appendChild(option);
  }
  const id: string | null = new URL(window.location.href).searchParams.get("session");
  if (id !== null) { state = selectedFormat === "6" ? readClarificationState(storage, z.uuid().parse(id)) : readSharedState(storage, z.uuid().parse(id)); picker.value = id; show(state); }
  picker.addEventListener("change", (): void => {
    const url = new URL(window.location.href);
    url.searchParams.delete("session");
    if (picker.value !== "") url.searchParams.set("session", z.uuid().parse(picker.value));
    window.location.assign(url.href);
  });
  form("shared-create-form").addEventListener("submit", (event: SubmitEvent): void => {
    event.preventDefault();
    action((): void => {
      if (!checked("shared-synthetic")) throw new RangeError("Confirm the synthetic rehearsal boundary before creating records.");
      const next = (selectedFormat === "6" ? createClarificationState : createSharedState)(field("shared-actor").value, { session: crypto.randomUUID(), source: crypto.randomUUID(), event: crypto.randomUUID(), evidence: crypto.randomUUID(), decisions: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()], assumptions: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()] }, new Date().toISOString());
      if (next.schemaVersion === 6) persistClarificationState(storage, null, next);
      else persistSharedState(storage, null, next);
      window.location.assign(urlForSession(new URL(window.location.href), next.id).href);
    });
  });
  form("shared-capture-form").addEventListener("submit", (event: SubmitEvent): void => {
    event.preventDefault();
    action((): void => {
      const value: string = field("shared-time").value;
      if (value === "") throw new RangeError("Enter a synthetic capture time in UTC.");
      const record = current();
      const append = record.schemaVersion === 6 ? appendClarificationEvidence.bind(null, record) : appendSharedEvidence.bind(null, record);
      save(append({ capturedAt: new Date(`${value}Z`).toISOString(), sourceNote: field("shared-note").value, requestedPermissions: permissions("shared-request"), grantedPermissions: permissions("shared-grant"), environment: EnvironmentSchema.parse(field("shared-environment").value) }, crypto.randomUUID(), crypto.randomUUID(), new Date().toISOString()), "One immutable capture appended. Three rules compared. Existing review targets and decisions remain preserved.");
    });
  });
  getElement("shared-trail").addEventListener("click", (event: MouseEvent): void => action((): void => {
    if (!(event.target instanceof Element)) throw new TypeError("Trail interaction requires a DOM element.");
    const button = event.target.closest<HTMLButtonElement>("button[data-trail-kind]");
    if (button === null) return; // Decorative connectors and empty space are not controls.
    inspectSharedNode(current(), { kind: z.enum(["source", "evidence", "assumption", "decision", "review", "outcome"]).parse(button.dataset.trailKind), id: z.uuid().parse(button.dataset.trailId) });
    if (state?.schemaVersion === 6 && button.dataset.trailKind === "review") annotateClarificationReview(state, z.uuid().parse(button.dataset.trailId));
    getElement("shared-inspector").focus();
  }));
  field("shared-review-decision").addEventListener("change", (): void => action((): void => { form("shared-outcome-form").reset(); refreshReview(); }));
  getElement("shared-open-review").addEventListener("click", (): void => action((): void => {
    const record = current(), decisionId = field("shared-review-decision").value, id = crypto.randomUUID(), now = new Date().toISOString();
    save(record.schemaVersion === 6 ? openClarificationReview(record, decisionId, id, now) : openSharedReview(record, decisionId, id, now), "Assigned review opened with a frozen decision basis and exact evidence references. No outcome was recorded.");
  }));
  field("shared-outcome").addEventListener("change", explainOutcome);
  form("shared-outcome-form").addEventListener("submit", (event: SubmitEvent): void => {
    event.preventDefault();
    action((): void => {
      const value = OutcomeSchema.parse(field("shared-outcome").value);
      const record = current();
      const append = record.schemaVersion === 6 ? appendClarificationOutcome.bind(null, record) : appendSharedOutcome.bind(null, record);
      save(append(field("shared-review-decision").value, { actor: field("shared-reviewer").value, outcome: value, rationale: field("shared-rationale").value, statement: field("shared-statement").value, acceptedPermissions: value === "revise" ? permissions("shared-boundary") : null }, crypto.randomUUID(), new Date().toISOString()), "Outcome appended for this decision only. Shared evidence, other decisions and earlier outcomes remain preserved.");
      form("shared-outcome-form").reset();
      refreshReview();
    });
  });
  getElement("shared-export").addEventListener("click", (): void => action((): void => {
    const record = current(), now = new Date().toISOString(), exported = record.schemaVersion === 6 ? clarificationHistoryExport(record, now) : sharedHistoryExport(record, now);
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" }), url: string = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = `decision-continuity-shared-${record.id}.json`; anchor.click(); URL.revokeObjectURL(url);
    getElement("shared-feedback").textContent = "Validated shared-source JSON downloaded. Browser history stays unchanged. Keep exports outside public repositories.";
  }));
  form("shared-replacement-form").addEventListener("submit", (event: SubmitEvent): void => {
    event.preventDefault();
    action((): void => {
      const record = current();
      if (record.schemaVersion !== 6) throw new RangeError("Explicit replacement requires a new v6 rehearsal; existing v5 histories stay intact.");
      save(replaceClarificationReview(record, field("shared-review-decision").value, { actor: field("replacement-actor").value, rationale: field("replacement-rationale").value }, crypto.randomUUID(), crypto.randomUUID(), new Date().toISOString()), "Replacement and new review preserved atomically. The old question and deferral remain; no decision scope or approval changed.");
      form("shared-replacement-form").reset();
      form("shared-outcome-form").reset();
      refreshReview();
    });
  });
  getElement("clarification-events").addEventListener("click", (event: MouseEvent): void => action((): void => {
    if (!(event.target instanceof Element)) throw new TypeError("Replacement interaction requires a DOM element.");
    const button = event.target.closest<HTMLButtonElement>("button[data-review-id]");
    if (button === null) return;
    const record = current();
    if (record.schemaVersion !== 6) throw new RangeError("Replacement history requires a v6 rehearsal.");
    const id = z.uuid().parse(button.dataset.reviewId);
    inspectSharedNode(record, { kind: "review", id });
    annotateClarificationReview(record, id);
    getElement("shared-inspector").focus();
  }));
  connectRecovery(storage);
} catch (error) {
  if (!(error instanceof Error)) throw error;
  displayError(error);
  for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>("input, button, select, textarea")) control.disabled = true;
  throw error;
} finally {
  finishApplicationLoading();
}
