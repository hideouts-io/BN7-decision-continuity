import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { appendSharedEvidence, appendSharedOutcome, createSharedState, openSharedReview, SharedStateSchema } from "../src/shared-model.ts";
import type { SharedState, SharedCreationIds } from "../src/shared-model.ts";
import { sharedStorageKey } from "../src/shared-storage.ts";
import { createClarificationState, ClarificationStateSchema } from "../src/clarification-model.ts";
import type { ClarificationState } from "../src/clarification-model.ts";
import { clarificationStorageKey } from "../src/clarification-storage.ts";
import { createUncertaintyState, UncertaintyStateSchema } from "../src/uncertainty-model.ts";
import type { UncertaintyState } from "../src/uncertainty-model.ts";
import { uncertaintyStorageKey } from "../src/uncertainty-storage.ts";
import { createSourceFileTemplate, parseSourceFile, previewSourceFile, SourceFileArtifactSchema, sourceFileEvidenceInput, sourceFileFromEvidence, sourceFileReceipt, SOURCE_FILE_PREFIX } from "../src/source-file.ts";
import type { SourceFileArtifact } from "../src/source-file.ts";
import { initialState, initialVersionState } from "../src/model.ts";
import { STORAGE_KEY } from "../src/storage.ts";
import { sessionForId } from "../src/sessions.ts";
import { uncertaintyFixture } from "./uncertainty-smoke.ts";
import { sharedHistoryExport } from "../src/shared-export.ts";
import { createAuthoredState, AuthoredCreationInputSchema } from "../src/authored-model.ts";
import { authoredStorageKey } from "../src/authored-storage.ts";
import { createContinuityState } from "../src/continuity-model.ts";
import { continuityStorageKey } from "../src/continuity-storage.ts";

type Workspace = SharedState | ClarificationState | UncertaintyState;
const actor: string = "SIM_SOURCE";
const fixtureTime: string = "2026-10-06T00:00:00.000Z";

