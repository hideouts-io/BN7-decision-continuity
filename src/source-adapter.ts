import { z } from "zod";
import { ClarificationStateSchema } from "./clarification-model.ts";
import type { ClarificationState } from "./clarification-model.ts";
import { MAX_IMPORT_BYTES } from "./history-contract.ts";
import { SharedStateSchema } from "./shared-model.ts";
import type { SharedEvidenceInput, SharedState } from "./shared-model.ts";
import { MAX_SOURCE_FILE_BYTES, parseSourceFile, previewSourceFile, SourceFileArtifactSchema, sourceFileArtifacts, sourceFileEvidenceInput, sourceFileReceipt } from "./source-file.ts";
import type { SourceFileArtifact, SourceFilePreview, SourceFileRecord } from "./source-file.ts";
import { UncertaintyStateSchema } from "./uncertainty-model.ts";
import type { UncertaintyState } from "./uncertainty-model.ts";

/** The declaration reference is an identity, never a fetch address. SHA-256 pins selected bytes, not authentic origin. */
export const SourceArtifactPinSchema = z.strictObject({
  contractVersion: z.literal(1), sourceId: SourceFileArtifactSchema.shape.sourceId,
  sourceReference: SourceFileArtifactSchema.shape.sourceReference, revision: SourceFileArtifactSchema.shape.revision,
  sha256: z.string().regex(/^[a-f0-9]{64}$/, "Select the exact lowercase SHA-256 of the synthetic artifact bytes."),
});
const EndpointSchema = z.string().min(1).max(512).refine((value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port !== "" && Number(url.port) > 0
      && url.username === "" && url.password === "" && !value.includes("?") && !value.includes("#") && url.href === value;
  } catch (error) { if (error instanceof TypeError) return false; throw error; }
}, "Use a canonical http://127.0.0.1 URL with an explicit port and no credentials, query or fragment; live sources are not enabled.");
export const SourceAdapterRequestSchema = z.strictObject({
  requestId: z.uuid(), endpoint: EndpointSchema, pin: SourceArtifactPinSchema,
  timeoutMs: z.int().min(25).max(30_000),
  historySnapshot: z.string().min(1).refine((value: string): boolean => new TextEncoder().encode(value).byteLength <= MAX_IMPORT_BYTES, "The temporary history snapshot exceeds the existing 1 MiB boundary."),
});
export type SourceArtifactPin = z.infer<typeof SourceArtifactPinSchema>;
export type SourceAdapterRequest = Readonly<z.infer<typeof SourceAdapterRequestSchema>>;
export type SourceAdapterWorkspace = SharedState | ClarificationState | UncertaintyState;
type FailureCode = "cancelled" | "timeout" | "network" | "http-status" | "redirect" | "media-type" | "body-size" | "body-unavailable" | "body-read" | "encoding" | "integrity" | "invalid-artifact" | "source-identity" | "revision-identity" | "revision-conflict" | "invalid-candidate";
type Failure = Readonly<{ kind: "failed"; request: SourceAdapterRequest; code: FailureCode; message: string; httpStatus: number | null; cause: Error | null }>;
type Stale = Readonly<{ kind: "stale"; request: SourceAdapterRequest; code: "superseded-request" | "history-changed" | "historical-revision"; message: string; record: SourceFileRecord | null }>;
export type SourceAdapterResult = Failure | Stale
  | Readonly<{ kind: "candidate"; request: SourceAdapterRequest; preview: SourceFilePreview }>
  | Readonly<{ kind: "unchanged"; request: SourceAdapterRequest; record: SourceFileRecord }>;

