import { RequirementInputSchema, ResolutionInputSchema, eligibleUncertaintyReview, uncertaintyResolutionCandidates, uncertaintyResolutionsForRequirement } from "./uncertainty-model.ts";
import type { UncertaintyState, RequirementInput, ResolutionInput } from "./uncertainty-model.ts";
import { getElement } from "./render.ts";
import { uncertaintyHistoryMarkup, uncertaintyProvenanceMarkup } from "./uncertainty-render.ts";

type UncertaintyCallbacks = Readonly<{
  current: () => UncertaintyState | null;
  appendRequirement: (decisionId: string, input: RequirementInput) => void;
  appendResolution: (requirementId: string, input: ResolutionInput) => void;
  run: (task: () => void) => void;
}>;

function field(id: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const element = getElement(id);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) throw new TypeError(`${id} must be a native form field.`);
  return element;
}

function picker(id: string): HTMLSelectElement {
  const element = getElement(id);
  if (!(element instanceof HTMLSelectElement)) throw new TypeError(`${id} must be a native select.`);
  return element;
}

function form(id: string): HTMLFormElement {
  const element = getElement(id);
  if (!(element instanceof HTMLFormElement)) throw new TypeError(`${id} must be a native form.`);
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

function current(callbacks: UncertaintyCallbacks): UncertaintyState {
  const state = callbacks.current();
  if (state === null) throw new ReferenceError("Create a v7 continuation before recording evidence requirements or human responses.");
  return state;
}

/** Forms collect human explanations; domain transitions validate exact references and eligibility. */
export function connectUncertainty(callbacks: UncertaintyCallbacks): () => void {
  const requirementForm = form("uncertainty-requirement-form"), resolutionForm = form("uncertainty-resolution-form");
  const requirementPicker = picker("uncertainty-requirement-select"), candidatePicker = picker("uncertainty-candidate-select");

  function renderRequirement(state: UncertaintyState): void {
    const selected = picker("shared-review-decision").value;
    const review = selected === "" ? null : eligibleUncertaintyReview(state, selected);
    field("uncertainty-requirement-actor").value = review?.actor ?? "";
    button("uncertainty-add-requirement").disabled = review === null;
    const context = getElement("uncertainty-requirement-context");
    context.textContent = review === null ? "Choose the Production applicability decision in Human review, open its Unknown-context review and record Defer. Each review can have one evidence requirement; an existing requirement remains in the journal." : `Assigned to ${review.actor}. This question stays tied to review ${review.id}, source event ${review.sourceEventId} and evidence ${review.evidenceId}. Its deferral remains unchanged.`;
    context.dataset.reviewId = review?.id ?? "";
  }

  function renderResolution(state: UncertaintyState): void {
    const requirement = state.requirements.find((item): boolean => item.id === requirementPicker.value);
    field("uncertainty-resolution-actor").value = requirement?.actor ?? "";
    const previousCapture = candidatePicker.value;
    const responses = requirement === undefined ? [] : uncertaintyResolutionsForRequirement(state, requirement.id);
    const terminal = responses.at(-1)?.result === "satisfied";
    const candidates = requirement === undefined || terminal ? [] : uncertaintyResolutionCandidates(state, requirement.id);
    candidatePicker.replaceChildren(option("", terminal ? "Requirement already addressed" : "Choose a later capture"), ...candidates.map((capture): HTMLOptionElement => option(capture.id, `Version ${state.history.sources.findIndex((event): boolean => event.id === capture.id) + 1} · ${capture.evidence.environment} · ${capture.id.slice(0, 8)}`)));
    candidatePicker.value = candidates.some((capture): boolean => capture.id === previousCapture) ? previousCapture : "";
    candidatePicker.disabled = requirement === undefined || terminal || candidates.length === 0;
    const capture = candidates.find((event): boolean => event.id === candidatePicker.value);
    button("uncertainty-add-resolution").disabled = requirement === undefined || terminal || capture === undefined;
    const context = getElement("uncertainty-resolution-context");
    if (requirement === undefined) context.textContent = "Record an evidence requirement first. A later capture is needed before a person can respond.";
    else if (terminal) context.textContent = "This declared-context requirement has a preserved satisfied response. No further response can be appended. Inspect the separate review and outcome history for the current decision; addressing this requirement does not record approval.";
    else if (candidates.length === 0) context.textContent = "Append a capture recorded at or after this requirement, newer than its frozen target and any earlier evaluated capture. Unknown or Sandbox evidence can support an insufficient response; Satisfied requires a Production declaration.";
    else if (capture === undefined) context.textContent = "Choose the exact later capture to evaluate. Its declaration supplies no runtime assurance; your rationale remains a separate human assessment.";
    else context.textContent = `Selected source event ${capture.id}, evidence ${capture.evidence.id}. Declares ${capture.evidence.environment}; runtime ${capture.evidence.observedActivity}. Captured ${capture.evidence.capturedAt}; recorded ${capture.recordedAt}. Requested ${capture.evidence.requestedPermissions.join(", ")}; separately declared granted ${capture.evidence.grantedPermissions.join(", ")}.`;
    context.dataset.sourceEventId = capture?.id ?? "";
    context.dataset.evidenceId = capture?.evidence.id ?? "";
    context.dataset.environment = capture?.evidence.environment ?? "";
  }

  function refresh(): void {
    const state = callbacks.current();
    getElement("uncertainty-panel").hidden = state === null;
    getElement("uncertainty-basis-boundary").hidden = state === null;
    if (state === null) return;
    getElement("uncertainty-provenance").innerHTML = uncertaintyProvenanceMarkup(state);
    getElement("uncertainty-history").innerHTML = uncertaintyHistoryMarkup(state);
    renderRequirement(state);
    const previousRequirement = requirementPicker.value;
    requirementPicker.replaceChildren(...(state.requirements.length === 0 ? [option("", "No requirement recorded")] : state.requirements.map((requirement, index: number): HTMLOptionElement => option(requirement.id, `${index + 1}. ${requirement.question}`))));
    requirementPicker.disabled = state.requirements.length === 0;
    if (state.requirements.some((requirement): boolean => requirement.id === previousRequirement)) requirementPicker.value = previousRequirement;
    renderResolution(state);
  }

  requirementPicker.addEventListener("change", (): void => callbacks.run((): void => renderResolution(current(callbacks))));
  candidatePicker.addEventListener("change", (): void => callbacks.run((): void => renderResolution(current(callbacks))));
  requirementForm.addEventListener("submit", (event: SubmitEvent): void => {
    event.preventDefault();
    callbacks.run((): void => {
      const input = RequirementInputSchema.parse({ actor: field("uncertainty-requirement-actor").value, question: field("uncertainty-question").value, requiredEvidence: field("uncertainty-required-evidence").value, triggerDescription: field("uncertainty-trigger-description").value });
      callbacks.appendRequirement(picker("shared-review-decision").value, input);
      requirementForm.reset(); refresh();
    });
  });
  resolutionForm.addEventListener("submit", (event: SubmitEvent): void => {
    event.preventDefault();
    callbacks.run((): void => {
      const input = ResolutionInputSchema.parse({ actor: field("uncertainty-resolution-actor").value, sourceEventId: candidatePicker.value, result: field("uncertainty-result").value, rationale: field("uncertainty-resolution-rationale").value });
      callbacks.appendResolution(requirementPicker.value, input);
      resolutionForm.reset(); refresh();
    });
  });
  return refresh;
}