function creationIds(): SharedCreationIds {
  return { session: randomUUID(), source: randomUUID(), event: randomUUID(), evidence: randomUUID(), decisions: [randomUUID(), randomUUID(), randomUUID()], assumptions: [randomUUID(), randomUUID(), randomUUID()] };
}
function history(state: Workspace): SharedState | ClarificationState { return state.schemaVersion === 7 ? state.history : state; }
function key(state: Workspace): string {
  if (state.schemaVersion === 7) return uncertaintyStorageKey(state.id);
  return state.schemaVersion === 6 ? clarificationStorageKey(state.id) : sharedStorageKey(state.id);
}
function workspaceUrl(url: string, state: Workspace): string {
  const target = new URL("impact.html", `${url.replace(/\/$/, "")}/`);
  if (state.schemaVersion !== 5) target.searchParams.set("format", String(state.schemaVersion));
  target.searchParams.set("session", state.id); return target.href;
}
async function ready(page: Page): Promise<void> { await page.locator('html[data-app-ready="true"]').waitFor(); }
async function bytes(page: Page): Promise<Record<string, string>> { return page.evaluate((): Record<string, string> => Object.fromEntries(Object.entries(localStorage))); }
async function saved(page: Page, initial: Workspace): Promise<Workspace> {
  const raw = z.string().parse(await page.evaluate((storageKey: string): string | null => localStorage.getItem(storageKey), key(initial)));
  if (initial.schemaVersion === 7) return UncertaintyStateSchema.parse(JSON.parse(raw));
  return initial.schemaVersion === 6 ? ClarificationStateSchema.parse(JSON.parse(raw)) : SharedStateSchema.parse(JSON.parse(raw));
}
function olderRecords(): readonly [string, string][] {
  const input = AuthoredCreationInputSchema.parse({ title: "Preserved synthetic source intake", statement: "Synthetic read-only decision stays intact while another workspace inspects source files.", rationale: "Synthetic original basis is preserved and proves no practitioner participation or runtime observation.", actor, assumption: "The synthetic manifest request must remain inside its recorded read-only boundary.", sourceName: "Preserved synthetic manifest", capturedAt: fixtureTime, sourceNote: "Synthetic baseline declaration used only to test preservation of older browser storage bytes.", grantedPermissions: ["documents:read"] });
  const ids3 = { session: randomUUID(), source: randomUUID(), event: randomUUID(), evidence: randomUUID(), decision: randomUUID(), assumption: randomUUID() };
  const ids4 = { session: randomUUID(), source: randomUUID(), event: randomUUID(), evidence: randomUUID(), decision: randomUUID(), assumption: randomUUID() };
  const v3 = createAuthoredState(input, ids3, fixtureTime), v4 = createContinuityState(input, ids4, fixtureTime);
  return [[authoredStorageKey(v3.id), JSON.stringify(v3)], [continuityStorageKey(v4.id), JSON.stringify(v4)]];
}
async function seed(page: Page, url: string, state: Workspace, preserved: readonly Workspace[]): Promise<Record<string, string>> {
  await page.goto(url); await ready(page);
  const entries = [
    [STORAGE_KEY, JSON.stringify(initialState())], [sessionForId(randomUUID()).storageKey, JSON.stringify(initialVersionState())],
    ...olderRecords(), ...preserved.map((item): [string, string] => [key(item), JSON.stringify(item)]), [key(state), JSON.stringify(state)],
  ];
  await page.evaluate((records: string[][]): void => { for (const record of records) { const [name, value] = record; if (name === undefined || value === undefined) throw new RangeError("Synthetic storage entry requires its exact key and value."); localStorage.setItem(name, value); } }, entries);
  await page.goto(workspaceUrl(url, state)); await ready(page); return bytes(page);
}
async function upload(page: Page, content: string): Promise<void> {
  await page.getByTestId("source-file-file").setInputFiles({ name: "synthetic-source.json", mimeType: "application/json", buffer: Buffer.from(content) });
  await page.getByTestId("source-file-inspect").click();
}
async function inspectArtifact(page: Page, artifact: SourceFileArtifact): Promise<void> {
  const before = await bytes(page); await upload(page, JSON.stringify(artifact));
  await page.getByTestId("source-file-preview").waitFor({ state: "visible" });
  assert.deepEqual(await bytes(page), before, "Inspecting a source candidate must preserve every storage byte.");
  assert.equal(await page.getByTestId("source-file-confirm").isDisabled(), true, "Successful inspection requires separate human acknowledgment.");
  assert.equal(await page.locator("#source-file-preview img").count(), 0, "Source text must remain escaped during candidate inspection.");
}
async function confirm(page: Page): Promise<void> {
  await page.getByTestId("source-file-ack").focus(); await page.keyboard.press("Space");
  assert.equal(await page.getByTestId("source-file-confirm").isEnabled(), true);
  await page.getByTestId("source-file-confirm").focus(); await page.keyboard.press("Enter");
  await page.getByTestId("source-file-preview").waitFor({ state: "hidden" });
  assert.equal(await page.getByTestId("source-file-status").evaluate((element: HTMLElement): boolean => element === document.activeElement), true);
}
async function download(page: Page, testId: string): Promise<string> {
  const waiting = page.waitForEvent("download"); await page.getByTestId(testId).click();
  return readFile(z.string().parse(await (await waiting).path()), "utf8");
}
async function blocked(page: Page, content: string, message: RegExp): Promise<void> {
  const before = await bytes(page); await upload(page, content);
  await page.getByTestId("source-file-error").waitFor({ state: "visible" });
  assert.match(await page.getByTestId("source-file-error").innerText(), message);
  assert.equal(await page.getByTestId("source-file-confirm").isDisabled(), true);
  assert.deepEqual(await bytes(page), before, "Rejected source candidates must not write or retain an older enabled confirmation.");
}
function nextArtifact(state: Workspace, revision: string): SourceFileArtifact {
  return SourceFileArtifactSchema.parse({ ...createSourceFileTemplate(history(state), new Date().toISOString()), revision, note: "Synthetic offline revision for technical rehearsal only. <img src=x onerror=alert(1)> remains text." });
}
async function manualCapture(page: Page): Promise<void> {
  await page.getByTestId("shared-time").fill(new Date().toISOString().slice(0, -1).replace(/0+$/, "").replace(/\.$/, ""));
  await page.getByTestId("shared-request-read").check(); await page.getByTestId("shared-request-write").check();
  await page.getByTestId("shared-grant-read").check(); await page.getByTestId("shared-environment").selectOption("Unknown");
  await page.getByTestId("shared-note").fill("Synthetic manual declaration tests candidate invalidation; requested and independently declared granted permissions establish no observed runtime activity.");
  await page.getByTestId("shared-capture").click();
}
async function accountableOutcome(page: Page, decisionId: string): Promise<void> {
  await page.getByTestId("shared-review-decision").selectOption(decisionId); await page.getByTestId("shared-open-review").click();
  await page.getByTestId("shared-outcome").selectOption("revise");
  await page.getByTestId("shared-boundary-read").check(); await page.getByTestId("shared-boundary-write").check();
  await page.getByTestId("shared-rationale").fill("Simulated accountable reviewer considers this exact synthetic file capture, accepts a read/write request boundary, and preserves independent grants and unobserved runtime.");
  await page.getByTestId("shared-statement").fill("Synthetic request scope accepts read and write for this exact captured declaration; this grants no real permission and establishes no practitioner participation.");
  await page.getByTestId("shared-record-outcome").focus(); await page.keyboard.press("Enter");
}
async function accessible(page: Page): Promise<void> {
  assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(result.violations.map((item): string => `${item.id}: ${item.nodes.map((node): string => node.target.join(" ")).join(", ")}`), []);
}
async function restore(page: Page, url: string, content: string, completed: Workspace): Promise<void> {
  await page.goto(new URL("impact.html?format=7", `${url.replace(/\/$/, "")}/`).href); await ready(page);
  await page.getByTestId("import-toggle").click();
  await page.getByTestId("import-file").setInputFiles({ name: "source-file-history.json", mimeType: "application/json", buffer: Buffer.from(content) });
  await page.getByTestId("inspect-import").click(); await page.getByTestId("import-preview").waitFor({ state: "visible" });
  assert.deepEqual(await bytes(page), {}, "History inspection in a fresh profile must write nothing.");
  const navigating = page.waitForEvent("domcontentloaded"); await page.getByTestId("confirm-import").click(); await navigating; await ready(page);
  assert.equal(new URL(page.url()).searchParams.get("session"), completed.id); assert.deepEqual(await saved(page, completed), completed);
}

