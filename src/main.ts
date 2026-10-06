import { EvidenceInputSchema, ReviewInputSchema, openReview, recordEvidenceVersion, recordOutcome, selectEvidence } from "./model.ts";
import type { DemoState } from "./model.ts";
import { OutcomeSchema, PermissionSchema } from "./scenario.ts";
import type { EvidenceId, Permission } from "./scenario.ts";
import { announce, getElement, renderOutcomeExplanation, renderState, showError } from "./render.ts";
import { writeState } from "./storage.ts";
import { LEGACY_SESSION_ID, SESSION_STORAGE_PREFIX, SessionIdSchema, createSession, createVersionSession, listSessions, readSessionState, sessionFromUrl, urlForSession } from "./sessions.ts";
import type { DemoSession } from "./sessions.ts";
import { journeyForState } from "./journey.ts";
import { historyExport } from "./recovery.ts";
import { connectRecovery } from "./recovery-ui.ts";

/** Commit local storage before displaying a successful action. */
function persistAndRender(storage: Storage, session: DemoSession, state: DemoState, message: string): void {
  writeState(storage, session.storageKey, state);
  renderState(state);
  announce(message);
}

function chooseEvidence(storage: Storage, session: DemoSession, evidenceId: EvidenceId): void {
  const state: DemoState = selectEvidence(readSessionState(storage, session), evidenceId, crypto.randomUUID(), new Date().toISOString());
  persistAndRender(storage, session, state, `${evidenceId} selected. ${journeyForState(state).status}. The original decision and earlier history remain intact.`);
}

function permissionInput(id: string): HTMLInputElement {
  const element: HTMLElement = getElement(id);
  if (!(element instanceof HTMLInputElement) || element.type !== "checkbox") throw new TypeError(`#${id} must be a permission checkbox.`);
  return element;
}

function selectedPermissions(prefix: string): Permission[] {
  return [permissionInput(`${prefix}-read`), permissionInput(`${prefix}-write`)]
    .filter((input: HTMLInputElement): boolean => input.checked)
    .map((input: HTMLInputElement): Permission => PermissionSchema.parse(input.value));
}

function validatePermissionSelection(prefix: string): void {
  permissionInput(`${prefix}-read`).setCustomValidity(selectedPermissions(prefix).length === 0
    ? `Select at least one ${prefix === "request" ? "requested permission" : "declared grant"}.` : "");
}

function prepareEvidenceForm(): void {
  const field: HTMLElement = getElement("capture-time");
  if (!(field instanceof HTMLInputElement)) throw new TypeError("#capture-time must be a datetime input.");
  field.value = new Date().toISOString().slice(0, 16);
  field.max = field.value;
  validatePermissionSelection("request");
  validatePermissionSelection("grant");
}

function submitEvidence(storage: Storage, session: DemoSession, event: SubmitEvent): void {
  event.preventDefault();
  const input = EvidenceInputSchema.parse({
    capturedAt: new Date(`${fieldValue("capture-time")}Z`).toISOString(),
    requestedPermissions: selectedPermissions("request"), grantedPermissions: selectedPermissions("grant"),
    sourceNote: fieldValue("source-note"),
  });
  const state: DemoState = recordEvidenceVersion(readSessionState(storage, session), input, crypto.randomUUID(), new Date().toISOString());
  persistAndRender(storage, session, state, "EV-004 recorded and selected. Its synthetic source note and immutable snapshot are preserved; a person must open any suggested review.");
  getElement("evidence").focus({ preventScroll: true });
  getElement("source-current").scrollIntoView({ behavior: "instant", block: "start" });
}

function openHumanReview(storage: Storage, session: DemoSession): void {
  persistAndRender(storage, session, openReview(readSessionState(storage, session), new Date().toISOString()), "REV-001 opened and assigned to the synthetic reviewer. Record your own outcome and rationale.");
  getElement("outcome").focus();
}

function fieldValue(id: string): string {
  const field: HTMLElement = getElement(id);
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) {
    throw new TypeError(`#${id} must be a form input, select, or textarea.`);
  }
  return field.value;
}

function validateNarrative(id: string, description: string): void {
  const field: HTMLElement = getElement(id);
  if (!(field instanceof HTMLTextAreaElement)) throw new TypeError(`#${id} must be a textarea.`);
  field.setCustomValidity(field.value.trim().length < 16 ? `${description} needs at least 16 non-space characters.` : "");
}

function submitOutcome(storage: Storage, session: DemoSession, event: SubmitEvent): void {
  event.preventDefault();
  const form: HTMLElement = getElement("review-form");
  if (!(form instanceof HTMLFormElement)) throw new TypeError("#review-form must be a form.");
  const input = ReviewInputSchema.parse({
    actor: fieldValue("reviewer"), outcome: fieldValue("outcome"),
    rationale: fieldValue("rationale"), statement: fieldValue("decision-text"),
  });
  persistAndRender(storage, session, recordOutcome(readSessionState(storage, session), input, crypto.randomUUID(), new Date().toISOString()), "Human outcome recorded with rationale and reviewed evidence versions. The original decision remains in history.");
  form.reset();
  renderOutcomeExplanation("");
  getElement("history").focus();
  getElement("history").scrollIntoView({ behavior: "instant", block: "start" });
}

