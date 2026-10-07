import type { ClarificationState } from "./clarification-model.ts";
import type { BasisInspection } from "./decision-basis.ts";
import { decisionBasisAt, decisionBasisEvents } from "./decision-basis.ts";
import { compareDecisionBases } from "./basis-comparison.ts";
import { basisComparisonMarkup } from "./basis-comparison-render.ts";
import { basisCapturesMarkup, basisSnapshotMarkup } from "./decision-basis-render.ts";
import type { BasisColumn } from "./decision-basis-render.ts";
import { basisReceiptContexts } from "./basis-receipts.ts";
import { inspectBasisReference } from "./basis-reference-ui.ts";
import { createComparisonPacket } from "./comparison-packet.ts";
import type { UncertaintyState } from "./uncertainty-model.ts";
import { uncertaintyBasisEvents, uncertaintyBasisAt, compareUncertaintyDecisionBases } from "./uncertainty-basis.ts";
import type { UncertaintyBasisContext } from "./uncertainty-basis.ts";
import { uncertaintyBasisMarkup } from "./uncertainty-basis-render.ts";
import { createUncertaintyComparisonPacket } from "./uncertainty-comparison-packet.ts";
import { escapeHtml, getElement } from "./render.ts";

type Side = "from" | "to";
type BasisWorkspace = ClarificationState | UncertaintyState;

function select(id: string): HTMLSelectElement {
  const element = getElement(id);
  if (!(element instanceof HTMLSelectElement)) throw new TypeError(`${id} must be a native select.`);
  return element;
}
function button(id: string): HTMLButtonElement {
  const element = getElement(id);
  if (!(element instanceof HTMLButtonElement)) throw new TypeError(`${id} must be a native button.`);
  return element;
}
function option(value: string, label: string): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value; element.textContent = label;
  return element;
}
function choices(picker: HTMLSelectElement, options: readonly HTMLOptionElement[], selected: string): void {
  const exists: boolean = options.some((item): boolean => item.value === selected);
  picker.replaceChildren(...options, ...(exists ? [] : [option(selected, `Unavailable selection · ${selected}`)]));
  picker.value = selected;
}
function clearSnapshot(element: HTMLElement): void {
  element.replaceChildren();
  for (const key of ["decisionId", "basisRevision", "knownSourceId", "pendingReviewId", "eventId"]) delete element.dataset[key];
}
function workspaceHistory(state: BasisWorkspace): ClarificationState {
  return state.schemaVersion === 7 ? state.history : state;
}
function workspaceInspection(state: BasisWorkspace, decisionId: string, eventId: string): Readonly<{ inspection: BasisInspection; clarificationContext: UncertaintyBasisContext | null }> {
  if (state.schemaVersion === 7) {
    const inspection = uncertaintyBasisAt(state, decisionId, eventId);
    return { inspection, clarificationContext: inspection.clarificationContext };
  }
  return { inspection: decisionBasisAt(state, decisionId, eventId), clarificationContext: null };
}
function snapshot(state: BasisWorkspace, decisionId: string, eventId: string, side: Side, prefix: BasisColumn): BasisInspection | null {
  const element = getElement(prefix);
  clearSnapshot(element);
  try {
    const perspective = workspaceInspection(state, decisionId, eventId), inspection = perspective.inspection, data = inspection.historical;
    const history = workspaceHistory(state);
    element.dataset.decisionId = data.record.decision.id;
    element.dataset.basisRevision = data.basis?.revision ?? "";
    element.dataset.knownSourceId = data.knownSource.id;
    element.dataset.pendingReviewId = data.pendingReview?.id ?? "";
    element.dataset.eventId = inspection.event?.id ?? "latest";
    const heading = `${side === "from" ? "From" : "To"} · ${inspection.event === null ? "latest recorded state" : `immediately after ${inspection.event.label}`}`;
    element.innerHTML = basisSnapshotMarkup(history, data, prefix, heading, basisReceiptContexts(history, inspection)) + basisCapturesMarkup(history, inspection, prefix) + (perspective.clarificationContext === null ? "" : uncertaintyBasisMarkup(history, perspective.clarificationContext, prefix));
    return inspection;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    element.innerHTML = `<h3>${side === "from" ? "From" : "To"} recorded state unavailable</h3><p id="basis-${side}-error" data-testid="basis-${side}-error">${escapeHtml(error.name)}: ${escapeHtml(error.message)}</p><p>This selected endpoint was not replaced with another perspective. Choose another recorded event. Saved history is unchanged.</p>`;
    return null;
  }
}
function errorMessage(message: string): void {
  const element = getElement("basis-error");
  element.textContent = `${message} Choose another decision or recorded event, or Latest recorded state. This inspection writes nothing.`;
  element.hidden = false;
}

