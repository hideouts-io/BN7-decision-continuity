import { getElement } from "./render.ts";
import { MAX_IMPORT_BYTES, parseHistoryExport, recoverHistory, recoveryDestination } from "./recovery.ts";
import type { HistoryExport } from "./recovery.ts";
import { urlForSession } from "./sessions.ts";

function importError(error: Error): void {
  const message: HTMLElement = getElement("import-error");
  message.textContent = `${error.name}: ${error.message} No existing history was replaced.`;
  message.hidden = false;
  console.error("decision_continuity_import_error", { name: error.name, message: error.message });
}

/** File reading and preview are read-only; confirmation is the sole persistence boundary. */
export function connectRecovery(storage: Storage): void {
  const form: HTMLElement = getElement("import-form");
  const file: HTMLElement = getElement("import-file");
  const inspect: HTMLElement = getElement("inspect-import");
  const confirm: HTMLElement = getElement("confirm-import");
  if (!(form instanceof HTMLFormElement) || !(file instanceof HTMLInputElement)
    || !(inspect instanceof HTMLButtonElement) || !(confirm instanceof HTMLButtonElement)) {
    throw new TypeError("Import controls must be a form, file input, and buttons.");
  }
  const confirmButton: HTMLButtonElement = confirm;
  let pending: HistoryExport | null = null;
  function clearPreview(): void {
    pending = null;
    confirmButton.disabled = true;
    getElement("import-preview").hidden = true;
    getElement("import-error").hidden = true;
  }
  file.addEventListener("change", clearPreview);
  form.addEventListener("submit", async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    clearPreview();
    file.disabled = true;
    inspect.disabled = true;
    try {
      const selected: File | undefined = file.files?.[0];
      if (selected === undefined) throw new TypeError("Choose a Decision Continuity JSON history export before inspecting it.");
      if (selected.size > MAX_IMPORT_BYTES) throw new RangeError("Import exceeds the 1 MiB limit. Choose a smaller Decision Continuity history export.");
      const record: HistoryExport = parseHistoryExport(await selected.text());
      const destination = recoveryDestination(storage, record);
      const exists: boolean = storage.getItem(destination.storageKey) !== null;
      getElement("import-summary").textContent = [
        `Session: ${record.sessionId}. Format: export v${record.exportSchemaVersion} / session v${record.session.schemaVersion}.`,
        `Exported: ${record.exportedAt}. Original: ${record.exportSchemaVersion === 4 ? record.originalDecisions.map((item): string => item.decision.revision).join(", ") : record.originalDecision.revision}.`,
        `${record.session.sources.length} source events; ${record.exportSchemaVersion === 3 || record.exportSchemaVersion === 4 ? `${record.session.reviews.length} reviews` : record.session.review === null ? "no review" : "one review"}; ${record.session.outcomes.length} outcomes.`,
        `Latest outcome: ${record.session.outcomes.at(-1)?.outcome ?? "none"}.`,
        exists ? "Identical history already exists. Confirmation opens it without rewriting storage." : "Confirmation restores this history locally. Existing sessions remain intact.",
      ].join("\n");
      pending = record;
      getElement("import-preview").hidden = false;
      confirmButton.textContent = exists ? "Open existing session" : "Restore & open session";
      confirmButton.disabled = false;
      confirmButton.focus();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      importError(error);
    } finally {
      file.disabled = false;
      inspect.disabled = false;
    }
  });
  confirmButton.addEventListener("click", (): void => {
    try {
      if (pending === null) throw new ReferenceError("Inspect an export before confirming recovery.");
      const destination = recoverHistory(storage, pending);
      const url: URL = new URL(window.location.href);
      url.pathname = pending.exportSchemaVersion === 4 ? "/impact.html" : pending.exportSchemaVersion === 1 ? "/" : "/decisions.html";
      url.searchParams.delete("format");
      if (pending.exportSchemaVersion === 3) url.searchParams.set("format", "4");
      window.location.assign(urlForSession(url, destination.id).href);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      pending = null;
      confirmButton.disabled = true;
      importError(error);
    }
  });
}