function workspace(state: SourceAdapterWorkspace): SourceAdapterWorkspace {
  if (state.schemaVersion === 7) return UncertaintyStateSchema.parse(state);
  return state.schemaVersion === 6 ? ClarificationStateSchema.parse(state) : SharedStateSchema.parse(state);
}
function history(state: SourceAdapterWorkspace): SharedState | ClarificationState { return state.schemaVersion === 7 ? state.history : state; }
function snapshot(state: SourceAdapterWorkspace): string { return JSON.stringify(workspace(state)); }
function failed(request: SourceAdapterRequest, code: FailureCode, message: string, httpStatus: number | null, cause: Error | null): Failure {
  return { kind: "failed", request, code, message: `Source request ${request.requestId}: ${message} No history was recorded.`, httpStatus, cause };
}
function stale(request: SourceAdapterRequest, code: Stale["code"], message: string, record: SourceFileRecord | null): Stale {
  return { kind: "stale", request, code, message: `Source request ${request.requestId}: ${message} Select and inspect a current pin before explicit capture.`, record };
}

/** Pure preparation: each new selection/request requires a fresh caller-supplied UUID. Full v7 journal context stays local. */
export function prepareSourceAdapterRequest(state: SourceAdapterWorkspace, endpoint: string, pin: SourceArtifactPin, requestId: string, timeoutMs: number): SourceAdapterRequest {
  return SourceAdapterRequestSchema.parse({ requestId, endpoint, pin, timeoutMs, historySnapshot: snapshot(state) });
}

function compareArtifact(request: SourceAdapterRequest, state: SourceAdapterWorkspace, artifact: SourceFileArtifact, checkedAt: string): SourceAdapterResult {
  if (artifact.sourceId !== request.pin.sourceId || artifact.sourceReference !== request.pin.sourceReference || artifact.sourceId !== history(state).source.id) {
    return failed(request, "source-identity", "The artifact does not match the selected source UUID/reference and workspace. Select that workspace's exact synthetic source.", 200, null);
  }
  if (artifact.revision !== request.pin.revision) return failed(request, "revision-identity", "The artifact revision differs from the selected opaque revision. Select its exact pin; no newer revision was substituted.", 200, null);
  try {
    const current = history(state), records = sourceFileArtifacts(current), record = records.find((item): boolean => item.artifact.revision === artifact.revision);
    if (record !== undefined) {
      if (sourceFileReceipt(record.artifact) !== sourceFileReceipt(artifact)) return failed(request, "revision-conflict", "This revision conflicts with its preserved declaration. Inspect the original receipt and correct the selected source artifact.", 200, null);
      if (record.sourceEventId !== current.sources.at(-1)?.id) return stale(request, "historical-revision", "This exact revision is historical, rather than the latest known capture.", record);
      return { kind: "unchanged", request, record };
    }
    return { kind: "candidate", request, preview: previewSourceFile(current, artifact, checkedAt) };
  } catch (error) {
    if (!(error instanceof z.ZodError || error instanceof RangeError || error instanceof ReferenceError)) throw error;
    return failed(request, "invalid-candidate", "The candidate or preserved receipt stream cannot satisfy existing source-file chronology/consistency rules. Inspect the preserved history and correct the declaration before capture.", 200, error);
  }
}

/** A stale success or failure cannot promote/clear a newer request. Call before displaying a result and again before capture. */
export function recheckSourceAdapterResult(result: SourceAdapterResult, activeRequest: SourceAdapterRequest | null, state: SourceAdapterWorkspace, checkedAt: string): SourceAdapterResult {
  z.iso.datetime().parse(checkedAt);
  if (activeRequest === null || JSON.stringify(SourceAdapterRequestSchema.parse(activeRequest)) !== JSON.stringify(result.request)) return stale(result.request, "superseded-request", "The request was cancelled, replaced or its selected pin changed.", null);
  if (result.request.historySnapshot !== snapshot(state)) return stale(result.request, "history-changed", "The workspace or its evidence-requirement journal changed during inspection.", null);
  return result.kind === "candidate" ? compareArtifact(result.request, state, result.preview.artifact, checkedAt) : result;
}

