import type { ClarificationState } from "./clarification-model.ts";
import type { BasisInspection } from "./decision-basis.ts";
import { decisionBasisAt, decisionBasisEvents } from "./decision-basis.ts";
import { compareDecisionBases } from "./basis-comparison.ts";
import { basisComparisonMarkup } from "./basis-comparison-render.ts";
import { basisCapturesMarkup, basisSnapshotMarkup } from "./decision-basis-render.ts";
import type { BasisColumn } from "./decision-basis-render.ts";
import { basisReceiptContexts } from "./basis-receipts.ts";
import { escapeHtml, getElement } from "./render.ts";

type Side = "from" | "to";

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
function clearSnapshot(element: HTMLElement): void {
  element.replaceChildren();
  for (const key of ["decisionId", "basisRevision", "knownSourceId", "pendingReviewId", "eventId"]) delete element.dataset[key];
}
function snapshot(state: ClarificationState, decisionId: string, eventId: string, side: Side, prefix: BasisColumn): BasisInspection | null {
  const element = getElement(prefix);
  clearSnapshot(element);
  try {
    const inspection = decisionBasisAt(state, decisionId, eventId), data = inspection.historical;
    element.dataset.decisionId = data.record.decision.id;
    element.dataset.basisRevision = data.basis?.revision ?? "";
    element.dataset.knownSourceId = data.knownSource.id;
    element.dataset.pendingReviewId = data.pendingReview?.id ?? "";
    element.dataset.eventId = inspection.event?.id ?? "latest";
    const heading = `${side === "from" ? "From" : "To"} · ${inspection.event === null ? "latest recorded state" : `immediately after ${inspection.event.label}`}`;
    element.innerHTML = basisSnapshotMarkup(state, data, prefix, heading, basisReceiptContexts(state, inspection)) + basisCapturesMarkup(state, inspection, prefix);
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

/** Resolve references only inside their selected endpoint, opening preserved facts for keyboard users. */
function inspectReference(control: HTMLButtonElement): void {
  const side = control.dataset.basisRefSide, kind = control.dataset.basisRefKind, id = control.dataset.basisRefId;
  if ((side !== "from" && side !== "to") || kind === undefined || id === undefined) throw new TypeError("A recorded-basis reference requires its exact endpoint, kind and UUID.");
  const prefix: BasisColumn = side === "from" ? "basis-historical" : "basis-latest", column = getElement(prefix);
  let target: HTMLElement | null;
  if (kind === "decision" || kind === "assumption") {
    target = document.getElementById(`${prefix}-original-${kind}`);
    if (target?.textContent !== id) throw new ReferenceError(`The ${side} endpoint has no matching ${kind} ${id}.`);
  } else if (kind === "review" || kind === "outcome" || kind === "replacement") {
    target = document.getElementById(`${prefix}-${kind}-${id}`);
  } else if (kind === "source" || kind === "source-event" || kind === "evidence") {
    target = column.querySelector<HTMLElement>(`[data-basis-${kind}-id="${CSS.escape(id)}"]`);
  } else throw new TypeError(`Unsupported recorded-basis reference kind: ${kind}.`);
  if (target === null || !column.contains(target)) throw new ReferenceError(`The ${side} endpoint has no inspectable ${kind} ${id}. Choose a valid recorded perspective.`);
  for (let ancestor: HTMLElement | null = target; ancestor !== null && column.contains(ancestor); ancestor = ancestor.parentElement) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
  }
  target.tabIndex = -1;
  target.dataset.basisRefKind = kind; target.dataset.basisRefId = id;
  target.focus({ preventScroll: true }); target.scrollIntoView({ block: "nearest", behavior: "instant" });
}

/** Keep both selections in memory and isolate inspection errors from the recording workflow. */
export function connectDecisionBasis(): (next: ClarificationState | null) => void {
  const decision = select("basis-decision"), from = select("basis-event"), to = select("basis-compare-event");
  let state: ClarificationState | null = null;
  let decisionId: string | null = null;
  let fromEventId: string = "latest", toEventId: string = "latest";

  function render(): void {
    if (state === null || decisionId === null) return;
    getElement("basis-error").hidden = true;
    const differences = getElement("basis-differences");
    differences.replaceChildren();
    clearSnapshot(getElement("basis-historical")); clearSnapshot(getElement("basis-latest"));
    choices(decision, state.originalDecisions.map((record): HTMLOptionElement => option(record.decision.id, record.decision.title)), decisionId);
    try {
      const events = decisionBasisEvents(state, decisionId);
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
      const comparison = compareDecisionBases(state, decisionId, fromEventId, toEventId);
      differences.innerHTML = basisComparisonMarkup(comparison);
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
    try { inspectReference(control); }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      errorMessage(`${error.name}: ${error.message}`);
    }
  });
  return (next: ClarificationState | null): void => {
    state = next;
    getElement("basis-panel").hidden = next === null;
    if (next === null) return;
    if (decisionId === null) {
      const production = next.originalDecisions.find((record): boolean => record.assumption.scope === "Production");
      if (production === undefined) {
        errorMessage("ReferenceError: The rehearsal has no Production decision for the initial selection.");
        return;
      }
      decisionId = production.decision.id;
    }
    render();
  };
}
