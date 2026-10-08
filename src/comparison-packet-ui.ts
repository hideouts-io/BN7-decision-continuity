import { z } from "zod";
import { MAX_COMPARISON_PACKET_BYTES, inspectComparisonPacket } from "./comparison-packet.ts";
import type { ComparisonPacketInspection } from "./comparison-packet.ts";
import type { BasisColumn } from "./decision-basis-render.ts";
import { basisCapturesMarkup, basisSnapshotMarkup } from "./decision-basis-render.ts";
import { basisComparisonMarkup } from "./basis-comparison-render.ts";
import { basisReviewBrief } from "./basis-review-brief.ts";
import { basisReviewBriefMarkup } from "./basis-review-brief-render.ts";
import { comparisonPacketMetadataMarkup } from "./comparison-packet-render.ts";
import { uncertaintyBasisMarkup } from "./uncertainty-basis-render.ts";
import { inspectBasisReference } from "./basis-reference-ui.ts";
import { getElement } from "./render.ts";

function button(id: string): HTMLButtonElement {
  const control = getElement(id);
  if (!(control instanceof HTMLButtonElement)) throw new TypeError(`${id} must be a native button.`);
  return control;
}
function packetError(error: Error): void {
  const detail = error instanceof z.ZodError
    ? `Comparison packet validation failed: ${error.issues.slice(0, 3).map((issue): string => `${issue.path.join(".") || "packet"}: ${issue.message}`).join("; ").slice(0, 600)}. Export a new selected comparison from a valid workspace.`
    : error instanceof SyntaxError ? "The comparison packet is not valid JSON. Choose an intact comparison packet export."
    : error instanceof DOMException && error.name === "NotReadableError" ? "The selected packet could not be read. Check that it remains available locally and choose it again."
    : `${error.name}: ${error.message.slice(0, 600)}`;
  const notice = getElement("packet-error");
  notice.textContent = `${detail} No previous explanation is retained and no browser history was changed.`;
  notice.hidden = false;
}
function renderEndpoint(inspection: ComparisonPacketInspection, side: "from" | "to", prefix: BasisColumn): void {
  const selected = inspection.comparison[side], snapshot = selected.historical, target = getElement(prefix);
  if (inspection.packet[side].selection === "recorded-event" && selected.event === null) throw new ReferenceError(`The ${side} packet endpoint is missing its selected recorded event.`);
  const label = selected.event === null ? "frozen latest within exported cut" : `immediately after ${selected.event.label}`;
  target.dataset.decisionId = snapshot.record.decision.id;
  target.dataset.basisRevision = snapshot.basis?.revision ?? "";
  target.dataset.knownSourceId = snapshot.knownSource.id;
  target.dataset.pendingReviewId = snapshot.pendingReview?.id ?? "";
  target.dataset.eventId = inspection.packet[side].eventId ?? "frozen-latest";
  const context = inspection.comparison.clarificationContexts?.[side] ?? null;
  if (inspection.packet.packetSchemaVersion === 2 && context === null) throw new ReferenceError("A v2 comparison packet requires its exact selected evidence-question and response context.");
  target.innerHTML = basisSnapshotMarkup(inspection.archive, snapshot, prefix, `${side === "from" ? "From" : "To"} · ${label}`, inspection.comparison.receiptContexts[side]) + basisCapturesMarkup(inspection.archive, selected, prefix) + (context === null ? "" : uncertaintyBasisMarkup(inspection.archive, context, prefix));
}

