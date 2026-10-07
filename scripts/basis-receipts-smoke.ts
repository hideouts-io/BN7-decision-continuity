import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { appendClarificationEvidence, appendClarificationOutcome, createClarificationState, openClarificationReview, ClarificationStateSchema } from "../src/clarification-model.ts";
import type { ClarificationState } from "../src/clarification-model.ts";
import { clarificationStorageKey } from "../src/clarification-storage.ts";
import { clarificationHistoryExport, ClarificationHistoryExportSchema } from "../src/clarification-export.ts";
import { createUncertaintyState } from "../src/uncertainty-model.ts";
import { uncertaintyStorageKey } from "../src/uncertainty-storage.ts";
import { uncertaintyHistoryExport, UncertaintyHistoryExportSchema } from "../src/uncertainty-export.ts";
import { decisionBasisAt } from "../src/decision-basis.ts";
import { compareDecisionBases } from "../src/basis-comparison.ts";
import { basisReceiptContexts, compareReceiptContexts } from "../src/basis-receipts.ts";
import type { BasisReceiptContext, BasisReceiptRole } from "../src/basis-receipts.ts";
import { createSourceFileTemplate, SourceFileArtifactSchema, sourceFileArtifacts, sourceFileEvidenceInput, sourceFileReceipt } from "../src/source-file.ts";
import { ambiguousFixture } from "./basis-smoke.ts";
import type { SharedCreationIds } from "../src/shared-model.ts";

const actor: string = "SIM_RECEIPT";
function time(seconds: number): string { return new Date(Date.parse("2026-10-06T01:00:00.000Z") + seconds * 1000).toISOString(); }
function ids(): SharedCreationIds {
  return { session: randomUUID(), source: randomUUID(), event: randomUUID(), evidence: randomUUID(), decisions: [randomUUID(), randomUUID(), randomUUID()], assumptions: [randomUUID(), randomUUID(), randomUUID()] };
}
export type BasisReceiptsFixture = Readonly<{
  state: ClarificationState; decisionId: string; baselineId: string; firstCaptureId: string; firstEvidenceId: string;
  firstReviewId: string; revisionId: string; secondCaptureId: string; secondEvidenceId: string;
  secondReviewId: string; deferralId: string; manualCaptureId: string;
}>;

/** Two declared receipts, an accountable revision and a later manual capture intentionally diverge in their recorded roles. */
export function basisReceiptsFixture(): BasisReceiptsFixture {
  const creation = ids(), decisionId = creation.decisions[0];
  const baseline = createClarificationState(actor, creation, time(0));
  const firstCaptureId = randomUUID(), firstEvidenceId = randomUUID(), firstReviewId = randomUUID(), revisionId = randomUUID();
  const secondCaptureId = randomUUID(), secondEvidenceId = randomUUID(), secondReviewId = randomUUID(), deferralId = randomUUID(), manualCaptureId = randomUUID();
  const artifact1 = SourceFileArtifactSchema.parse({ ...createSourceFileTemplate(baseline, time(1)), revision: "receipt-R1", sourceUpdatedAt: time(0), capturedAt: time(1), requestedPermissions: ["documents:read", "documents:write"], note: "Synthetic first revision: <img src=x onerror=alert(1)> stays text; independent grants and runtime remain unobserved." });
  const first = appendClarificationEvidence(baseline, sourceFileEvidenceInput(baseline, artifact1, time(2)), firstCaptureId, firstEvidenceId, time(2));
  const reviewed = openClarificationReview(first, decisionId, firstReviewId, time(3));
  const revised = appendClarificationOutcome(reviewed, decisionId, { actor, outcome: "revise", acceptedPermissions: ["documents:read", "documents:write"], statement: "Synthetic request boundary accepts read and write for its exact reviewed capture; runtime remains unobserved.", rationale: "Synthetic reviewer records responsibility and the exact source-file capture, preserving independent declared grants and runtime uncertainty." }, revisionId, time(4));
  const artifact2 = SourceFileArtifactSchema.parse({ ...createSourceFileTemplate(revised, time(5)), revision: "receipt-R2", sourceUpdatedAt: time(5), capturedAt: time(5), requestedPermissions: ["documents:read", "documents:write", "documents:delete"], note: "Synthetic second revision adds a delete request; this later declaration does not replace the earlier supporting receipt." });
  const second = appendClarificationEvidence(revised, sourceFileEvidenceInput(revised, artifact2, time(6)), secondCaptureId, secondEvidenceId, time(6));
  const secondReview = openClarificationReview(second, decisionId, secondReviewId, time(7));
  const deferred = appendClarificationOutcome(secondReview, decisionId, { actor, outcome: "defer", acceptedPermissions: null, statement: "Preserve the synthetic read-write boundary while the exact delete-request capture awaits another accountable outcome.", rationale: "Synthetic deferral retains the second receipt as the frozen review target and does not adopt it as the decision's supporting basis." }, deferralId, time(8));
  const state = appendClarificationEvidence(deferred, { capturedAt: time(9), requestedPermissions: ["documents:read", "documents:write", "documents:delete"], grantedPermissions: ["documents:read"], environment: "Unknown", sourceNote: "A later synthetic manual capture carries no structured source revision or source update-time facts; runtime remains unobserved." }, manualCaptureId, randomUUID(), time(10));
  return { state, decisionId, baselineId: creation.event, firstCaptureId, firstEvidenceId, firstReviewId, revisionId, secondCaptureId, secondEvidenceId, secondReviewId, deferralId, manualCaptureId };
}

