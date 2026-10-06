import { z } from "zod";
import { appPath } from "./app-path.ts";
import { finishApplicationLoading } from "./app-ready.ts";
import { appendAuthoredEvidence, appendAuthoredOutcome, createAuthoredState, openAuthoredReview } from "./authored-model.ts";
import type { AuthoredState } from "./authored-model.ts";
import { listAuthoredIds, persistAuthoredState, readAuthoredState } from "./authored-storage.ts";
import { renderAuthoredState } from "./authored-render.ts";
import { getElement } from "./render.ts";
import { connectRecovery } from "./recovery-ui.ts";
import { authoredHistoryExport } from "./recovery.ts";
import { urlForSession } from "./sessions.ts";
import { OutcomeSchema } from "./scenario.ts";
import type { Permission } from "./scenario.ts";
import { outcomeExplanation } from "./journey.ts";
import { appendContinuityEvidence, appendContinuityOutcome, createContinuityState, openContinuityReview } from "./continuity-model.ts";
import type { ContinuityState, ContinuityPermission } from "./continuity-model.ts";
import { listContinuityIds, persistContinuityState, readContinuityState } from "./continuity-storage.ts";
import { renderContinuityMode, renderContinuityState } from "./continuity-render.ts";
import { continuityHistoryExport } from "./continuity-export.ts";

type DecisionState = AuthoredState | ContinuityState;

function input(id: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const element: HTMLElement = getElement(id);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) throw new TypeError(`${id} must be an input, textarea or select.`);
  return element;
}
function checked(id: string): boolean {
  const element = input(id);
  if (!(element instanceof HTMLInputElement) || element.type !== "checkbox") throw new TypeError(`${id} must be a checkbox.`);
  return element.checked;
}
function permissions(readId: string, writeId: string): Permission[] {
  return [...(checked(readId) ? ["documents:read" as const] : []), ...(checked(writeId) ? ["documents:write" as const] : [])];
}
function continuityPermissions(readId: string, writeId: string, deleteId: string): ContinuityPermission[] {
  return [...permissions(readId, writeId), ...(checked(deleteId) ? ["documents:delete" as const] : [])];
}
function outcomeControls(): void {
  const value: string = input("authored-outcome").value;
  getElement("continuity-boundary").hidden = state?.schemaVersion !== 4 || value !== "revise";
  getElement("authored-outcome-explanation").textContent = outcomeExplanation(value === "" ? "" : OutcomeSchema.parse(value));
}
function captureTime(id: string): string {
  const value: string = input(id).value;
  if (value === "") throw new RangeError("Enter a synthetic capture time in UTC.");
  return new Date(`${value}Z`).toISOString();
}
function displayError(error: Error): void {
  getElement("authored-error").textContent = `${error.name}: ${error.message} No existing history was replaced.`;
  getElement("authored-error").hidden = false;
  getElement("authored-error").scrollIntoView({ block: "center" });
  console.error("decision_continuity_authored_error", { name: error.name, message: error.message });
}
function action(work: () => void): void {
  getElement("authored-error").hidden = true;
  try { work(); } catch (error) {
    if (!(error instanceof Error)) throw error;
    displayError(error);
  }
}

const storage: Storage = window.localStorage;
let state: DecisionState | null = null;
let creationFormat: "3" | "4" = "3";
function currentState(): DecisionState {
  if (state === null) throw new ReferenceError("Create or restore a synthetic decision first.");
  return state;
}
function renderDecision(next: DecisionState): void {
  if (next.schemaVersion === 4) renderContinuityState(next);
  else renderAuthoredState(next);
  input("authored-reviewer").value = next.originalDecision.actor;
}
function save(next: DecisionState, message: string): void {
  if (next.schemaVersion === 4) {
    if (state !== null && state.schemaVersion !== 4) throw new TypeError("A legacy authored session cannot be silently migrated to continuity format.");
    persistContinuityState(storage, state, next);
  } else {
    if (state !== null && state.schemaVersion !== 3) throw new TypeError("Continuity history cannot be replaced with a legacy authored session.");
    persistAuthoredState(storage, state, next);
  }
  state = next;
  renderDecision(next);
  getElement("authored-feedback").textContent = message;
}

