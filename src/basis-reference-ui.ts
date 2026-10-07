import type { BasisColumn } from "./decision-basis-render.ts";
import { getElement } from "./render.ts";

/** Open a preserved reference inside its exact selected endpoint without changing history. */
export function inspectBasisReference(control: HTMLButtonElement): void {
  const side = control.dataset.basisRefSide, kind = control.dataset.basisRefKind, id = control.dataset.basisRefId;
  if ((side !== "from" && side !== "to") || kind === undefined || id === undefined) throw new TypeError("A recorded-basis reference requires its exact endpoint, kind and UUID.");
  const prefix: BasisColumn = side === "from" ? "basis-historical" : "basis-latest", column = getElement(prefix);
  let target: HTMLElement | null;
  if (kind === "decision" || kind === "assumption") {
    target = document.getElementById(`${prefix}-original-${kind}`);
    if (target?.textContent !== id) throw new ReferenceError(`The ${side} endpoint has no matching ${kind} ${id}.`);
  } else if (kind === "review" || kind === "outcome" || kind === "replacement" || kind === "requirement" || kind === "resolution") {
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