function context(items: readonly BasisReceiptContext[], role: BasisReceiptRole): BasisReceiptContext {
  const found = items.find((item): boolean => item.role === role);
  if (found === undefined) throw new ReferenceError(`Receipt inspection must supply its ${role} role.`);
  return found;
}
function at(fixture: BasisReceiptsFixture, eventId: string): readonly BasisReceiptContext[] {
  return basisReceiptContexts(fixture.state, decisionBasisAt(fixture.state, fixture.decisionId, eventId));
}
function withNote(state: ClarificationState, sourceEventId: string, note: string): ClarificationState {
  return ClarificationStateSchema.parse({ ...state, sources: state.sources.map((capture) => capture.id === sourceEventId ? { ...capture, evidence: { ...capture.evidence, sourceNote: note } } : capture) });
}
function withdrawn(fixture: BasisReceiptsFixture): ClarificationState {
  return appendClarificationOutcome(fixture.state, fixture.decisionId, { actor, outcome: "withdraw", acceptedPermissions: null, statement: "Withdraw the synthetic request decision while retaining its original evidence, declarations and recorded outcomes.", rationale: "The assigned synthetic reviewer records withdrawal against the exact pending receipt; later manual evidence is preserved independently." }, randomUUID(), time(11));
}

/** Receipt metadata is endpoint-scoped and capture-validated; it neither authenticates a stream nor rewrites an earlier decision. */
export function checkBasisReceiptsModel(): void {
  const fixture = basisReceiptsFixture(), preserved = JSON.stringify(fixture.state);
  const baseline = at(fixture, fixture.baselineId), pending1 = at(fixture, fixture.firstReviewId), resolved = at(fixture, fixture.revisionId), pending2 = at(fixture, fixture.secondReviewId), latest = at(fixture, "latest");
  assert.deepEqual(baseline.map((item): string => item.status), ["manual", "manual", "absent"]);
  assert.deepEqual(pending1.map((item): string => item.status), ["manual", "declared", "declared"]);
  assert.deepEqual(resolved.map((item): string => item.status), ["declared", "declared", "absent"]);
  assert.deepEqual(pending2.map((item): string => item.status), ["declared", "declared", "declared"]);
  assert.deepEqual(latest.map((item): string => item.status), ["declared", "manual", "declared"]);
  const supporting = context(latest, "support"), known = context(latest, "known"), pending = context(latest, "pending");
  assert.equal(supporting.capture?.id, fixture.firstCaptureId); assert.equal(known.capture?.id, fixture.manualCaptureId); assert.equal(pending.capture?.id, fixture.secondCaptureId);
  if (supporting.status !== "declared" || pending.status !== "declared") throw new TypeError("Declared supporting and frozen-target receipts are required by this fixture.");
  assert.equal(supporting.artifact.revision, "receipt-R1"); assert.equal(pending.artifact.revision, "receipt-R2");
  assert.equal(supporting.artifact.sourceUpdatedAt, time(0)); assert.equal(supporting.artifact.capturedAt, time(1)); assert.equal(supporting.capture.recordedAt, time(2));
  const forward = compareDecisionBases(fixture.state, fixture.decisionId, fixture.revisionId, fixture.secondReviewId);
  const reverse = compareDecisionBases(fixture.state, fixture.decisionId, fixture.secondReviewId, fixture.revisionId);
  assert.deepEqual(forward.receiptContexts.from, resolved); assert.deepEqual(forward.receiptContexts.to, pending2);
  assert.deepEqual(forward.receiptChanges, compareReceiptContexts(resolved, pending2));
  assert.ok(forward.receiptChanges.length > 0);
  for (const fact of forward.receiptChanges) {
    const mirrored = reverse.receiptChanges.find((item): boolean => item.key === fact.key);
    assert.ok(mirrored !== undefined);
    assert.equal(mirrored.fromValue, fact.toValue); assert.equal(mirrored.toValue, fact.fromValue);
    assert.deepEqual(mirrored.fromReferences, fact.toReferences); assert.deepEqual(mirrored.toReferences, fact.fromReferences);
    assert.ok(fact.fromReferences.every((ref): boolean => ref.kind !== "source-event" || forward.from.includedEventIds.includes(ref.id)));
    assert.ok(fact.toReferences.every((ref): boolean => ref.kind !== "source-event" || forward.to.includedEventIds.includes(ref.id)));
  }
  assert.deepEqual(compareDecisionBases(fixture.state, fixture.decisionId, fixture.revisionId, fixture.revisionId).receiptChanges, []);
  assert.equal(JSON.stringify(resolved).includes("receipt-R2"), false, "Later receipt declarations must not leak into an earlier endpoint.");
  const withdrawnState = withdrawn(fixture), withdrawal = basisReceiptContexts(withdrawnState, decisionBasisAt(withdrawnState, fixture.decisionId, "latest"));
  assert.deepEqual(withdrawal.map((item): string => item.status), ["absent", "manual", "absent"]);
  assert.equal(context(withdrawal, "support").capture, null);
  for (const badNote of ["DC_SOURCE_FILE_V1 malformed reserved marker", "DC_SOURCE_FILE_V1\n{bad JSON}"]) {
    const bad = withNote(fixture.state, fixture.secondCaptureId, badNote), bytes = JSON.stringify(bad);
    const inspected = compareDecisionBases(bad, fixture.decisionId, fixture.revisionId, fixture.secondReviewId);
    assert.deepEqual(inspected.receiptContexts.from, resolved);
    assert.equal(context(inspected.receiptContexts.to, "known").status, "invalid");
    assert.equal(context(inspected.receiptContexts.to, "pending").status, "invalid");
    assert.equal(context(inspected.receiptContexts.to, "support").status, "declared");
    assert.equal(JSON.stringify(bad), bytes);
  }
  const mismatchedNotes = [
    sourceFileReceipt({ ...supporting.artifact, environment: "Production" }),
    sourceFileReceipt({ ...supporting.artifact, sourceId: randomUUID() }),
    sourceFileReceipt({ ...supporting.artifact, capturedAt: time(2) }),
    sourceFileReceipt({ ...supporting.artifact, requestedPermissions: ["documents:read"] }),
    sourceFileReceipt({ ...supporting.artifact, grantedPermissions: ["documents:write"] }),
    `DC_SOURCE_FILE_V1\n${JSON.stringify({ ...supporting.artifact, unsupportedField: true })}`,
  ];
  for (const note of mismatchedNotes) {
    const mismatched = withNote(fixture.state, fixture.firstCaptureId, note);
    assert.equal(context(basisReceiptContexts(mismatched, decisionBasisAt(mismatched, fixture.decisionId, fixture.revisionId)), "support").status, "invalid");
  }
  const futureBad = withNote(fixture.state, fixture.manualCaptureId, "DC_SOURCE_FILE_V1\n{later malformed receipt}");
  assert.deepEqual(basisReceiptContexts(futureBad, decisionBasisAt(futureBad, fixture.decisionId, fixture.revisionId)), resolved, "Malformed future metadata cannot invalidate an earlier selected endpoint.");
  const localDeclaration = withNote(fixture.state, fixture.secondCaptureId, sourceFileReceipt({ ...pending.artifact, sourceReference: "https://example.org/synthetic/separate-declaration.json", revision: "00-later-declared" }));
  const captureLocal = compareDecisionBases(localDeclaration, fixture.decisionId, fixture.revisionId, fixture.secondReviewId);
  assert.equal(context(captureLocal.receiptContexts.to, "known").status, "declared", "Historical receipt context validates one exact capture; it does not certify a complete source stream.");
  assert.equal(captureLocal.direction, "forward", "An opaque revision's lexical order does not override recorded causal direction.");
  assert.equal(captureLocal.receiptChanges.find((fact): boolean => fact.key === "receipt-known-revision")?.toValue, "00-later-declared");
  assert.equal(captureLocal.receiptChanges.find((fact): boolean => fact.key === "receipt-known-source-reference")?.toValue, "https://example.org/synthetic/separate-declaration.json");
  assert.throws((): void => { sourceFileArtifacts(localDeclaration); }, /reference.*differs|different stream/i, "The separate intake contract still rejects this changed stream reference.");
  const original = decisionBasisAt(fixture.state, fixture.decisionId, fixture.baselineId), futureCapture = fixture.state.sources.at(-1);
  assert.ok(futureCapture !== undefined);
  assert.throws((): void => { basisReceiptContexts(fixture.state, { ...original, historical: { ...original.historical, knownSource: futureCapture } }); }, /reference|latest|included|capture|known/i);
  assert.throws((): void => { basisReceiptContexts(fixture.state, { ...original, historical: { ...original.historical, support: futureCapture } }); }, /reference|support|capture|included/i);
  const ambiguous = ambiguousFixture();
  assert.throws((): void => { compareDecisionBases(ambiguous.state, ambiguous.decisionId, ambiguous.captureId, "latest"); }, /ambiguous/i);
  assert.equal(JSON.stringify(fixture.state), preserved, "All receipt reconstruction and comparison must preserve input bytes.");
}

