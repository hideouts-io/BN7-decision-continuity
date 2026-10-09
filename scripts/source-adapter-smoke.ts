import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Browser, Page } from "playwright";
import { z } from "zod";
import { appendClarificationEvidence } from "../src/clarification-model.ts";
import type { ClarificationState } from "../src/clarification-model.ts";
import { clarificationHistoryExport, ClarificationHistoryExportSchema } from "../src/clarification-export.ts";
import { createSharedState } from "../src/shared-model.ts";
import { parseSourceFile, SourceFileArtifactSchema, sourceFileFromEvidence } from "../src/source-file.ts";
import type { SourceFileArtifact } from "../src/source-file.ts";
import { inspectLocalSource, prepareSourceAdapterRequest, recheckSourceAdapterResult, sourceAdapterEvidenceInput, SourceArtifactPinSchema } from "../src/source-adapter.ts";
import type { SourceAdapterRequest, SourceAdapterResult, SourceAdapterWorkspace, SourceArtifactPin } from "../src/source-adapter.ts";
import { basisFixture } from "./basis-smoke.ts";
import { uncertaintyFixture } from "./uncertainty-smoke.ts";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;
type HeldResponse = Readonly<{ handler: Handler; arrived: Promise<void>; disconnected: Promise<void>; release: () => void }>;
type Rehearsal = Readonly<{ state: ClarificationState; artifact: SourceFileArtifact }>;
type StorageBytes = Readonly<{ local: Record<string, string>; session: Record<string, string> }>;

function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function pin(artifact: SourceFileArtifact, bytes: Uint8Array): SourceArtifactPin {
  return SourceArtifactPinSchema.parse({ contractVersion: 1, sourceId: artifact.sourceId, sourceReference: artifact.sourceReference, revision: artifact.revision, sha256: digest(bytes) });
}
function json(response: ServerResponse, bytes: Uint8Array): void { response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "X-Unrelated-Provider-Field": "ignored" }); response.end(bytes); }
function holdResponse(begin: (response: ServerResponse) => void, bytes: Uint8Array): HeldResponse {
  let arrived: () => void = (): void => { throw new ReferenceError("The HTTP arrival barrier is not initialized."); };
  let disconnected: () => void = (): void => { throw new ReferenceError("The HTTP disconnection barrier is not initialized."); };
  const arrival = new Promise<void>((resolve): void => { arrived = resolve; }), closed = new Promise<void>((resolve): void => { disconnected = resolve; });
  let pending: ServerResponse | null = null;
  return {
    arrived: arrival, disconnected: closed,
    handler: (_request, response): void => { assert.equal(pending, null); pending = response; response.once("close", disconnected); begin(response); arrived(); },
    release: (): void => { if (pending === null) throw new ReferenceError("The selected HTTP request did not reach its barrier."); json(pending, bytes); },
  };
}
function failure(result: SourceAdapterResult, code: Extract<SourceAdapterResult, { kind: "failed" }>["code"]): void {
  assert.ok(result.kind === "failed"); assert.equal(result.code, code); assert.match(result.message, /No history was recorded/);
}
async function arrived(held: HeldResponse, pending: Promise<SourceAdapterResult>): Promise<void> {
  await Promise.race([held.arrived, pending.then((result): never => { throw new Error(`HTTP request completed before reaching its test barrier: ${result.kind}.`); })]);
}

