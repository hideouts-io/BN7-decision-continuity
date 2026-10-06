import { z } from "zod";
import { getElement } from "./render.ts";
import { createSharedState, appendSharedEvidence, openSharedReview, appendSharedOutcome, EnvironmentSchema, sharedBasis, sharedDecision, sharedImpact, sharedPendingReview } from "./shared-model.ts";
import type { SharedState } from "./shared-model.ts";
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
}
const storage: Storage = window.localStorage;
let state: SharedState | null = null;
function current(): SharedState {
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
  explainOutcome();
}
function show(next: SharedState): void {
  renderSharedState(next);
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
function save(next: SharedState, message: string): void {
  persistSharedState(storage, state, next);
  state = next;
  show(next);
  getElement("shared-feedback").textContent = message;
}

try {
  const picker = field("shared-select");
  if (!(picker instanceof HTMLSelectElement)) throw new TypeError("Workspace picker must be a select.");
  for (const id of listSharedIds(storage)) {
    const record = readSharedState(storage, id), option = document.createElement("option");
    option.value = record.id; option.textContent = `${record.source.name} · ${id.slice(0, 8)}`; picker.appendChild(option);
  }
  const id: string | null = new URL(window.location.href).searchParams.get("session");
  if (id !== null) { state = readSharedState(storage, z.uuid().parse(id)); picker.value = id; show(state); }
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
      const next = createSharedState(field("shared-actor").value, { session: crypto.randomUUID(), source: crypto.randomUUID(), event: crypto.randomUUID(), evidence: crypto.randomUUID(), decisions: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()], assumptions: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()] }, new Date().toISOString());
      persistSharedState(storage, null, next);
      window.location.assign(urlForSession(new URL(window.location.href), next.id).href);
    });
  });
  form("shared-capture-form").addEventListener("submit", (event: SubmitEvent): void => {
    event.preventDefault();
    action((): void => {
      const value: string = field("shared-time").value;
      if (value === "") throw new RangeError("Enter a synthetic capture time in UTC.");
      save(appendSharedEvidence(current(), { capturedAt: new Date(`${value}Z`).toISOString(), sourceNote: field("shared-note").value, requestedPermissions: permissions("shared-request"), grantedPermissions: permissions("shared-grant"), environment: EnvironmentSchema.parse(field("shared-environment").value) }, crypto.randomUUID(), crypto.randomUUID(), new Date().toISOString()), "One immutable capture appended. Three rules compared. Existing review targets and decisions remain preserved.");
    });
  });
  getElement("shared-trail").addEventListener("click", (event: MouseEvent): void => action((): void => {
    if (!(event.target instanceof Element)) throw new TypeError("Trail interaction requires a DOM element.");
    const button = event.target.closest<HTMLButtonElement>("button[data-trail-kind]");
    if (button === null) return; // Decorative connectors and empty space are not controls.
    inspectSharedNode(current(), { kind: z.enum(["source", "evidence", "assumption", "decision", "review", "outcome"]).parse(button.dataset.trailKind), id: z.uuid().parse(button.dataset.trailId) });
    getElement("shared-inspector").focus();
  }));
  field("shared-review-decision").addEventListener("change", (): void => action((): void => { form("shared-outcome-form").reset(); refreshReview(); }));
  getElement("shared-open-review").addEventListener("click", (): void => action((): void => {
    save(openSharedReview(current(), field("shared-review-decision").value, crypto.randomUUID(), new Date().toISOString()), "Assigned review opened with a frozen decision basis and exact evidence references. No outcome was recorded.");
  }));
  field("shared-outcome").addEventListener("change", explainOutcome);
  form("shared-outcome-form").addEventListener("submit", (event: SubmitEvent): void => {
    event.preventDefault();
    action((): void => {
      const value = OutcomeSchema.parse(field("shared-outcome").value);
      save(appendSharedOutcome(current(), field("shared-review-decision").value, { actor: field("shared-reviewer").value, outcome: value, rationale: field("shared-rationale").value, statement: field("shared-statement").value, acceptedPermissions: value === "revise" ? permissions("shared-boundary") : null }, crypto.randomUUID(), new Date().toISOString()), "Outcome appended for this decision only. Shared evidence, other decisions and earlier outcomes remain preserved.");
      form("shared-outcome-form").reset();
      refreshReview();
    });
  });
  getElement("shared-export").addEventListener("click", (): void => action((): void => {
    const record = current(), exported = sharedHistoryExport(record, new Date().toISOString());
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" }), url: string = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = `decision-continuity-shared-${record.id}.json`; anchor.click(); URL.revokeObjectURL(url);
    getElement("shared-feedback").textContent = "Validated shared-source JSON downloaded. Browser history stays unchanged. Keep exports outside public repositories.";
  }));
  connectRecovery(storage);
} catch (error) {
  if (!(error instanceof Error)) throw error;
  displayError(error);
  for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>("input, button, select, textarea")) control.disabled = true;
  throw error;
}
