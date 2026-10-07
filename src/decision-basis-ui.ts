import type { ClarificationState } from "./clarification-model.ts";
import type { BasisSnapshot } from "./decision-basis.ts";
import { decisionBasisAt, decisionBasisEvents } from "./decision-basis.ts";
import { basisDifferencesMarkup, basisSnapshotMarkup } from "./decision-basis-render.ts";
import type { BasisColumn } from "./decision-basis-render.ts";
import { getElement } from "./render.ts";

function select(id: string): HTMLSelectElement {
  const element = getElement(id);
  if (!(element instanceof HTMLSelectElement)) throw new TypeError(`${id} must be a native select.`);
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

function snapshot(element: HTMLElement, state: ClarificationState, data: BasisSnapshot, prefix: BasisColumn, heading: string): void {
  element.dataset.decisionId = data.record.decision.id;
  element.dataset.basisRevision = data.basis?.revision ?? "";
  element.dataset.knownSourceId = data.knownSource.id;
  element.dataset.pendingReviewId = data.pendingReview?.id ?? "";
  element.innerHTML = basisSnapshotMarkup(state, data, prefix, heading);
}

function errorMessage(error: Error): void {
  const element = getElement("basis-error");
  element.textContent = `${error.name}: ${error.message} Choose another decision or recorded event, or Latest recorded state. This inspection writes nothing.`;
  element.hidden = false;
}

/** Keep selection in memory and isolate inspection errors from the recording workflow. */
export function connectDecisionBasis(): (next: ClarificationState | null) => void {
  const decision = select("basis-decision"), event = select("basis-event");
  let state: ClarificationState | null = null;
  let decisionId: string | null = null;
  let eventId: string = "latest";

  function render(): void {
    if (state === null || decisionId === null) return;
    getElement("basis-error").hidden = true;
    const historical = getElement("basis-historical"), latest = getElement("basis-latest"), differences = getElement("basis-differences");
    historical.replaceChildren(); latest.replaceChildren(); differences.replaceChildren();
    for (const element of [historical, latest]) {
      delete element.dataset.decisionId; delete element.dataset.basisRevision;
      delete element.dataset.knownSourceId; delete element.dataset.pendingReviewId;
      delete element.dataset.eventId;
    }
    try {
      choices(decision, state.originalDecisions.map((record): HTMLOptionElement => option(record.decision.id, record.decision.title)), decisionId);
      const inspection = decisionBasisAt(state, decisionId, "latest");
      snapshot(latest, state, inspection.latest, "basis-latest", "Latest recorded state");
      const events = decisionBasisEvents(state, decisionId);
      choices(event, [option("latest", "Latest recorded state"), ...events.map((item): HTMLOptionElement => option(item.id, `${item.label} · ${item.recordedAt} · ${item.id.slice(0, 8)}`))], eventId);
      try {
        const selected = decisionBasisAt(state, decisionId, eventId);
        snapshot(historical, state, selected.historical, "basis-historical", selected.event === null ? "Selected state · latest" : `Immediately after: ${selected.event.label}`);
        historical.dataset.eventId = selected.event?.id ?? "latest";
        differences.innerHTML = basisDifferencesMarkup(selected);
        getElement("basis-selection-status").textContent = selected.event === null ? "Showing the latest recorded state in both columns." : `Showing the state immediately after ${selected.event.label}, alongside the latest recorded state.`;
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        delete historical.dataset.eventId;
        historical.innerHTML = "<h3>Selected historical state unavailable</h3><p>This selection cannot be reconstructed from the recorded references and event order. The latest recorded state remains available alongside it.</p>";
        differences.innerHTML = "<h3>Comparison unavailable</h3><p>A historical comparison requires an unambiguous recorded event cut. Choose another event or Latest recorded state.</p>";
        getElement("basis-selection-status").textContent = "The selected historical state is unavailable. The latest recorded state remains visible.";
        errorMessage(error);
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      getElement("basis-selection-status").textContent = "This decision selection is unavailable. Inspection did not change the saved rehearsal.";
      errorMessage(error);
    }
  }

  decision.addEventListener("change", (): void => { decisionId = decision.value; render(); });
  event.addEventListener("change", (): void => { eventId = event.value; render(); });
  return (next: ClarificationState | null): void => {
    state = next;
    getElement("basis-panel").hidden = next === null;
    if (next === null) return;
    if (decisionId === null) {
      const production = next.originalDecisions.find((record): boolean => record.assumption.scope === "Production");
      if (production === undefined) {
        errorMessage(new ReferenceError("The rehearsal has no Production decision for the initial selection."));
        return;
      }
      decisionId = production.decision.id;
    }
    render();
  };
}
