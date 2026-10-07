import { z } from "zod";
import { getElement } from "./render.ts";
import { MAX_SOURCE_FILE_BYTES, createSourceFileTemplate, parseSourceFile, previewSourceFile } from "./source-file.ts";
import type { SourceFileArtifact } from "./source-file.ts";
import type { SharedState } from "./shared-model.ts";
import type { ClarificationState } from "./clarification-model.ts";
import { sourceFileHistoryMarkup, sourceFilePreviewMarkup } from "./source-file-render.ts";

type SourceFileCallbacks = Readonly<{
  current: () => SharedState | ClarificationState | null;
  snapshot: () => string;
  activeStorageKey: () => string | null;
  capture: (artifact: SourceFileArtifact) => void;
  run: (task: () => void) => void;
}>;
type PendingSourceFile = Readonly<{ artifact: SourceFileArtifact; snapshot: string }>;

function input(id: string): HTMLInputElement {
  const element = getElement(id);
  if (!(element instanceof HTMLInputElement)) throw new TypeError(`${id} must be a native input.`);
  return element;
}

function button(id: string): HTMLButtonElement {
  const element = getElement(id);
  if (!(element instanceof HTMLButtonElement)) throw new TypeError(`${id} must be a native button.`);
  return element;
}

function sourceFileError(error: Error): void {
  const message = getElement("source-file-error");
  const explanation = error instanceof z.ZodError
    ? `Source-file v1 validation failed: ${error.issues.slice(0, 3).map((issue): string => `${issue.path.join(".") || "artifact"}: ${issue.message}`).join("; ").slice(0, 600)}. Correct these fields using the downloaded synthetic template.`
    : error instanceof SyntaxError ? "The source file is not valid JSON. Correct its syntax and inspect it again."
    : error instanceof DOMException && error.name === "NotReadableError" ? "The selected file could not be read. Check that it remains available locally and choose it again."
    : `${error.name}: ${error.message.slice(0, 600)}`;
  message.textContent = `${explanation} Existing records were not replaced. Inspect the preserved history before retrying a failed capture.`;
  message.hidden = false;
}