/** Export the local session with its fixed original basis; no network request is made. */
function exportHistory(storage: Storage, session: DemoSession): void {
  const exportedAt: string = new Date().toISOString();
  const content: string = JSON.stringify(historyExport(session.id, readSessionState(storage, session), exportedAt), null, 2);
  const url: string = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link: HTMLAnchorElement = document.createElement("a");
  link.href = url;
  link.download = `decision-continuity-${session.id}-${exportedAt.replaceAll(":", "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
  announce("Synthetic decision history exported locally. Nothing was sent to a service.");
}

function renderSessions(storage: Storage, current: DemoSession): void {
  const select: HTMLElement = getElement("session-select");
  if (!(select instanceof HTMLSelectElement)) throw new TypeError("#session-select must be a select.");
  const options: HTMLOptionElement[] = listSessions(storage).map((session: DemoSession): HTMLOptionElement => {
    const option: HTMLOptionElement = document.createElement("option");
    option.value = session.id;
    option.textContent = session.id === LEGACY_SESSION_ID ? "Existing demo" : `Session ${session.id.slice(0, 8)}`;
    return option;
  });
  select.replaceChildren(...options);
  select.value = current.id;
  const state: DemoState = readSessionState(storage, current);
  getElement("session-id").textContent = `${current.id === LEGACY_SESSION_ID ? "Existing demo" : current.id} · ${state.schemaVersion === 2 ? "version entry" : "preset walkthrough"} · synthetic`;
}

function startFreshSession(storage: Storage): void {
  const session: DemoSession = createSession(storage, crypto.randomUUID());
  window.location.assign(urlForSession(new URL(window.location.href), session.id).href);
}

function startVersionSession(storage: Storage): void {
  const session: DemoSession = createVersionSession(storage, crypto.randomUUID());
  const url: URL = urlForSession(new URL(window.location.href), session.id);
  url.hash = "evidence";
  window.location.assign(url.href);
}

function resumeSession(): void {
  const id = SessionIdSchema.parse(fieldValue("session-select"));
  window.location.assign(urlForSession(new URL(window.location.href), id).href);
}

/** Fragment navigation moves focus and scroll only; it never selects evidence or records an outcome. */
function navigateSection(event: MouseEvent): void {
  const link: EventTarget | null = event.currentTarget;
  if (!(link instanceof HTMLAnchorElement)) throw new TypeError("Section navigation must originate from an anchor.");
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target: HTMLElement = getElement(link.hash.slice(1));
  event.preventDefault();
  window.history.replaceState(null, "", link.href);
  target.focus({ preventScroll: true });
  target.scrollIntoView({ behavior: "instant", block: "start" });
}

function explainOutcome(): void {
  const selected: string = fieldValue("outcome");
  renderOutcomeExplanation(selected === "" ? "" : OutcomeSchema.parse(selected));
}

function startApplication(storage: Storage, session: DemoSession): void {
  connectRecovery(storage);
  renderState(readSessionState(storage, session));
  renderSessions(storage, session);
  prepareEvidenceForm();
  explainOutcome();
  for (const link of document.querySelectorAll<HTMLAnchorElement>('main a[href^="#"]')) {
    link.addEventListener("click", navigateSection);
  }
  getElement("new-session").addEventListener("click", (): void => startFreshSession(storage));
  getElement("new-version-session").addEventListener("click", (): void => startVersionSession(storage));
  getElement("session-select").addEventListener("change", resumeSession);
  getElement("load-changed").addEventListener("click", (): void => chooseEvidence(storage, session, "EV-002"));
  getElement("load-control").addEventListener("click", (): void => chooseEvidence(storage, session, "EV-003"));
  getElement("load-authored").addEventListener("click", (): void => chooseEvidence(storage, session, "EV-004"));
  const evidenceForm: HTMLElement = getElement("evidence-form");
  if (!(evidenceForm instanceof HTMLFormElement)) throw new TypeError("#evidence-form must be a form.");
  evidenceForm.addEventListener("submit", (event: SubmitEvent): void => submitEvidence(storage, session, event));
  getElement("source-note").addEventListener("input", (): void => validateNarrative("source-note", "Synthetic source note"));
  for (const prefix of ["request", "grant"]) {
    for (const suffix of ["read", "write"]) permissionInput(`${prefix}-${suffix}`).addEventListener("change", (): void => validatePermissionSelection(prefix));
  }
  getElement("open-review").addEventListener("click", (): void => openHumanReview(storage, session));
  getElement("export-history").addEventListener("click", (): void => exportHistory(storage, session));
  const form: HTMLElement = getElement("review-form");
  if (!(form instanceof HTMLFormElement)) throw new TypeError("#review-form must be a form.");
  form.addEventListener("submit", (event: SubmitEvent): void => submitOutcome(storage, session, event));
  getElement("rationale").addEventListener("input", (): void => validateNarrative("rationale", "Review rationale"));
  getElement("decision-text").addEventListener("input", (): void => validateNarrative("decision-text", "Decision scope or next step"));
  getElement("outcome").addEventListener("change", explainOutcome);
  window.addEventListener("storage", (event: StorageEvent): void => {
    if (event.storageArea !== storage) return;
    if (event.key === session.storageKey || event.key === null) renderState(readSessionState(storage, session));
    if (event.key?.startsWith(SESSION_STORAGE_PREFIX) || event.key === null) renderSessions(storage, session);
  });
}

window.addEventListener("error", (event: ErrorEvent): void => {
  if (!(event.error instanceof Error)) throw new TypeError(`Browser error has no Error object: ${event.message}`);
  showError(event.error);
});

startApplication(window.localStorage, sessionFromUrl(new URL(window.location.href)));