/** Closed file input and preserved receipts are declarations, never source authentication or runtime observations. */
export function checkSourceFileContract(): void {
  const state = createSharedState(actor, creationIds(), fixtureTime), artifact = nextArtifact(state, "contract-r1"), original = JSON.stringify(state);
  assert.deepEqual(parseSourceFile(JSON.stringify(artifact)), artifact);
  const receipt = sourceFileReceipt(artifact); assert.ok(receipt.length <= 1000);
  const baseline = state.sources[0]; assert.ok(baseline !== undefined);
  const captured = { ...baseline.evidence, capturedAt: artifact.capturedAt, sourceNote: receipt, requestedPermissions: artifact.requestedPermissions, grantedPermissions: artifact.grantedPermissions, environment: artifact.environment };
  assert.deepEqual(sourceFileFromEvidence(captured), artifact);
  assert.throws((): void => { sourceFileFromEvidence({ ...captured, environment: "Production" }); }, /receipt|match|environment|declaration/i);
  assert.throws((): void => { parseSourceFile(JSON.stringify({ ...artifact, inventedField: true })); }, z.ZodError);
  assert.throws((): void => { parseSourceFile("{"); }, SyntaxError);
  assert.throws((): void => { parseSourceFile(" ".repeat(8193)); }, /8192|8 KiB|size|limit|large/i);
  const reversed = SourceFileArtifactSchema.parse({ ...artifact, requestedPermissions: ["documents:write", "documents:read"] });
  const ordered = SourceFileArtifactSchema.parse({ ...artifact, requestedPermissions: ["documents:read", "documents:write"] });
  assert.equal(sourceFileReceipt(reversed), sourceFileReceipt(ordered), "Permission order must not change the deterministic receipt for a declaration set.");
  const preview = previewSourceFile(state, artifact, new Date().toISOString()); assert.equal(preview.payloadStatus, "unchanged");
  const captureAt = "2026-10-06T00:00:01.000Z", reviewAt = "2026-10-06T00:00:02.000Z", outcomeAt = "2026-10-06T00:00:03.000Z";
  const changed = SourceFileArtifactSchema.parse({ ...artifact, capturedAt: captureAt, sourceUpdatedAt: captureAt, requestedPermissions: ["documents:read", "documents:write"] });
  const captureState = appendSharedEvidence(state, sourceFileEvidenceInput(state, changed, captureAt), randomUUID(), randomUUID(), captureAt);
  const decision = captureState.originalDecisions[0]; assert.ok(decision !== undefined);
  const reviewed = openSharedReview(captureState, decision.decision.id, randomUUID(), reviewAt);
  const resolved = appendSharedOutcome(reviewed, decision.decision.id, { actor, outcome: "revise", acceptedPermissions: ["documents:read", "documents:write"], statement: "Synthetic request scope accepts read and write; no real access is granted.", rationale: "Synthetic reviewer records this exact declared capture independently of grants and runtime observation." }, randomUUID(), outcomeAt);
  const next = SourceFileArtifactSchema.parse({ ...changed, revision: "contract-r2", capturedAt: reviewAt, sourceUpdatedAt: reviewAt });
  assert.throws((): void => { previewSourceFile(resolved, next, reviewAt); }, /history|later|inspection|time/i);
  assert.equal(JSON.stringify(state), original);
}