/** Keep imported packets and derived explanations in memory; this route has no operational restore or storage boundary. */
export function connectComparisonPacket(): void {
  const form = getElement("packet-form"), file = getElement("packet-file");
  if (!(form instanceof HTMLFormElement) || !(file instanceof HTMLInputElement) || file.type !== "file") throw new TypeError("Comparison inspection requires its native form and file input.");
  const inspect = button("packet-inspect"), print = button("packet-print"), clear = button("packet-clear"), result = getElement("packet-result");
  let generation = 0;
  let readingGeneration: number | null = null;
  let pending: ComparisonPacketInspection | null = null;
  let printDetails: readonly Readonly<{ element: HTMLDetailsElement; open: boolean }>[] | null = null;

  function controls(): void { inspect.disabled = readingGeneration !== null; print.disabled = readingGeneration !== null || pending === null; }
  function clearResult(): void {
    generation += 1; pending = null; readingGeneration = null;
    result.hidden = true;
    for (const id of ["packet-metadata", "basis-review-brief", "basis-historical", "basis-latest", "basis-differences"]) {
      const element = getElement(id);
      element.replaceChildren();
      for (const key of ["decisionId", "basisRevision", "knownSourceId", "pendingReviewId", "eventId"]) delete element.dataset[key];
    }
    getElement("basis-review-brief").hidden = true;
    controls();
  }
  function render(inspection: ComparisonPacketInspection): void {
    getElement("packet-metadata").innerHTML = comparisonPacketMetadataMarkup(inspection);
    renderEndpoint(inspection, "from", "basis-historical"); renderEndpoint(inspection, "to", "basis-latest");
    getElement("basis-differences").innerHTML = basisComparisonMarkup(inspection.comparison);
    const brief = getElement("basis-review-brief");
    brief.innerHTML = basisReviewBriefMarkup(basisReviewBrief(inspection.comparison)); brief.hidden = false;
    for (const side of ["from", "to"] as const) {
      if (inspection.packet[side].selection !== "frozen-latest") continue;
      const description = getElement(`basis-${side}-cut`).querySelector("p");
      if (!(description instanceof HTMLParagraphElement)) throw new ReferenceError(`The ${side} packet endpoint is missing its exact-cut explanation.`);
      description.textContent = "Frozen latest within exported cut · all included decision-related events. No upstream history was refreshed.";
    }
    pending = inspection; result.hidden = false;
    getElement("packet-status").textContent = "Included records and endpoint references validated locally. The selected comparison was reconstructed in memory. Origin authenticity and upstream completeness remain unverified; nothing was stored or uploaded.";
    result.focus({ preventScroll: true }); result.scrollIntoView({ block: "start", behavior: "instant" });
  }

  file.addEventListener("change", (): void => {
    clearResult(); getElement("packet-error").hidden = true;
    getElement("packet-status").textContent = "File selection changed. Inspect the selected packet; the earlier explanation and print action have been cleared.";
  });
  form.addEventListener("submit", async (event: SubmitEvent): Promise<void> => {
    event.preventDefault(); clearResult(); getElement("packet-error").hidden = true;
    const selectedGeneration = generation, selected = file.files?.[0];
    readingGeneration = selectedGeneration; controls();
    try {
      if (selected === undefined) throw new ReferenceError("Choose a synthetic comparison packet JSON file before inspecting it.");
      if (selected.size > MAX_COMPARISON_PACKET_BYTES) throw new RangeError("The comparison packet exceeds 1 MiB. Export a smaller selected comparison; this inspector does not accept a full operational history.");
      const content = await selected.text();
      if (generation !== selectedGeneration || file.files?.[0] !== selected) return;
      render(inspectComparisonPacket(content));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (generation !== selectedGeneration) return;
      clearResult(); packetError(error);
      getElement("packet-status").textContent = "No comparison is ready. Correct the local error or choose another exported packet, then inspect it again.";
    } finally {
      if (readingGeneration === selectedGeneration) { readingGeneration = null; controls(); }
    }
  });
  clear.addEventListener("click", (): void => {
    clearResult(); file.value = ""; getElement("packet-error").hidden = true;
    getElement("packet-status").textContent = "Inspection cleared from memory. The original file and saved operational histories were unchanged.";
  });
  result.addEventListener("click", (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest("button[data-basis-ref-id]");
    if (!(control instanceof HTMLButtonElement)) return;
    try { inspectBasisReference(control); }
    catch (error) { if (!(error instanceof Error)) throw error; clearResult(); packetError(error); }
  });
  window.addEventListener("beforeprint", (): void => {
    if (pending === null || printDetails !== null) return;
    printDetails = [...result.querySelectorAll<HTMLDetailsElement>("details")].map((element): Readonly<{ element: HTMLDetailsElement; open: boolean }> => ({ element, open: element.open }));
    for (const disclosure of printDetails) disclosure.element.open = true;
  });
  window.addEventListener("afterprint", (): void => {
    if (printDetails === null) return;
    for (const disclosure of printDetails) disclosure.element.open = disclosure.open;
    printDetails = null;
  });
  print.addEventListener("click", (): void => {
    if (pending === null || print.disabled) { packetError(new ReferenceError("Inspect a valid comparison packet before printing its explanation.")); return; }
    window.print();
  });
}