async function ready(page: Page): Promise<void> { await page.locator('html[data-app-ready="true"]').waitFor(); }
async function bytes(page: Page): Promise<Record<string, string>> { return page.evaluate((): Record<string, string> => Object.fromEntries(Object.entries(localStorage))); }
async function restore(page: Page, url: string, content: string, id: string): Promise<void> {
  await page.goto(`${url.replace(/\/$/, "")}/impact.html?format=6`); await ready(page);
  const before = await bytes(page);
  await page.getByTestId("import-toggle").click();
  await page.getByTestId("import-file").setInputFiles({ name: "synthetic-basis-receipts.json", mimeType: "application/json", buffer: Buffer.from(content) });
  await page.getByTestId("inspect-import").click(); await page.getByTestId("import-preview").waitFor({ state: "visible" });
  assert.deepEqual(await bytes(page), before);
  const navigation = page.waitForEvent("domcontentloaded"); await page.getByTestId("confirm-import").click(); await navigation; await ready(page);
  assert.equal(new URL(page.url()).searchParams.get("session"), id);
}
async function select(page: Page, decisionId: string, from: string, to: string): Promise<void> {
  await page.getByTestId("basis-decision").selectOption(decisionId);
  await page.getByTestId("basis-event").selectOption(from); await page.getByTestId("basis-compare-event").selectOption(to);
  assert.equal(await page.getByTestId("basis-error").isVisible(), false);
}
async function card(page: Page, side: "from" | "to", role: BasisReceiptRole, status: BasisReceiptContext["status"], sourceEventId: string): Promise<void> {
  const item = page.getByTestId(`basis-receipt-${side}-${role}`);
  assert.equal(await item.getAttribute("data-status"), status);
  assert.equal(await item.getAttribute("data-source-event-id"), sourceEventId);
}
async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(result.violations.map((item): string => `${item.id}: ${item.nodes.map((node): string => node.target.join(", ")).join(", ")}`), []);
  assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true);
}
async function exportHistory(page: Page): Promise<string> {
  const downloading = page.waitForEvent("download"); await page.getByTestId("shared-export").click();
  return readFile(z.string().parse(await (await downloading).path()), "utf8");
}
async function focusedReference(page: Page, side: "from" | "to", kind: string, id: string): Promise<void> {
  assert.deepEqual(await page.evaluate((endpointId: string): Readonly<{ inside: boolean; kind: string | undefined; id: string | undefined }> => {
    const target = document.activeElement, endpoint = document.getElementById(endpointId);
    if (!(target instanceof HTMLElement) || endpoint === null) throw new ReferenceError("Exact receipt references require a focused selected-endpoint record.");
    return { inside: endpoint.contains(target), kind: target.dataset.basisRefKind, id: target.dataset.basisRefId };
  }, side === "from" ? "basis-historical" : "basis-latest"), { inside: true, kind, id });
}