/** Exercise actual file selection, readonly comparison, explicit human capture, accountable review and portable history. */
export async function checkSourceFileIntake(browser: Browser, url: string): Promise<void> {
  checkSourceFileContract(); await mkdir("output/playwright", { recursive: true });
  const v5 = createSharedState(actor, creationIds(), fixtureTime), v6 = createClarificationState(actor, creationIds(), fixtureTime);
  const initialV7 = createUncertaintyState(createClarificationState(actor, creationIds(), fixtureTime), randomUUID(), fixtureTime);
  const preserved = [v5, v6, initialV7], errors: Error[] = [], requestedOrigins: string[] = [];
  const expectedOrigin = new URL(url).origin;
  for (const initial of preserved) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); context.setDefaultTimeout(5000);
    const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" }); mobile.setDefaultTimeout(5000);
    try {
      for (const item of [context, mobile]) item.on("request", (request): void => { const target = new URL(request.url()); if (target.protocol === "http:" || target.protocol === "https:") requestedOrigins.push(target.origin); });
      const page = await context.newPage(); page.on("pageerror", (error: Error): void => { errors.push(error); });
      const originalBytes = await seed(page, url, initial, preserved), original = await saved(page, initial);
      const templateBytes = await download(page, "source-file-template"), template = parseSourceFile(templateBytes);
      assert.equal(template.sourceId, history(initial).source.id); assert.deepEqual(await bytes(page), originalBytes);
      await inspectArtifact(page, template);
      assert.equal(await page.getByTestId("source-file-preview-status-0").getAttribute("data-status"), "unchanged");
      assert.equal(await page.getByTestId("source-file-preview-status-1").getAttribute("data-status"), "unchanged");
      assert.equal(await page.getByTestId("source-file-preview-status-2").getAttribute("data-status"), "unresolved");
      await confirm(page); const unchanged = await saved(page, initial);
      assert.equal(history(unchanged).sources.length, history(initial).sources.length + 1);
      assert.deepEqual(history(unchanged).reviews, history(initial).reviews); assert.deepEqual(history(unchanged).outcomes, history(initial).outcomes);
      const unchangedCapture = history(unchanged).sources.at(-1); assert.ok(unchangedCapture !== undefined);
      assert.deepEqual(sourceFileFromEvidence(unchangedCapture.evidence), template);
      await blocked(page, templateBytes, /already|duplicate|revision/i);
      const changed = SourceFileArtifactSchema.parse({ ...nextArtifact(unchanged, "source-r2"), requestedPermissions: ["documents:read", "documents:write"], grantedPermissions: ["documents:read"], environment: "Sandbox" });
      await inspectArtifact(page, changed);
      assert.match(await page.getByTestId("source-file-requested-added").innerText(), /documents:write/);
      assert.equal(await page.getByTestId("source-file-preview-status-0").getAttribute("data-status"), "affected");
      assert.equal(await page.getByTestId("source-file-preview-status-1").getAttribute("data-status"), "unchanged");
      assert.equal(await page.getByTestId("source-file-preview-status-2").getAttribute("data-status"), "unchanged");
      await confirm(page); const capturedState = await saved(page, initial), latest = history(capturedState).sources.at(-1); assert.ok(latest !== undefined);
      assert.deepEqual(sourceFileFromEvidence(latest.evidence), changed);
      assert.equal(await page.locator("#source-file-panel img").count(), 0);
      await page.getByTestId("source-file-history-toggle").click();
      assert.match(await page.getByTestId("source-file-history").innerText(), /Synthetic|Runtime Not observed/); assert.deepEqual(latest.evidence.grantedPermissions, ["documents:read"]);
      assert.equal(latest.evidence.observedActivity, "Not observed"); assert.equal(latest.evidence.provenance, "Synthetic");
      assert.deepEqual(history(capturedState).reviews, history(original).reviews); assert.deepEqual(history(capturedState).outcomes, history(original).outcomes);
      const requestDecision = history(capturedState).originalDecisions[0]; assert.ok(requestDecision !== undefined);
      await accountableOutcome(page, requestDecision.decision.id);
      const reviewedFile = await saved(page, initial), fileReview = history(reviewedFile).reviews.at(-1), fileOutcome = history(reviewedFile).outcomes.at(-1);
      assert.ok(fileReview !== undefined && fileOutcome !== undefined);
      assert.equal(fileReview.evidenceId, latest.evidence.id); assert.equal(fileOutcome.evidenceId, latest.evidence.id);
      assert.equal(fileReview.sourceEventId, latest.id); assert.equal(fileOutcome.sourceEventId, latest.id);
      const currentTime = new Date().toISOString(), valid = SourceFileArtifactSchema.parse({ ...changed, revision: "source-r3", capturedAt: currentTime, sourceUpdatedAt: currentTime });
      const invalid = [
        { content: "{", message: /JSON|syntax|parse|invalid/i },
        { content: JSON.stringify({ ...valid, artifactSchemaVersion: 2 }), message: /artifactSchemaVersion.*expected 1/i },
        { content: JSON.stringify({ ...valid, unknownField: true }), message: /unrecognized.*unknownField/i },
        { content: JSON.stringify({ ...valid, sourceId: randomUUID() }), message: /source|workspace|canonical/i },
        { content: JSON.stringify({ ...valid, sourceReference: "https://user:invalid@example.com/private" }), message: /sourceReference.*without credentials/i },
        { content: JSON.stringify({ ...valid, capturedAt: "2099-01-01T00:00:00.000Z" }), message: /future|capture|time|now/i },
        { content: JSON.stringify({ ...valid, sourceUpdatedAt: fixtureTime }), message: /stale|update|earlier|chronolog/i },
        { content: JSON.stringify({ ...valid, sourceUpdatedAt: fixtureTime, capturedAt: fixtureTime }), message: /stale|capture|earlier|chronolog/i },
        { content: JSON.stringify({ ...valid, revision: changed.revision, requestedPermissions: ["documents:read", "documents:delete"] }), message: /revision|conflict|changed|reuse/i },
        { content: JSON.stringify(changed), message: /revision|duplicate|already/i },
        { content: JSON.stringify({ ...valid, sourceUpdatedAt: changed.sourceUpdatedAt, requestedPermissions: ["documents:read", "documents:delete"] }), message: /update|same|conflict|timestamp|changed/i },
        { content: " ".repeat(8193), message: /8192|8 KiB|size|limit|large/i },
      ];
      for (const test of invalid) { await inspectArtifact(page, valid); await page.getByTestId("source-file-ack").check(); await blocked(page, test.content, test.message); }
      await inspectArtifact(page, valid); await page.getByTestId("source-file-ack").check();
      await page.getByTestId("source-file-file").setInputFiles({ name: "changed-selection.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(valid)) });
      assert.equal(await page.getByTestId("source-file-confirm").isDisabled(), true); assert.equal(await page.getByTestId("source-file-preview").isVisible(), false);
      await inspectArtifact(page, valid); await page.getByTestId("source-file-ack").check(); await manualCapture(page);
      assert.equal(await page.getByTestId("source-file-confirm").isDisabled(), true); assert.equal(await page.getByTestId("source-file-preview").isVisible(), false);
      const newer = await saved(page, initial), staleCandidate = nextArtifact(newer, "stale-tab-candidate");
      await inspectArtifact(page, staleCandidate); await page.getByTestId("source-file-ack").check();
      const other = await context.newPage(); await other.goto(page.url()); await ready(other); await manualCapture(other);
      await page.waitForFunction((): boolean => document.querySelector('[data-testid="source-file-status"]')?.textContent?.includes("another tab") === true);
      assert.match(await page.getByTestId("source-file-status").innerText(), /another tab|reload|changed/i);
      assert.equal(await page.getByTestId("source-file-confirm").isDisabled(), true); assert.deepEqual(await bytes(page), await bytes(other));
      await page.reload(); await ready(page);
      const completed = await saved(page, initial), review = history(completed).reviews.at(-1), outcome = history(completed).outcomes.at(-1);
      assert.ok(review !== undefined && outcome !== undefined); assert.equal(review.evidenceId, outcome.evidenceId); assert.equal(review.sourceEventId, outcome.sourceEventId);
      assert.deepEqual(review, fileReview); assert.deepEqual(outcome, fileOutcome);
      assert.deepEqual(history(completed).sources.slice(0, history(capturedState).sources.length), history(capturedState).sources);
      assert.deepEqual(history(completed).originalDecisions, history(initial).originalDecisions);
      const completeBytes = await bytes(page); for (const [name, value] of Object.entries(originalBytes)) if (name !== key(initial)) assert.equal(completeBytes[name], value);
      const exportContent = await download(page, "shared-export"); await page.reload(); await ready(page); assert.deepEqual(await saved(page, initial), completed); assert.deepEqual(await bytes(page), completeBytes);
      const destination = await mobile.newPage(); destination.on("pageerror", (error: Error): void => { errors.push(error); }); await restore(destination, url, exportContent, completed); await accessible(destination);
      assert.equal(await destination.evaluate((): string => getComputedStyle(document.documentElement).scrollBehavior), "auto");
      assert.equal(await destination.getByTestId("source-file-receipt-0").count(), 1); assert.equal(await destination.locator("#source-file-panel img").count(), 0);
      await inspectArtifact(destination, nextArtifact(completed, "mobile-readonly")); await destination.getByTestId("source-file-artifact-toggle").focus(); await destination.keyboard.press("Enter");
      const mobileBytes = await bytes(destination); await destination.getByTestId("source-file-panel").scrollIntoViewIfNeeded();
      if (initial.schemaVersion === 7) {
        await destination.screenshot({ path: "output/playwright/source-file-mobile.png", animations: "disabled" });
        await page.getByTestId("source-file-panel").screenshot({ path: "output/playwright/source-file-desktop.png", animations: "disabled" });
      }
      assert.deepEqual(await bytes(destination), mobileBytes); await accessible(page);
    } finally { await context.close(); await mobile.close(); }
  }
  await checkJournalInvalidation(browser, url); await checkCorruptReceipt(browser, url);
  assert.deepEqual(errors, []); assert.ok(requestedOrigins.length > 0);
  assert.deepEqual([...new Set(requestedOrigins)], [expectedOrigin], "File references must remain text; no source or external network request is permitted.");
  console.log("source_file_smoke_passed", { formats: [5, 6, 7], template: true, readonlyInspection: true, explicitCapture: true, independentDeclarations: true, invalidInputsRejected: true, stalePreviewRejected: true, frozenHistory: true, portableReceipts: true, olderBytesPreserved: true, keyboard: true, mobile: true, reducedMotion: true, accessibility: true, sourceAuthentication: false, practitionerParticipation: false });
}