/** Keep both selections in memory and isolate inspection errors from the recording workflow. */
export function connectDecisionBasis(): (next: BasisWorkspace | null) => void {
  const decision = select("basis-decision"), from = select("basis-event"), to = select("basis-compare-event");
  const download = button("basis-export");
  let state: BasisWorkspace | null = null;
  let decisionId: string | null = null;
  let fromEventId: string = "latest", toEventId: string = "latest";

  function render(): void {
    download.disabled = true;
    getElement("basis-packet-status").textContent = "";
    if (state === null || decisionId === null) return;
    getElement("basis-error").hidden = true;
    const differences = getElement("basis-differences");
    differences.replaceChildren();
    clearSnapshot(getElement("basis-historical")); clearSnapshot(getElement("basis-latest"));
    const history = workspaceHistory(state);
    choices(decision, history.originalDecisions.map((record): HTMLOptionElement => option(record.decision.id, record.decision.title)), decisionId);
    try {
      const events = state.schemaVersion === 7 ? uncertaintyBasisEvents(state, decisionId) : decisionBasisEvents(state, decisionId);
      const options = (): readonly HTMLOptionElement[] => [option("latest", "Latest recorded state"), ...events.map((item): HTMLOptionElement => option(item.id, `${item.label} · ${item.recordedAt} · ${item.id.slice(0, 8)}`))];
      choices(from, options(), fromEventId); choices(to, options(), toEventId);
      const fromInspection = snapshot(state, decisionId, fromEventId, "from", "basis-historical");
      const toInspection = snapshot(state, decisionId, toEventId, "to", "basis-latest");
      if (fromInspection === null || toInspection === null) {
        differences.innerHTML = '<p data-testid="basis-comparison-error">Comparison unavailable until both requested endpoints can be reconstructed.</p>';
        getElement("basis-selection-status").textContent = "Comparison unavailable. Each valid requested endpoint remains visible; no unavailable endpoint is substituted. Saved history is unchanged.";
        errorMessage([fromInspection === null ? getElement("basis-from-error").innerText : "", toInspection === null ? getElement("basis-to-error").innerText : ""].filter((message): boolean => message.length > 0).join(" "));
        return;
      }
      const comparison = state.schemaVersion === 7 ? compareUncertaintyDecisionBases(state, decisionId, fromEventId, toEventId) : compareDecisionBases(state, decisionId, fromEventId, toEventId);
      differences.innerHTML = basisComparisonMarkup(comparison);
      download.disabled = false;
      getElement("basis-selection-status").textContent = `Showing the two requested recorded perspectives · ${comparison.direction} comparison. Reference controls open their exact endpoint records. Saved history is unchanged.`;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      differences.innerHTML = `<p data-testid="basis-comparison-error">${escapeHtml(error.name)}: ${escapeHtml(error.message)}</p>`;
      getElement("basis-selection-status").textContent = "This recorded comparison is unavailable. Inspection did not change the saved rehearsal.";
      errorMessage(`${error.name}: ${error.message}`);
    }
  }
  decision.addEventListener("change", (): void => { decisionId = decision.value; render(); });
  from.addEventListener("change", (): void => { fromEventId = from.value; render(); });
  to.addEventListener("change", (): void => { toEventId = to.value; render(); });
  getElement("basis-panel").addEventListener("click", (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest("button[data-basis-ref-id]");
    if (!(control instanceof HTMLButtonElement)) return;
    try { inspectBasisReference(control); }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      errorMessage(`${error.name}: ${error.message}`);
    }
  });
  download.addEventListener("click", (): void => {
    getElement("basis-packet-status").textContent = "";
    try {
      if (state === null || decisionId === null || download.disabled) throw new ReferenceError("Choose a decision and two valid recorded endpoints before exporting their comparison.");
      const now = new Date().toISOString();
      const packet = state.schemaVersion === 7 ? createUncertaintyComparisonPacket(state, decisionId, fromEventId, toEventId, now) : createComparisonPacket(state, decisionId, fromEventId, toEventId, now);
      const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" }), url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = `decision-continuity-comparison-${decisionId}.json`;
      anchor.click(); URL.revokeObjectURL(url);
      getElement("basis-packet-status").textContent = "Selected comparison downloaded as a separate read-only packet. Latest selections are frozen to this exported cut. Open the packet inspector to revalidate its exact records; saved history is unchanged.";
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      download.disabled = true;
      errorMessage(`${error.name}: ${error.message}`);
      getElement("basis-packet-status").textContent = "No comparison packet was downloaded. Resolve the selected endpoint error before exporting again.";
    }
  });
  return (next: BasisWorkspace | null): void => {
    state = next;
    getElement("basis-panel").hidden = next === null;
    if (next === null) { download.disabled = true; getElement("basis-packet-status").textContent = ""; return; }
    if (decisionId === null) {
      const production = workspaceHistory(next).originalDecisions.find((record): boolean => record.assumption.scope === "Production");
      if (production === undefined) {
        errorMessage("ReferenceError: The rehearsal has no Production decision for the initial selection.");
        return;
      }
      decisionId = production.decision.id;
    }
    render();
  };
}