connectRecovery(storage);
getElement("authored-create-form").addEventListener("submit", (event: SubmitEvent): void => {
  event.preventDefault();
  action((): void => {
    if (!checked("create-synthetic")) throw new RangeError("Confirm that the material and reviewer code are synthetic.");
    const data = {
      title: input("create-title").value.trim(), statement: input("create-statement").value.trim(), rationale: input("create-rationale").value.trim(), actor: input("create-actor").value.trim(),
      assumption: input("create-assumption").value.trim(), sourceName: input("create-source").value.trim(), capturedAt: captureTime("create-time"), sourceNote: input("create-note").value.trim(),
      grantedPermissions: permissions("create-grant-read", "create-grant-write"),
    };
    const ids = { session: crypto.randomUUID(), decision: crypto.randomUUID(), assumption: crypto.randomUUID(), source: crypto.randomUUID(), event: crypto.randomUUID(), evidence: crypto.randomUUID() };
    const recordedAt: string = new Date().toISOString();
    const next: DecisionState = creationFormat === "4" ? createContinuityState(data, ids, recordedAt) : createAuthoredState(data, ids, recordedAt);
    if (next.schemaVersion === 4) persistContinuityState(storage, null, next);
    else persistAuthoredState(storage, null, next);
    window.location.assign(urlForSession(new URL(window.location.href), next.id).href);
  });
});
getElement("authored-capture-form").addEventListener("submit", (event: SubmitEvent): void => {
  event.preventDefault();
  action((): void => {
    const current: DecisionState = currentState();
    const capture = { capturedAt: captureTime("authored-capture-time"), sourceNote: input("authored-note").value.trim() };
    const eventId: string = crypto.randomUUID();
    const evidenceId: string = crypto.randomUUID();
    const recordedAt: string = new Date().toISOString();
    const next: DecisionState = current.schemaVersion === 4
      ? appendContinuityEvidence(current, { ...capture, requestedPermissions: continuityPermissions("authored-request-read", "authored-request-write", "authored-request-delete"), grantedPermissions: continuityPermissions("authored-grant-read", "authored-grant-write", "authored-grant-delete") }, eventId, evidenceId, recordedAt)
      : appendAuthoredEvidence(current, { ...capture, requestedPermissions: permissions("authored-request-read", "authored-request-write"), grantedPermissions: permissions("authored-grant-read", "authored-grant-write") }, eventId, evidenceId, recordedAt);
    save(next, "Later capture preserved. Follow the dependency before deciding whether to open its review.");
    getElement("authored-impact").scrollIntoView({ block: "center" });
  });
});
getElement("authored-open-review").addEventListener("click", (): void => action((): void => {
  const current: DecisionState = currentState();
  const id: string = crypto.randomUUID();
  const time: string = new Date().toISOString();
  save(current.schemaVersion === 4 ? openContinuityReview(current, id, time) : openAuthoredReview(current, id, time), "Review opened explicitly; no outcome has been recorded.");
  outcomeControls();
  input("authored-outcome").focus();
}));
getElement("authored-outcome").addEventListener("change", outcomeControls);
getElement("authored-review-form").addEventListener("submit", (event: SubmitEvent): void => {
  event.preventDefault();
  action((): void => {
    const current: DecisionState = currentState();
    const data = { actor: input("authored-reviewer").value, outcome: OutcomeSchema.parse(input("authored-outcome").value), rationale: input("authored-rationale").value.trim(), statement: input("authored-statement").value.trim() };
    const id: string = crypto.randomUUID();
    const recordedAt: string = new Date().toISOString();
    save(current.schemaVersion === 4 ? appendContinuityOutcome(current, { ...data, approvedRequestedPermissions: data.outcome === "revise" ? continuityPermissions("boundary-read", "boundary-write", "boundary-delete") : null }, id, recordedAt)
      : appendAuthoredOutcome(current, data, id, recordedAt), "Accountable outcome appended. The original approval and previous outcomes remain intact.");
    input("authored-outcome").value = "";
    input("authored-rationale").value = "";
    input("authored-statement").value = "";
    outcomeControls();
    getElement("authored-history-section").focus();
  });
});
getElement("authored-export").addEventListener("click", (): void => action((): void => {
  const current = currentState();
  const record = current.schemaVersion === 4 ? continuityHistoryExport(current, new Date().toISOString()) : authoredHistoryExport(current, new Date().toISOString());
  const url: string = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
  const link: HTMLAnchorElement = document.createElement("a");
  link.href = url;
  link.download = `decision-continuity-${record.sessionId}.json`;
  link.click();
  URL.revokeObjectURL(url);
}));
getElement("authored-select").addEventListener("change", (): void => action((): void => {
  const id: string = input("authored-select").value;
  if (id === "") window.location.assign(appPath("decisions.html"));
  else {
    const url = new URL(window.location.href);
    url.searchParams.delete("format");
    if (id.startsWith("4:")) url.searchParams.set("format", "4");
    window.location.assign(urlForSession(url, z.uuid().parse(id.startsWith("4:") ? id.slice(2) : id)).href);
  }
}));

try {
  const select = input("authored-select");
  if (!(select instanceof HTMLSelectElement)) throw new TypeError("The saved decision picker must be a select.");
  for (const id of listAuthoredIds(storage)) select.add(new Option(id, id));
  for (const id of listContinuityIds(storage)) select.add(new Option(`Repeated · ${id}`, `4:${id}`));
  const formats: string[] = new URL(window.location.href).searchParams.getAll("format");
  if (formats.length > 1) throw new RangeError("Select exactly one decision format; remove duplicate format parameters.");
  if (formats.length === 1) creationFormat = z.enum(["3", "4"]).parse(formats[0]);
  if (creationFormat === "4") renderContinuityMode();
  const values: string[] = new URL(window.location.href).searchParams.getAll("session");
  if (values.length > 1) throw new RangeError("Select exactly one decision UUID; remove duplicate session parameters.");
  if (values.length === 1) {
    const id: string = z.uuid().parse(values[0]);
    state = creationFormat === "4" ? readContinuityState(storage, id) : readAuthoredState(storage, id);
    select.value = creationFormat === "4" ? `4:${id}` : id;
    renderDecision(state);
  }
  input("create-time").value = new Date().toISOString().slice(0, 16);
  input("authored-capture-time").value = new Date().toISOString().slice(0, 16);
  outcomeControls();
} catch (error) {
  if (!(error instanceof Error)) throw error;
  getElement("creation").hidden = true;
  getElement("authored-workspace").hidden = true;
  displayError(error);
} finally {
  finishApplicationLoading();
}