/** Actual loopback HTTP with a separately selected fixed byte pin; no mocked fetch, external service or automatic capture. */
export async function checkSourceAdapterContract(): Promise<Rehearsal> {
  const bytes = await readFile(new URL("../fixtures/source-adapter/source-file-v1.json", import.meta.url));
  const fixed = SourceArtifactPinSchema.parse(JSON.parse(await readFile(new URL("../fixtures/source-adapter/pin-v1.json", import.meta.url), "utf8")));
  assert.equal(digest(bytes), fixed.sha256, "The checked-in selected artifact must match its independently preserved byte pin.");
  const artifact = parseSourceFile(bytes.toString("utf8")), state = basisFixture().state, original = JSON.stringify(state);
  const changed = SourceFileArtifactSchema.parse({ ...artifact, revision: "local-r2", sourceUpdatedAt: "2026-10-06T00:00:21.000Z", capturedAt: "2026-10-06T00:00:22.000Z", requestedPermissions: ["documents:read", "documents:write"], environment: "Unknown" });
  const changedBytes = Buffer.from(JSON.stringify(changed)), malformed = Buffer.from("{"), extras = Buffer.from(JSON.stringify({ ...artifact, invented: true }));
  const invalidEncoding = new Uint8Array([0xc3, 0x28]), oversized = Buffer.alloc(8193, 32);
  const atLimit = Buffer.concat([bytes, Buffer.alloc(8192 - bytes.byteLength, 32)]);
  const staleArtifact = SourceFileArtifactSchema.parse({ ...artifact, revision: "local-stale", capturedAt: "2026-10-06T00:00:01.000Z", sourceUpdatedAt: "2026-10-06T00:00:00.000Z" }), staleBytes = Buffer.from(JSON.stringify(staleArtifact));
  const headers = holdResponse((_response): void => {}, bytes), body = holdResponse((response): void => { response.writeHead(200, { "Content-Type": "application/json" }); response.write("{"); }, bytes);
  const cancelled = holdResponse((_response): void => {}, bytes), superseded = holdResponse((_response): void => {}, bytes);
  const cancelledBody = holdResponse((response): void => { response.writeHead(200, { "Content-Type": "application/json" }); response.write("{"); }, bytes);
  const rejectedHeaders = holdResponse((response): void => { response.writeHead(503, { "Content-Type": "application/json" }); response.flushHeaders(); }, bytes);
  const lateFailure = holdResponse((_response): void => {}, bytes), changedHistory = holdResponse((_response): void => {}, bytes);
  const requested: string[] = [], violations: string[] = [];
  const routes = new Map<string, Handler>([
    ["/artifact.json", (_request, response): void => json(response, bytes)], ["/changed.json", (_request, response): void => json(response, changedBytes)],
    ["/malformed.json", (_request, response): void => json(response, malformed)], ["/extra.json", (_request, response): void => json(response, extras)],
    ["/encoding.json", (_request, response): void => json(response, invalidEncoding)],
    ["/at-limit.json", (_request, response): void => json(response, atLimit)],
    ["/status.json", (_request, response): void => { response.writeHead(503, { "Content-Type": "application/json" }); response.end("synthetic body must not appear in diagnostics"); }],
    ["/media.json", (_request, response): void => { response.writeHead(200, { "Content-Type": "text/plain" }); response.end(bytes); }],
    ["/declared-large.json", (_request, response): void => { response.writeHead(200, { "Content-Type": "application/json", "Content-Length": oversized.byteLength }); response.end(oversized); }],
    ["/chunked-large.json", (_request, response): void => { response.writeHead(200, { "Content-Type": "application/json" }); response.write(oversized.subarray(0, 4096)); response.end(oversized.subarray(4096)); }],
    ["/empty.json", (_request, response): void => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(); }],
    ["/network.json", (_request, response): void => { response.destroy(); }],
    ["/truncated.json", (_request, response): void => { response.writeHead(200, { "Content-Type": "application/json", "Content-Length": bytes.byteLength, Connection: "close" }); response.end(bytes.subarray(0, 4)); }],
    ["/stale-candidate.json", (_request, response): void => json(response, staleBytes)],
    ["/headers.json", headers.handler], ["/body.json", body.handler], ["/cancel.json", cancelled.handler], ["/superseded.json", superseded.handler],
    ["/late-failure.json", lateFailure.handler], ["/history.json", changedHistory.handler],
    ["/cancel-body.json", cancelledBody.handler], ["/rejected-headers.json", rejectedHeaders.handler],
  ]);
  const server = createServer((request, response): void => {
    requested.push(request.url ?? "");
    if (request.method !== "GET" || request.headers.authorization !== undefined || request.headers.cookie !== undefined || request.headers.referer !== undefined) violations.push("The transport sent an unauthorized method or private request header.");
    const handler = routes.get(request.url ?? "");
    if (handler === undefined) { response.writeHead(404); response.end(); return; }
    handler(request, response);
  });
  await new Promise<void>((resolve, reject): void => { server.once("error", reject); server.listen(0, "127.0.0.1", (): void => { server.removeListener("error", reject); resolve(); }); });
  try {
    const address = server.address(); if (address === null || typeof address === "string") throw new ReferenceError("The task-owned HTTP server requires its exact allocated loopback port.");
    const base = `http://127.0.0.1:${address.port}`;
    routes.set("/redirect.json", (_request, response): void => { response.writeHead(302, { Location: `${base}/destination.json` }); response.end(); });
    const request = (path: string, current: SourceAdapterWorkspace, selected: SourceArtifactPin): SourceAdapterRequest => prepareSourceAdapterRequest(current, `${base}${path}`, selected, randomUUID(), 2000);
    const read = (selected: SourceAdapterRequest, current: SourceAdapterWorkspace): Promise<SourceAdapterResult> => inspectLocalSource(selected, current, new AbortController().signal);
    const selected = request("/artifact.json", state, fixed), result = await read(selected, state);
    assert.ok(result.kind === "candidate"); assert.equal(result.preview.payloadStatus, "unchanged"); assert.deepEqual(result.preview.artifact, artifact);
    const bounded = await read(request("/at-limit.json", state, { ...fixed, sha256: digest(atLimit) }), state); assert.ok(bounded.kind === "candidate"); assert.deepEqual(bounded.preview.artifact, artifact);
    assert.equal(recheckSourceAdapterResult(result, selected, state, new Date().toISOString()).kind, "candidate");
    const input = sourceAdapterEvidenceInput(result, selected, state, "2026-10-06T00:00:23.000Z");
    assert.equal(JSON.stringify(state), original, "Fetching, previewing and preparing explicit capture input must change no history bytes.");
    const recorded = appendClarificationEvidence(state, input, randomUUID(), randomUUID(), "2026-10-06T00:00:23.000Z");
    assert.equal(recorded.sources.length, state.sources.length + 1); assert.deepEqual(recorded.outcomes, state.outcomes); assert.deepEqual(recorded.reviews, state.reviews);
    const same = await read(request("/artifact.json", recorded, fixed), recorded); assert.ok(same.kind === "unchanged"); assert.equal(same.record.sourceEventId, recorded.sources.at(-1)?.id);
    assert.throws((): void => { sourceAdapterEvidenceInput(same, same.request, recorded, "2026-10-06T00:00:24.000Z"); }, /uncaptured candidate/);
    const nextRequest = request("/changed.json", recorded, pin(changed, changedBytes)), next = await read(nextRequest, recorded);
    assert.ok(next.kind === "candidate"); assert.equal(next.preview.payloadStatus, "changed"); assert.deepEqual(next.preview.changes.requestedRemoved, ["documents:delete"]);
    const later = appendClarificationEvidence(recorded, sourceAdapterEvidenceInput(next, nextRequest, recorded, "2026-10-06T00:00:24.000Z"), randomUUID(), randomUUID(), "2026-10-06T00:00:24.000Z");
    const historical = await read(request("/artifact.json", later, fixed), later); assert.ok(historical.kind === "stale"); assert.equal(historical.code, "historical-revision"); assert.equal(historical.record?.sourceEventId, same.record.sourceEventId);
    const conflict = Buffer.from(JSON.stringify({ ...artifact, environment: "Unknown" })); routes.set("/conflict.json", (_request, response): void => json(response, conflict));
    failure(await read(request("/conflict.json", recorded, { ...fixed, sha256: digest(conflict) }), recorded), "revision-conflict");

    const cases: readonly Readonly<{ path: string; selected: SourceArtifactPin; code: Extract<SourceAdapterResult, { kind: "failed" }>["code"] }>[] = [
      { path: "/artifact.json", selected: { ...fixed, sourceId: randomUUID() }, code: "source-identity" },
      { path: "/artifact.json", selected: { ...fixed, sourceReference: "https://example.org/synthetic/other.json" }, code: "source-identity" },
      { path: "/artifact.json", selected: { ...fixed, revision: "other-revision" }, code: "revision-identity" },
      { path: "/artifact.json", selected: { ...fixed, sha256: "0".repeat(64) }, code: "integrity" },
      { path: "/malformed.json", selected: { ...fixed, sha256: digest(malformed) }, code: "invalid-artifact" },
      { path: "/extra.json", selected: { ...fixed, sha256: digest(extras) }, code: "invalid-artifact" },
      { path: "/encoding.json", selected: { ...fixed, sha256: digest(invalidEncoding) }, code: "encoding" },
      { path: "/status.json", selected: fixed, code: "http-status" }, { path: "/media.json", selected: fixed, code: "media-type" },
      { path: "/redirect.json", selected: fixed, code: "redirect" }, { path: "/declared-large.json", selected: fixed, code: "body-size" },
      { path: "/chunked-large.json", selected: fixed, code: "body-size" }, { path: "/empty.json", selected: { ...fixed, sha256: digest(new Uint8Array()) }, code: "invalid-artifact" },
      { path: "/truncated.json", selected: fixed, code: "body-read" },
      { path: "/network.json", selected: fixed, code: "network" }, { path: "/stale-candidate.json", selected: pin(staleArtifact, staleBytes), code: "invalid-candidate" },
    ];
    for (const item of cases) {
      const before = requested.length, rejected = await read(request(item.path, state, item.selected), state); failure(rejected, item.code);
      assert.equal(requested.length, before + 1, "Failures must not retry or follow redirects.");
      assert.ok(!JSON.stringify(rejected).includes("synthetic body must not appear"));
    }
    assert.equal(requested.includes("/destination.json"), false);
    for (const endpoint of ["https://example.org/artifact.json", `http://localhost:${address.port}/artifact.json`, "http://127.0.0.1/artifact.json", `${base}/artifact.json?token=synthetic`, `${base}/artifact.json#fragment`, `http://synthetic:synthetic@127.0.0.1:${address.port}/artifact.json`]) {
      assert.throws((): void => { prepareSourceAdapterRequest(state, endpoint, fixed, randomUUID(), 2000); }, z.ZodError);
    }
    assert.throws((): void => { SourceArtifactPinSchema.parse({ ...fixed, credentials: "synthetic" }); }, z.ZodError);
    for (const [path, held] of [["/headers.json", headers], ["/body.json", body]] as const) {
      const selected = { ...request(path, state, fixed), timeoutMs: 200 }, pending = read(selected, state); await arrived(held, pending);
      failure(await pending, "timeout"); await held.disconnected;
    }
    const controller = new AbortController(), cancelRequest = request("/cancel.json", state, fixed), cancel = inspectLocalSource(cancelRequest, state, controller.signal);
    await arrived(cancelled, cancel); controller.abort(); failure(await cancel, "cancelled"); await cancelled.disconnected;
    const bodyController = new AbortController(), bodyCancel = inspectLocalSource(request("/cancel-body.json", state, fixed), state, bodyController.signal);
    await arrived(cancelledBody, bodyCancel); bodyController.abort(); failure(await bodyCancel, "cancelled"); await cancelledBody.disconnected;
    const earlyRejection = read(request("/rejected-headers.json", state, fixed), state); await arrived(rejectedHeaders, earlyRejection); failure(await earlyRejection, "http-status"); await rejectedHeaders.disconnected;
    const beforeCancelled = requested.length; failure(await inspectLocalSource(request("/artifact.json", state, fixed), state, controller.signal), "cancelled"); assert.equal(requested.length, beforeCancelled);
    const firstRequest = request("/superseded.json", state, fixed), first = read(firstRequest, state); await arrived(superseded, first);
    const secondRequest = request("/changed.json", state, pin(changed, changedBytes)), second = await read(secondRequest, state); assert.ok(second.kind === "candidate");
    superseded.release(); const obsolete = recheckSourceAdapterResult(await first, secondRequest, state, new Date().toISOString()); assert.ok(obsolete.kind === "stale"); assert.equal(obsolete.code, "superseded-request");
    const oldController = new AbortController(), oldRequest = request("/late-failure.json", state, fixed), old = inspectLocalSource(oldRequest, state, oldController.signal);
    await arrived(lateFailure, old); oldController.abort(); const oldResult = await old; failure(oldResult, "cancelled");
    assert.equal(recheckSourceAdapterResult(oldResult, secondRequest, state, new Date().toISOString()).kind, "stale"); await lateFailure.disconnected;
    assert.equal(recheckSourceAdapterResult(second, secondRequest, state, new Date().toISOString()).kind, "candidate", "A late old failure must not erase a newer candidate.");
    assert.equal(recheckSourceAdapterResult(result, null, state, new Date().toISOString()).kind, "stale");
    assert.equal(recheckSourceAdapterResult(result, { ...selected, pin: { ...fixed, revision: "changed-selection" } }, state, new Date().toISOString()).kind, "stale");
    const historyRequest = request("/history.json", state, fixed), historyPending = read(historyRequest, state); await arrived(changedHistory, historyPending); changedHistory.release();
    const historyResult = recheckSourceAdapterResult(await historyPending, historyRequest, recorded, new Date().toISOString()); assert.ok(historyResult.kind === "stale"); assert.equal(historyResult.code, "history-changed");
    assert.throws((): void => { sourceAdapterEvidenceInput(result, selected, recorded, "2026-10-06T00:00:24.000Z"); }, /uncaptured candidate/);
    const journal = uncertaintyFixture(), journalRequest = request("/artifact.json", journal.initial, fixed), journalResult = await read(journalRequest, journal.initial);
    assert.ok(journalResult.kind === "candidate"); assert.deepEqual(journal.initial.history, journal.required.history);
    const staleJournal = recheckSourceAdapterResult(journalResult, journalRequest, journal.required, new Date().toISOString()); assert.ok(staleJournal.kind === "stale"); assert.equal(staleJournal.code, "history-changed");
    const shared = createSharedState("SIM_BASIS", { session: randomUUID(), source: fixed.sourceId, event: randomUUID(), evidence: randomUUID(), decisions: [randomUUID(), randomUUID(), randomUUID()], assumptions: [randomUUID(), randomUUID(), randomUUID()] }, "2026-10-06T00:00:00.000Z");
    assert.equal((await read(request("/artifact.json", shared, fixed), shared)).kind, "candidate");
    const beforeStale = requested.length; assert.equal((await read(selected, recorded)).kind, "stale"); assert.equal(requested.length, beforeStale);
    assert.equal(JSON.stringify(state), original); assert.deepEqual(violations, []);
    console.log("source_adapter_contract_passed", { exactPin: true, revisionAndFieldSemantics: true, closedValidation: true, realHTTP: true, deadlineAndCancellation: true, streamingLimit: true, supersededResults: true, fullJournalInvalidation: true, v5v6v7: true, noAutomaticWrites: true, authenticatedOrigin: false });
    return { state, artifact: result.preview.artifact };
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve, reject): void => { server.close((error): void => { if (error !== undefined) reject(error); else resolve(); }); });
  }
}