/** Journal-only writes change the v7 snapshot even when its embedded v6 source history is unchanged. */
async function checkJournalInvalidation(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); context.setDefaultTimeout(5000);
  try {
    const item = uncertaintyFixture(), page = await context.newPage(); await seed(page, url, item.initial, []);
    await inspectArtifact(page, nextArtifact(item.initial, "requirement-preview")); await page.getByTestId("source-file-ack").check();
    await page.getByTestId("shared-review-decision").selectOption(item.decisionId);
    await page.getByTestId("uncertainty-question").fill("Which deployment context is declared for this exact later synthetic source version?");
    await page.getByTestId("uncertainty-required-evidence").fill("A later canonical source capture must declare Production; requested access, declared grants and unobserved runtime remain separate.");
    await page.getByTestId("uncertainty-trigger-description").fill("When a later capture declares Production, a person should reassess the existing hold in a separate frozen review.");
    await page.getByTestId("uncertainty-add-requirement").click();
    const required = await saved(page, item.initial); assert.equal(required.schemaVersion, 7);
    if (required.schemaVersion !== 7) throw new RangeError("Journal invalidation requires an explicit v7 continuation.");
    assert.equal(required.requirements.length, 1); assert.deepEqual(required.history, item.initial.history);
    assert.equal(await page.getByTestId("source-file-confirm").isDisabled(), true); assert.equal(await page.getByTestId("source-file-preview").isVisible(), false);
    await inspectArtifact(page, nextArtifact(required, "insufficient-later-capture")); await confirm(page);
    const captured = await saved(page, item.initial);
    if (captured.schemaVersion !== 7) throw new RangeError("Source capture must retain its explicit v7 continuation.");
    const requirement = captured.requirements[0], candidate = captured.history.sources.at(-1); assert.ok(requirement !== undefined && candidate !== undefined);
    await inspectArtifact(page, nextArtifact(captured, "resolution-preview")); await page.getByTestId("source-file-ack").check();
    await page.getByTestId("uncertainty-requirement-select").selectOption(requirement.id);
    await page.getByTestId("uncertainty-candidate-select").selectOption(candidate.id);
    await page.getByTestId("uncertainty-result").selectOption("insufficient");
    await page.getByTestId("uncertainty-resolution-rationale").fill("Simulated reviewer records that this exact later Unknown declaration does not answer Production applicability; the question and separate decision hold remain.");
    await page.getByTestId("uncertainty-add-resolution").click();
    const resolved = await saved(page, item.initial);
    if (resolved.schemaVersion !== 7) throw new RangeError("Human evidence response must retain its explicit v7 continuation.");
    assert.equal(resolved.resolutions.length, 1); assert.deepEqual(resolved.history, captured.history);
    assert.equal(await page.getByTestId("source-file-confirm").isDisabled(), true); assert.equal(await page.getByTestId("source-file-preview").isVisible(), false);
    assert.equal(await page.getByTestId("source-file-ack").isChecked(), false);
  } finally { await context.close(); }
}