/** GET only from the selected local rehearsal endpoint. No retries, credentials, redirects, source-reference fetch or persistence. */
export async function inspectLocalSource(request: SourceAdapterRequest, state: SourceAdapterWorkspace, signal: AbortSignal): Promise<SourceAdapterResult> {
  const selected = SourceAdapterRequestSchema.parse(request), current = workspace(state);
  if (selected.historySnapshot !== snapshot(current)) return stale(selected, "history-changed", "The workspace changed before this request started.", null);
  const deadline = new AbortController(), combined = AbortSignal.any([signal, deadline.signal]);
  const timer = setTimeout((): void => { deadline.abort(); }, selected.timeoutMs);
  let httpStatus: number | null = null;
  function aborted(cause: Error | null): Failure | null {
    if (signal.aborted) return failed(selected, "cancelled", "Inspection was explicitly cancelled. Start a new request if needed.", httpStatus, cause);
    if (deadline.signal.aborted) return failed(selected, "timeout", `The selected endpoint exceeded the total ${selected.timeoutMs} ms deadline. Check the local server before starting a new request.`, httpStatus, cause);
    return null;
  }
  try {
    const initial = aborted(null); if (initial !== null) return initial;
    let response: Response;
    try {
      response = await fetch(selected.endpoint, { method: "GET", credentials: "omit", redirect: "manual", cache: "no-store", referrerPolicy: "no-referrer", headers: { Accept: "application/json" }, signal: combined });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return aborted(error) ?? failed(selected, "network", "The local HTTP request failed. Check the selected loopback server and port; no retry was attempted.", null, error);
    }
    httpStatus = response.status;
    if (response.status >= 300 && response.status < 400) return failed(selected, "redirect", `HTTP ${response.status} redirects are unsupported. Select the exact local artifact endpoint; the destination was not followed.`, response.status, null);
    if (response.status !== 200) return failed(selected, "http-status", `HTTP ${response.status} cannot provide the selected artifact. Correct the local endpoint before another request.`, response.status, null);
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get("content-type") ?? "")) return failed(selected, "media-type", "The response must declare application/json with optional UTF-8 charset. Correct the local server's media type.", response.status, null);
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_SOURCE_FILE_BYTES)) return failed(selected, "body-size", "The declared body exceeds the 8 KiB source-file boundary or has an invalid length. Serve a bounded artifact.", response.status, null);
    if (response.body === null) return failed(selected, "body-unavailable", "The response has no readable artifact body. Serve the selected JSON bytes.", response.status, null);
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_SOURCE_FILE_BYTES) return failed(selected, "body-size", "The streamed body exceeded the 8 KiB source-file boundary. Serve a bounded artifact; nothing was truncated.", response.status, null);
        chunks.push(chunk.value);
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return aborted(error) ?? failed(selected, "body-read", "The selected body could not be read completely. Correct the local response before a new request.", response.status, error);
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((value): string => value.toString(16).padStart(2, "0")).join("");
    const cancelled = aborted(null); if (cancelled !== null) return cancelled;
    if (digest !== selected.pin.sha256) return failed(selected, "integrity", "Response bytes differ from the selected SHA-256 pin. Verify the artifact/pin; no substitute or conditional cache response was accepted.", response.status, null);
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return failed(selected, "encoding", "The selected bytes are not valid UTF-8. Correct the artifact encoding.", response.status, error);
    }
    let artifact: SourceFileArtifact;
    try { artifact = parseSourceFile(content); } catch (error) {
      if (!(error instanceof z.ZodError || error instanceof SyntaxError || error instanceof RangeError)) throw error;
      return failed(selected, "invalid-artifact", "The response is not a valid closed synthetic source-file v1 artifact. Correct its schema/declarations using the existing source-file contract.", response.status, error);
    }
    return compareArtifact(selected, current, artifact, new Date().toISOString());
  } finally { clearTimeout(timer); deadline.abort(); }
}

/** Pure handoff at a separately acknowledged capture boundary; this returns input and never appends or saves history. */
export function sourceAdapterEvidenceInput(result: SourceAdapterResult, activeRequest: SourceAdapterRequest | null, state: SourceAdapterWorkspace, recordedAt: string): SharedEvidenceInput {
  const current = recheckSourceAdapterResult(result, activeRequest, state, recordedAt);
  if (current.kind !== "candidate") throw new RangeError(`Source adapter has no current uncaptured candidate (${current.kind}). Inspect a current pin and acknowledge it separately before capture.`);
  return sourceFileEvidenceInput(history(state), current.preview.artifact, recordedAt);
}