async function ready(page: Page): Promise<void> { await page.locator('html[data-app-ready="true"]').waitFor(); }
async function storage(page: Page): Promise<StorageBytes> { return page.evaluate((): StorageBytes => ({ local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage)) })); }
async function download(page: Page): Promise<string> { const pending = page.waitForEvent("download"); await page.getByTestId("shared-export").click(); return readFile(z.string().parse(await (await pending).path()), "utf8"); }

/** The adapter remains unconnected to product UI; fetched declarations use existing file inspection and separately acknowledged capture. */
export async function checkSourceAdapter(browser: Browser, url: string): Promise<void> {
  const rehearsal = await checkSourceAdapterContract(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); context.setDefaultTimeout(5000);
  try {
    const page = await context.newPage(); await page.goto(`${url}/impact.html?format=6`); await ready(page);
    await page.getByTestId("import-toggle").click();
    await page.getByTestId("import-file").setInputFiles({ name: "synthetic-adapter-history.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(clarificationHistoryExport(rehearsal.state, new Date().toISOString()))) });
    await page.getByTestId("inspect-import").click(); await page.getByTestId("import-preview").waitFor({ state: "visible" }); assert.deepEqual(await storage(page), { local: {}, session: {} });
    const navigating = page.waitForEvent("domcontentloaded"); await page.getByTestId("confirm-import").click(); await navigating; await ready(page);
    const before = await storage(page);
    await page.getByTestId("source-file-file").setInputFiles({ name: "synthetic-fetched-declaration.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(rehearsal.artifact)) });
    await page.getByTestId("source-file-inspect").click(); await page.getByTestId("source-file-preview").waitFor({ state: "visible" });
    assert.deepEqual(await storage(page), before); assert.equal(await page.getByTestId("source-file-confirm").isDisabled(), true);
    await page.getByTestId("source-file-ack").focus(); await page.keyboard.press("Space"); await page.getByTestId("source-file-confirm").focus(); await page.keyboard.press("Enter");
    await page.getByTestId("source-file-preview").waitFor({ state: "hidden" });
    const completed = ClarificationHistoryExportSchema.parse(JSON.parse(await download(page))).session;
    assert.deepEqual(completed.sources.slice(0, -1), rehearsal.state.sources); assert.deepEqual(completed.outcomes, rehearsal.state.outcomes); assert.deepEqual(completed.reviews, rehearsal.state.reviews);
    assert.equal(completed.sources.length, rehearsal.state.sources.length + 1);
    const captured = completed.sources.at(-1); assert.ok(captured !== undefined); assert.deepEqual(sourceFileFromEvidence(captured.evidence), rehearsal.artifact);
    const preserved = await storage(page); await page.reload(); await ready(page); assert.deepEqual(await storage(page), preserved);
    const fresh = await browser.newContext(); fresh.setDefaultTimeout(5000);
    try {
      const restored = await fresh.newPage(), exported = await download(page); await restored.goto(`${url}/impact.html?format=6`); await ready(restored);
      await restored.getByTestId("import-toggle").click(); await restored.getByTestId("import-file").setInputFiles({ name: "synthetic-adapter-complete.json", mimeType: "application/json", buffer: Buffer.from(exported) });
      await restored.getByTestId("inspect-import").click(); await restored.getByTestId("import-preview").waitFor({ state: "visible" }); assert.deepEqual(await storage(restored), { local: {}, session: {} });
      const navigation = restored.waitForEvent("domcontentloaded"); await restored.getByTestId("confirm-import").click(); await navigation; await ready(restored);
      assert.deepEqual(ClarificationHistoryExportSchema.parse(JSON.parse(await download(restored))).session, completed);
    } finally { await fresh.close(); }
    console.log("source_adapter_capture_handoff_passed", { existingFileUI: true, rawStoragePreservedUntilAcknowledgement: true, exactReceipt: true, noAutomaticReviewOrOutcome: true, exportImportReload: true });
  } finally { await context.close(); }
}