/** Historical notes retain compatibility, but corrupt reserved receipts cannot authorize more file intake. */
async function checkCorruptReceipt(browser: Browser, url: string): Promise<void> {
  const original = createSharedState(actor, creationIds(), fixtureTime), artifact = nextArtifact(original, "corrupt-receipt-r1"), at = new Date().toISOString();
  const captured = appendSharedEvidence(original, sourceFileEvidenceInput(original, artifact, at), randomUUID(), randomUUID(), at);
  const corrupted = SharedStateSchema.parse({ ...captured, sources: captured.sources.map((event, index: number) => index === 1 ? { ...event, evidence: { ...event.evidence, sourceNote: `${SOURCE_FILE_PREFIX}{` } } : event) });
  const content = JSON.stringify(sharedHistoryExport(corrupted, new Date().toISOString()), null, 2);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); context.setDefaultTimeout(5000);
  try {
    const page = await context.newPage(); await restore(page, url, content, corrupted);
    const before = await bytes(page); assert.deepEqual(await saved(page, corrupted), corrupted);
    await page.getByTestId("source-file-error").waitFor({ state: "visible" });
    assert.match(await page.getByTestId("source-file-status").innerText(), /receipt|disabled|contract/i);
    assert.equal(await page.getByTestId("source-file-file").isDisabled(), true); assert.equal(await page.getByTestId("source-file-inspect").isDisabled(), true);
    assert.equal(await page.getByTestId("source-file-confirm").isDisabled(), true); assert.equal(await page.getByTestId("shared-export").isEnabled(), true);
    assert.deepEqual(await bytes(page), before);
  } finally { await context.close(); }
}