/** Candidate state stays in memory. File reading, preview and template download never persist history. */
export function connectSourceFile(callbacks: SourceFileCallbacks): () => void {
  const form = getElement("source-file-form");
  if (!(form instanceof HTMLFormElement)) throw new TypeError("source-file-form must be a native form.");
  const file = input("source-file-file"), acknowledgement = input("source-file-ack");
  const inspect = button("source-file-inspect"), confirm = button("source-file-confirm"), template = button("source-file-template");
  let pending: PendingSourceFile | null = null;
  let generation = 0;
  let busy = false;
  let available = false;
  let externalChange = false;

  function clearPreview(): void {
    generation += 1;
    pending = null;
    acknowledgement.checked = false;
    acknowledgement.disabled = true;
    confirm.disabled = true;
    getElement("source-file-preview").hidden = true;
    getElement("source-file-preview-content").replaceChildren();
  }

  function controls(): void {
    file.disabled = !available || busy;
    inspect.disabled = !available || busy;
    template.disabled = !available || busy;
    acknowledgement.disabled = !available || busy || pending === null;
    confirm.disabled = !available || busy || pending === null || !acknowledgement.checked;
  }

  function current(): SharedState | ClarificationState {
    const state = callbacks.current();
    if (state === null) throw new ReferenceError("Create or restore a shared-source rehearsal before inspecting a source file.");
    if (externalChange) throw new RangeError("This history changed in another tab. Reload the workspace before inspecting or capturing a source file; the previous preview is stale.");
    if (!available) throw new RangeError("Source-file intake is unavailable for this history. Inspect the local error and preserve an export before resolving any malformed source-file receipts.");
    return state;
  }

  function localAction(work: () => void): void {
    callbacks.run((): void => {
      getElement("source-file-error").hidden = true;
      try { work(); } catch (error) {
        if (!(error instanceof Error)) throw error;
        clearPreview(); controls(); sourceFileError(error);
        getElement("source-file-status").textContent = "The source-file action failed. Read the local error and inspect preserved history before trying another candidate.";
      }
    });
  }

  function refresh(): void {
    const hadCandidate = pending !== null;
    clearPreview();
    getElement("source-file-error").hidden = true;
    const state = callbacks.current();
    available = false;
    if (state === null) {
      getElement("source-file-history").replaceChildren();
      getElement("source-file-status").textContent = "Create or restore a shared-source rehearsal to inspect a synthetic file. Nothing is uploaded or saved during inspection.";
    } else if (externalChange) {
      getElement("source-file-status").textContent = "This history changed in another tab. Reload the workspace before inspecting or capturing a source file. The previous candidate was discarded; no automatic refresh or capture occurred.";
      sourceFileError(new RangeError("This history changed in another tab. Reload the workspace before inspecting or capturing a source file; the previous preview is stale."));
    } else {
      try {
        getElement("source-file-history").innerHTML = sourceFileHistoryMarkup(state);
        available = true;
        getElement("source-file-status").textContent = hadCandidate
          ? "The workspace changed, so the inspected candidate and acknowledgement were cleared. Inspect the file again before any capture."
          : "Choose a synthetic source file or download a template for this exact source. Inspection compares only; confirmation appends one capture separately.";
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        getElement("source-file-history").replaceChildren();
        getElement("source-file-status").textContent = "A preserved marked source-file receipt cannot satisfy the intake contract. Intake is disabled. Ordinary history inspection, export and review remain separate.";
        sourceFileError(error);
      }
    }
    controls();
  }

  file.addEventListener("change", (): void => {
    clearPreview(); getElement("source-file-error").hidden = true;
    getElement("source-file-status").textContent = "File selection changed. Inspect the selected file before acknowledging and capturing it.";
    controls();
  });
  acknowledgement.addEventListener("change", controls);
  form.addEventListener("submit", async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    clearPreview(); getElement("source-file-error").hidden = true;
    const selectedGeneration = generation;
    busy = true; controls();
    try {
      const state = current(), snapshot = callbacks.snapshot();
      const selected = file.files?.[0];
      if (selected === undefined) throw new ReferenceError("Choose a synthetic source-file JSON artifact before inspecting it.");
      if (selected.size > MAX_SOURCE_FILE_BYTES) throw new RangeError("The source file exceeds the 8 KiB limit. Use the bounded synthetic source-file template; this input does not accept a history export.");
      const artifact = parseSourceFile(await selected.text());
      if (generation !== selectedGeneration || callbacks.snapshot() !== snapshot || externalChange) throw new RangeError("The workspace changed while reading this file. Reload after an external change, or inspect the file again against the current saved basis. No stale candidate was retained.");
      const checkedAt = new Date().toISOString();
      const preview = previewSourceFile(state, artifact, checkedAt);
      pending = { artifact, snapshot };
      getElement("source-file-preview-content").innerHTML = sourceFilePreviewMarkup(preview, state, checkedAt);
      getElement("source-file-preview").hidden = false;
      getElement("source-file-status").textContent = "Candidate inspected locally. Nothing has been captured. Review exact changes and prospective decision impacts, then acknowledge synthetic use before explicitly appending it.";
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      clearPreview(); sourceFileError(error);
      getElement("source-file-status").textContent = "No candidate is ready for capture. Correct the local error, then inspect the file again; reload first if this workspace changed in another tab.";
    } finally {
      busy = false; controls();
    }
  });
  confirm.addEventListener("click", (): void => localAction((): void => {
    const state = current(), candidate = pending;
    if (candidate === null) throw new ReferenceError("Inspect a synthetic source file before confirming capture.");
    if (!acknowledgement.checked) throw new RangeError("Confirm that this candidate is synthetic and contains no confidential information before capture.");
    if (callbacks.snapshot() !== candidate.snapshot) throw new RangeError("The workspace changed after inspection. Inspect the file again before capturing it; no stale capture was saved.");
    previewSourceFile(state, candidate.artifact, new Date().toISOString());
    callbacks.capture(candidate.artifact);
    clearPreview(); controls();
    getElement("source-file-status").textContent = "Source-file capture appended with its complete declared receipt and exact evidence references. No review, approval or human outcome was created automatically.";
    getElement("source-file-status").focus({ preventScroll: true });
  }));
  template.addEventListener("click", (): void => localAction((): void => {
    const state = current(), artifact = createSourceFileTemplate(state, new Date().toISOString());
    const url = URL.createObjectURL(new Blob([JSON.stringify(artifact, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `decision-continuity-synthetic-source-${state.source.id}.json`; anchor.click(); URL.revokeObjectURL(url);
    getElement("source-file-status").textContent = "A synthetic source-file template was downloaded for this source. It copies the latest declared fields and creates no evidence record. Edit the file locally, then inspect it.";
  }));
  window.addEventListener("storage", (event: StorageEvent): void => {
    const key = callbacks.activeStorageKey();
    if (event.storageArea !== window.localStorage || key === null || event.key !== null && event.key !== key) return;
    externalChange = true;
    refresh();
  });
  return refresh;
}
