import type { BasisColumn } from "./decision-basis-render.ts";
import { getElement } from "./render.ts";

type ReferenceTarget = Readonly<{ target: HTMLElement; column: HTMLElement; side: "from" | "to"; kind: string; id: string }>;
type Disclosure = Readonly<{ element: HTMLDetailsElement; open: boolean }>;
type ScrollPosition = Readonly<{ element: HTMLElement; top: number; left: number }>;
type Origin = Readonly<{ control: HTMLButtonElement; disclosures: readonly Disclosure[]; scrolls: readonly ScrollPosition[]; top: number; left: number }>;
export type BasisReferenceNavigation = Readonly<{ inspect: (control: HTMLButtonElement) => void; returnToExplanation: () => void; invalidate: () => void }>;

/** Resolve an exact endpoint before changing disclosures, focus or return state. */
function referenceTarget(control: HTMLButtonElement): ReferenceTarget {
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
  return { target, column, side, kind, id };
}

function openReference(reference: ReferenceTarget): void {
  const { target, column, kind, id } = reference;
  for (let ancestor: HTMLElement | null = target; ancestor !== null && column.contains(ancestor); ancestor = ancestor.parentElement) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
  }
  if (target.closest("[hidden], [inert]") !== null || !target.checkVisibility({ visibilityProperty: true })) throw new ReferenceError("The exact cited endpoint record is hidden or unavailable. Open a valid comparison and inspect its citation again.");
  target.tabIndex = -1;
  target.dataset.basisRefKind = kind; target.dataset.basisRefId = id;
  target.focus({ preventScroll: true });
  if (document.activeElement !== target) throw new ReferenceError("The exact cited endpoint record could not receive keyboard focus. Open a valid comparison and inspect its citation again.");
  target.scrollIntoView({ block: "nearest", behavior: "instant" });
}

function scrollPositions(root: HTMLElement): readonly ScrollPosition[] {
  const elements = new Set<HTMLElement>(root.querySelectorAll<HTMLElement>("*"));
  for (let ancestor: HTMLElement | null = root; ancestor !== null; ancestor = ancestor.parentElement) elements.add(ancestor);
  return [...elements].filter((element): boolean => element !== document.scrollingElement && (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth))
    .map((element): ScrollPosition => ({ element, top: element.scrollTop, left: element.scrollLeft }));
}

/** A single in-memory origin belongs to the current rendered comparison, never a stored record or bookmark. */
export function connectBasisReferenceNavigation(root: HTMLElement): BasisReferenceNavigation {
  let origin: Origin | null = null;
  let toolbar: HTMLElement | null = null;

  function invalidate(): void { toolbar?.remove(); toolbar = null; origin = null; }

  function inspect(control: HTMLButtonElement): void {
    const top = control.getBoundingClientRect().top, left = window.scrollX;
    invalidate();
    if (!control.isConnected || !root.contains(control)) throw new ReferenceError("The cited control is no longer in this comparison. Inspect a current explanation.");
    const explanation = control.closest("#basis-review-brief, #basis-differences, #basis-navigator");
    if (!(explanation instanceof HTMLElement) || !root.contains(explanation)) throw new ReferenceError("The cited record has no supported originating explanation.");
    const reference = referenceTarget(control), { target, column, side, kind, id } = reference;
    if (!root.contains(column)) throw new ReferenceError("The cited endpoint no longer belongs to this comparison.");
    const container = target.matches("article, li") ? target : target.closest("details.basis-block");
    if (!(container instanceof HTMLElement) || !column.contains(container)) throw new ReferenceError("The cited record has no inspectable return-control container.");
    const disclosures = [...root.querySelectorAll<HTMLDetailsElement>("details")].map((element): Disclosure => ({ element, open: element.open }));
    const scrolls = scrollPositions(root);
    const title = explanation.id === "basis-review-brief" ? "comparison brief" : explanation.id === "basis-differences" ? "full explanation" : "event map";
    const bar = document.createElement("div"), button = document.createElement("button"), label = document.createElement("p");
    bar.className = "basis-inspection-return"; bar.dataset.testid = "basis-inspection-return";
    button.type = "button"; button.className = "btn secondary"; button.dataset.testid = "basis-return"; button.dataset.basisReturn = "";
    button.textContent = `← Return to ${title}`;
    label.textContent = `Inspecting ${side === "from" ? "From" : "To"} · ${kind} · ${id}`;
    bar.append(button, label);
    if (container instanceof HTMLDetailsElement) {
      const summary = container.querySelector(":scope > summary");
      if (summary === null) throw new ReferenceError("The cited record disclosure has no native summary for return navigation.");
      summary.after(bar);
    } else container.prepend(bar);
    origin = { control, disclosures, scrolls, top, left }; toolbar = bar;
    openReference(reference);
  }

  function returnToExplanation(): void {
    const saved = origin;
    invalidate();
    if (saved === null) throw new ReferenceError("The originating explanation is no longer available. Inspect a current citation to establish a new return target.");
    if (!saved.control.isConnected || !root.contains(saved.control) || saved.control.disabled || saved.disclosures.some((item): boolean => !item.element.isConnected || !root.contains(item.element))) {
      throw new ReferenceError("The originating explanation changed or was removed. Inspect a citation in the current comparison; no replacement return target was selected.");
    }
    for (const disclosure of saved.disclosures) disclosure.element.open = disclosure.open;
    if (saved.control.closest("[hidden], [inert]") !== null || !saved.control.checkVisibility({ visibilityProperty: true })) throw new ReferenceError("The originating explanation is hidden or unavailable. Open the current comparison and inspect its citation again.");
    saved.control.focus({ preventScroll: true });
    if (document.activeElement !== saved.control) throw new ReferenceError("The originating citation could not receive keyboard focus. Open the current comparison and inspect its citation again.");
    for (const position of saved.scrolls) position.element.scrollTo({ top: position.top, left: position.left, behavior: "instant" });
    window.scrollTo({ top: window.scrollY + saved.control.getBoundingClientRect().top - saved.top, left: saved.left, behavior: "instant" });
  }

  return { inspect, returnToExplanation, invalidate };
}