/** Native endpoint selection, exact-reference navigation and real recovery retain receipts without writing exploration state. */
export async function checkBasisReceipts(browser: Browser, url: string): Promise<void> {
  checkBasisReceiptsModel();
  const fixture = basisReceiptsFixture(), wrapper = createUncertaintyState(fixture.state, randomUUID(), time(11));
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
  desktop.setDefaultTimeout(5000); mobile.setDefaultTimeout(5000);
  try {
    const page = await desktop.newPage(), narrow = await mobile.newPage(), failures: Error[] = [], sourceRequests: string[] = [];
    page.on("pageerror", (error: Error): void => { failures.push(error); }); narrow.on("pageerror", (error: Error): void => { failures.push(error); });
    for (const item of [page, narrow]) item.on("request", (request): void => { if (request.url().startsWith("https://example.org/synthetic/")) sourceRequests.push(request.url()); });
    await restore(page, url, JSON.stringify(clarificationHistoryExport(fixture.state, time(12))), fixture.state.id);
    const preserved = await bytes(page);
    assert.equal(preserved[clarificationStorageKey(fixture.state.id)], JSON.stringify(fixture.state));
    await select(page, fixture.decisionId, fixture.revisionId, fixture.secondReviewId);
    await card(page, "from", "support", "declared", fixture.firstCaptureId); await card(page, "from", "pending", "absent", "");
    await card(page, "to", "support", "declared", fixture.firstCaptureId); await card(page, "to", "known", "declared", fixture.secondCaptureId); await card(page, "to", "pending", "declared", fixture.secondCaptureId);
    await page.getByTestId("basis-receipt-from-support-toggle").focus(); await page.keyboard.press("Enter");
    assert.equal(await page.getByTestId("basis-receipt-from-support-revision").innerText(), "receipt-R1");
    assert.equal(await page.getByTestId("basis-receipt-from-support-updated-at").innerText(), time(0));
    assert.equal(await page.getByTestId("basis-receipt-from-support-recorded-at").innerText(), time(2));
    await page.getByTestId("basis-receipt-from-support-evidence-ref").focus(); await page.keyboard.press("Enter");
    await focusedReference(page, "from", "evidence", fixture.firstEvidenceId);
    const comparison = compareDecisionBases(fixture.state, fixture.decisionId, fixture.revisionId, fixture.secondReviewId);
    const changed = comparison.receiptChanges.find((fact): boolean => fact.toReferences.some((ref): boolean => ref.kind === "source-event" && ref.id === fixture.secondCaptureId));
    assert.ok(changed !== undefined);
    const referenceIndex = changed.toReferences.findIndex((ref): boolean => ref.kind === "source-event" && ref.id === fixture.secondCaptureId);
    await page.getByTestId(`basis-refs-to-${changed.key}-toggle`).click();
    const exactReference = page.getByTestId(`basis-ref-to-${changed.key}-${referenceIndex}`);
    await exactReference.focus(); await page.keyboard.press("Enter");
    await focusedReference(page, "to", "source-event", fixture.secondCaptureId);
    assert.equal(await page.getByTestId("basis-panel").locator("img").count(), 0);
    await accessible(page);
    await select(page, fixture.decisionId, fixture.secondReviewId, fixture.revisionId);
    assert.equal(await page.getByTestId("basis-comparison-summary").getAttribute("data-direction"), "backward");
    await card(page, "from", "known", "declared", fixture.secondCaptureId); await card(page, "to", "known", "declared", fixture.firstCaptureId);
    await select(page, fixture.decisionId, fixture.revisionId, fixture.revisionId);
    assert.equal(await page.getByTestId("basis-comparison-summary").getAttribute("data-direction"), "same");
    await select(page, fixture.decisionId, fixture.revisionId, "latest");
    await card(page, "to", "known", "manual", fixture.manualCaptureId); await card(page, "to", "pending", "declared", fixture.secondCaptureId);
    assert.deepEqual(await bytes(page), preserved);
    const exported = await exportHistory(page);
    assert.deepEqual(ClarificationHistoryExportSchema.parse(JSON.parse(exported)).session, fixture.state);
    await page.reload(); await ready(page); await select(page, fixture.decisionId, fixture.revisionId, "latest");
    await card(page, "from", "support", "declared", fixture.firstCaptureId); assert.deepEqual(await bytes(page), preserved);
    await restore(narrow, url, exported, fixture.state.id);
    await select(narrow, fixture.decisionId, fixture.revisionId, fixture.secondReviewId);
    await card(narrow, "to", "pending", "declared", fixture.secondCaptureId); await accessible(narrow);
    await narrow.getByTestId("basis-receipt-to-pending-toggle").click();
    await narrow.getByTestId("basis-receipt-to-pending-source-event-ref").focus(); await narrow.keyboard.press("Enter");
    await focusedReference(narrow, "to", "source-event", fixture.secondCaptureId);
    const restoredBytes = await bytes(narrow); await select(narrow, fixture.decisionId, fixture.revisionId, "latest"); assert.deepEqual(await bytes(narrow), restoredBytes);
    await restore(page, url, JSON.stringify(uncertaintyHistoryExport(wrapper, time(12))), wrapper.id);
    const wrapperBytes = await bytes(page); assert.equal(wrapperBytes[uncertaintyStorageKey(wrapper.id)], JSON.stringify(wrapper));
    await select(page, fixture.decisionId, fixture.revisionId, fixture.secondReviewId);
    await card(page, "to", "pending", "declared", fixture.secondCaptureId); assert.deepEqual(await bytes(page), wrapperBytes);
    assert.deepEqual(UncertaintyHistoryExportSchema.parse(JSON.parse(await exportHistory(page))).session, wrapper);
    const badState = withNote(fixture.state, fixture.secondCaptureId, "DC_SOURCE_FILE_V1\n{malformed selected receipt}");
    const invalidContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); invalidContext.setDefaultTimeout(5000);
    try {
      const invalid = await invalidContext.newPage(); invalid.on("pageerror", (error: Error): void => { failures.push(error); });
      await restore(invalid, url, JSON.stringify(clarificationHistoryExport(badState, time(12))), badState.id);
      const invalidBytes = await bytes(invalid);
      await select(invalid, fixture.decisionId, fixture.revisionId, fixture.secondReviewId);
      await card(invalid, "from", "support", "declared", fixture.firstCaptureId); await card(invalid, "to", "known", "invalid", fixture.secondCaptureId);
      assert.equal(await invalid.getByTestId("shared-error").isVisible(), false, "Invalid receipt metadata must not disable ordinary recorded-basis reconstruction.");
      assert.equal(await invalid.getByTestId("source-file-inspect").isDisabled(), true, "Malformed marked history remains blocked at the separate intake boundary.");
      assert.deepEqual(await bytes(invalid), invalidBytes); await accessible(invalid);
    } finally { await invalidContext.close(); }
    assert.deepEqual(failures, []); assert.deepEqual(sourceRequests, [], "Source references remain declarations; historical inspection must not fetch them.");
  } finally { await desktop.close(); await mobile.close(); }
}
