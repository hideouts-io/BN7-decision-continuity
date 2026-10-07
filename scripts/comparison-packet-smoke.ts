import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { ClarificationStateSchema } from "../src/clarification-model.ts";
import type { ClarificationState } from "../src/clarification-model.ts";
import { clarificationHistoryExport } from "../src/clarification-export.ts";
import { clarificationStorageKey } from "../src/clarification-storage.ts";
import { compareDecisionBases } from "../src/basis-comparison.ts";
import type { BasisComparison } from "../src/basis-comparison.ts";
import { createComparisonPacket, inspectComparisonPacket } from "../src/comparison-packet.ts";
import type { ComparisonPacket } from "../src/comparison-packet.ts";
import { MAX_IMPORT_BYTES, parseHistoryExport } from "../src/recovery.ts";
import { basisFixture, tiedFixture, ambiguousFixture } from "./basis-smoke.ts";
import type { BasisFixture } from "./basis-smoke.ts";
import { basisReceiptsFixture } from "./basis-receipts-smoke.ts";

const createdAt: string = "2026-10-07T00:00:00.000Z";

function samePerspectives(actual: BasisComparison, expected: BasisComparison): void {
  assert.equal(actual.direction, expected.direction);
  assert.deepEqual(actual.from.historical, expected.from.historical);
  assert.deepEqual(actual.to.historical, expected.to.historical);
  assert.deepEqual(actual.from.includedEventIds, expected.from.includedEventIds);
  assert.deepEqual(actual.to.includedEventIds, expected.to.includedEventIds);
  assert.deepEqual(actual.changedFacts, expected.changedFacts);
  assert.deepEqual(actual.receiptContexts, expected.receiptContexts);
  assert.deepEqual(actual.receiptChanges, expected.receiptChanges);
  assert.deepEqual(actual.preservedOriginalRules, expected.preservedOriginalRules);
  assert.deepEqual(actual.recordChanges, expected.recordChanges);
}

function rejected(packet: ComparisonPacket, value: object, reason: RegExp): void {
  const preserved = JSON.stringify(packet);
  assert.throws((): void => { inspectComparisonPacket(JSON.stringify(value)); }, reason);
  assert.equal(JSON.stringify(packet), preserved, "Rejected packet inspection cannot alter the original packet.");
}

/** A comparison archive carries one decision and exact bounded cuts, rather than an operational session or computed claims. */
export function checkComparisonPacketModel(): void {
  const fixture = basisFixture(), bytes = JSON.stringify(fixture.state);
  const packet = createComparisonPacket(fixture.state, fixture.decisionId, fixture.firstOutcomeId, fixture.deferralId, createdAt);
  const content = JSON.stringify(packet), inspected = inspectComparisonPacket(content);
  assert.deepEqual(inspected.packet, packet);
  assert.equal(packet.packetKind, "decision-basis-comparison");
  assert.equal(packet.packetSchemaVersion, 1);
  assert.equal(packet.archive.originalDecisions.length, 1);
  assert.deepEqual(packet.archive.originalDecisions[0], fixture.state.originalDecisions.find((item): boolean => item.decision.id === fixture.decisionId));
  assert.deepEqual(packet.archive.sources.map((item): string => item.id), [fixture.baselineId, fixture.firstCaptureId, fixture.unknownCaptureId]);
  assert.deepEqual(packet.archive.reviews.map((item): string => item.id), [fixture.firstReviewId, fixture.unknownReviewId]);
  assert.deepEqual(packet.archive.outcomes.map((item): string => item.id), [fixture.firstOutcomeId, fixture.deferralId]);
  assert.deepEqual(packet.archive.replacements, []);
  assert.deepEqual(packet.from, { selection: "recorded-event", eventId: fixture.firstOutcomeId, includedEventIds: inspected.comparison.from.includedEventIds });
  assert.deepEqual(packet.to, { selection: "recorded-event", eventId: fixture.deferralId, includedEventIds: inspected.comparison.to.includedEventIds });
  for (const record of fixture.state.originalDecisions.filter((item): boolean => item.decision.id !== fixture.decisionId)) {
    assert.equal(content.includes(record.decision.id), false, "Unrelated decisions and assumptions must not enter the selected packet.");
    assert.equal(content.includes(record.assumption.id), false);
  }
  for (const id of [fixture.clarifiedCaptureId, fixture.replacementId, fixture.replacementReviewId, fixture.finalOutcomeId]) {
    assert.equal(content.includes(id), false, "Later records outside both selected cuts must be omitted, including from endpoint metadata.");
  }
  assert.equal(ClarificationStateSchema.safeParse({ ...packet.archive, schemaVersion: 6 }).success, false, "The one-decision archive must not weaken the three-decision operational contract.");
  assert.throws((): void => { parseHistoryExport(content); }, z.ZodError, "A comparison packet cannot restore an operational history.");
  samePerspectives(inspected.comparison, compareDecisionBases(fixture.state, fixture.decisionId, fixture.firstOutcomeId, fixture.deferralId));
  for (const [from, to] of [[fixture.deferralId, fixture.firstOutcomeId], [fixture.firstOutcomeId, fixture.firstOutcomeId], [fixture.firstOutcomeId, "latest"], ["latest", fixture.deferralId], ["latest", "latest"]]) {
    const fromId = z.string().parse(from), toId = z.string().parse(to);
    const result = inspectComparisonPacket(JSON.stringify(createComparisonPacket(fixture.state, fixture.decisionId, fromId, toId, createdAt)));
    samePerspectives(result.comparison, compareDecisionBases(fixture.state, fixture.decisionId, fromId, toId));
    if (fromId === "latest") assert.deepEqual(result.packet.from, { selection: "frozen-latest", eventId: null, includedEventIds: result.comparison.from.includedEventIds });
    if (toId === "latest") assert.deepEqual(result.packet.to, { selection: "frozen-latest", eventId: null, includedEventIds: result.comparison.to.includedEventIds });
  }
  const atomic = inspectComparisonPacket(JSON.stringify(createComparisonPacket(fixture.state, fixture.decisionId, fixture.replacementId, fixture.replacementReviewId, createdAt)));
  assert.equal(atomic.comparison.direction, "same");
  assert.equal(atomic.packet.from.eventId, fixture.replacementId);
  assert.equal(atomic.packet.to.eventId, fixture.replacementReviewId, "The selected alias remains inspectable; it shares its replacement's atomic cut.");
  assert.deepEqual(atomic.comparison.from.includedEventIds, atomic.comparison.to.includedEventIds);
  assert.equal(atomic.packet.archive.outcomes.some((item): boolean => item.id === fixture.finalOutcomeId), false);
  assert.equal(atomic.comparison.to.historical.pendingReview?.id, fixture.replacementReviewId);
  const tied = tiedFixture();
  samePerspectives(inspectComparisonPacket(JSON.stringify(createComparisonPacket(tied.state, tied.decisionId, tied.captureId, tied.reviewId, createdAt))).comparison, compareDecisionBases(tied.state, tied.decisionId, tied.captureId, tied.reviewId));
  const ambiguous = ambiguousFixture();
  assert.throws((): void => { createComparisonPacket(ambiguous.state, ambiguous.decisionId, ambiguous.captureId, "latest", createdAt); }, /ambiguous/i);
  assert.equal(inspectComparisonPacket(JSON.stringify(createComparisonPacket(ambiguous.state, ambiguous.decisionId, "latest", "latest", createdAt))).comparison.direction, "same", "A frozen complete archive remains inspectable without inventing an order for independent equal-time events.");
  const receipts = basisReceiptsFixture();
  const receiptPacket = createComparisonPacket(receipts.state, receipts.decisionId, receipts.revisionId, receipts.secondReviewId, createdAt);
  const receiptResult = inspectComparisonPacket(JSON.stringify(receiptPacket));
  samePerspectives(receiptResult.comparison, compareDecisionBases(receipts.state, receipts.decisionId, receipts.revisionId, receipts.secondReviewId));
  assert.equal(JSON.stringify(receiptPacket).includes(receipts.manualCaptureId), false);
  assert.equal(JSON.stringify(receiptResult.comparison.from.historical).includes("receipt-R2"), false);
  assert.ok(receiptResult.comparison.receiptChanges.length > 0);
  const baseline = fixture.state.sources[0];
  assert.ok(baseline !== undefined);
  const extraCaptures = Array.from({ length: 247 }, (_, index: number): ClarificationState["sources"][number] => {
    const recordedAt = new Date(Date.parse("2026-10-06T00:00:20.000Z") + index * 1000).toISOString();
    return { id: randomUUID(), recordedAt, evidence: { ...baseline.evidence, id: randomUUID(), capturedAt: recordedAt, sourceNote: "Synthetic bounded-history capture preserves declared permissions and unobserved runtime." } };
  });
  const atLimit = ClarificationStateSchema.parse({ ...fixture.state, sources: [...fixture.state.sources, ...extraCaptures.slice(0, 246)] });
  assert.equal(createComparisonPacket(atLimit, fixture.decisionId, "latest", "latest", createdAt).from.includedEventIds.length, 256);
  const overLimit = ClarificationStateSchema.parse({ ...fixture.state, sources: [...fixture.state.sources, ...extraCaptures] });
  const overLimitBytes = JSON.stringify(overLimit);
  assert.throws((): void => { createComparisonPacket(overLimit, fixture.decisionId, "latest", "latest", createdAt); }, /256|bounded|at most/i);
  assert.equal(JSON.stringify(overLimit), overLimitBytes, "An event limit failure must not truncate stored history.");
  rejected(packet, { ...packet, unsupportedField: true }, /unrecognized|unknown|strict/i);
  rejected(packet, { ...packet, packetSchemaVersion: 99 }, /invalid|expected|version/i);
  rejected(packet, { ...packet, from: { ...packet.from, eventId: randomUUID() } }, /belong|event|reference/i);
  rejected(packet, { ...packet, from: { ...packet.from, includedEventIds: packet.from.includedEventIds.slice(1) } }, /cut|included|reference|event/i);
  rejected(packet, { ...packet, to: { selection: "frozen-latest", eventId: fixture.deferralId, includedEventIds: packet.to.includedEventIds } }, /null|frozen|invalid/i);
  rejected(packet, { ...packet, archive: { ...packet.archive, originalDecisions: fixture.state.originalDecisions } }, /one|1|length|decision/i);
  rejected(packet, { ...packet, archive: { ...packet.archive, source: { ...packet.archive.source, unsupportedField: true } } }, /unrecognized|unknown|strict/i);
  rejected(packet, { ...packet, archive: { ...packet.archive, sources: packet.archive.sources.map((item) => ({ ...item, evidence: { ...item.evidence, unsupportedField: true } })) } }, /unrecognized|unknown|strict/i);
  rejected(packet, { ...packet, archive: { ...packet.archive, reviews: packet.archive.reviews.map((item) => ({ ...item, sourceEventId: fixture.baselineId })) } }, /reference|review|source|basis|capture/i);
  rejected(packet, { ...packet, archive: { ...packet.archive, outcomes: packet.archive.outcomes.map((item) => ({ ...item, revision: `${fixture.decisionId}.99` })) } }, /revision|outcome/i);
  rejected(packet, { ...packet, archive: { ...packet.archive, sources: [...packet.archive.sources, fixture.state.sources.at(-1)] } }, /cut|outside|source|event|capture|union/i);
  rejected(packet, { ...packet, createdAt: "2020-01-01T00:00:00.000Z" }, /time|predate|created/i);
  assert.throws((): void => { inspectComparisonPacket("{malformed JSON"); }, SyntaxError);
  assert.throws((): void => { inspectComparisonPacket(" ".repeat(MAX_IMPORT_BYTES + 1)); }, /MiB|limit|size/i);
  assert.throws((): void => { inspectComparisonPacket(`"${"é".repeat(MAX_IMPORT_BYTES / 2)}"`); }, /MiB|limit|size/i, "The bound applies to UTF-8 bytes, not string length.");
  assert.equal(JSON.stringify(fixture.state), bytes);
  assert.equal(JSON.stringify(packet), content, "Read-only reconstruction and rejection preserve all original packet bytes.");
}

type StorageBytes = Readonly<{ local: Record<string, string>; session: Record<string, string> }>;
async function storageBytes(page: Page): Promise<StorageBytes> {
  return page.evaluate((): StorageBytes => ({ local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage)) }));
}
async function ready(page: Page): Promise<void> { await page.locator('html[data-app-ready="true"]').waitFor(); }
async function restore(page: Page, url: string, fixture: BasisFixture): Promise<void> {
  await page.goto(`${url}/impact.html?format=6`); await ready(page);
  const before = await storageBytes(page);
  await page.getByTestId("import-toggle").click();
  await page.getByTestId("import-file").setInputFiles({ name: "synthetic-comparison-history.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(clarificationHistoryExport(fixture.state, createdAt))) });
  await page.getByTestId("inspect-import").click(); await page.getByTestId("import-preview").waitFor({ state: "visible" });
  assert.deepEqual(await storageBytes(page), before);
  const navigation = page.waitForEvent("domcontentloaded"); await page.getByTestId("confirm-import").click(); await navigation; await ready(page);
}
async function upload(page: Page, content: string): Promise<void> {
  await page.getByTestId("packet-file").setInputFiles({ name: "synthetic-comparison-packet.json", mimeType: "application/json", buffer: Buffer.from(content) });
  assert.equal(await page.getByTestId("packet-result").isVisible(), false);
  assert.equal(await page.getByTestId("packet-print").isDisabled(), true);
  await page.getByTestId("packet-inspect").focus(); await page.keyboard.press("Enter");
}
async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(result.violations.map((item): string => `${item.id}: ${item.nodes.map((node): string => node.target.join(", ")).join(", ")}`), []);
  assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true);
}
async function selectedPerspectives(page: Page, fixture: BasisFixture): Promise<void> {
  assert.equal(await page.getByTestId("basis-historical").getAttribute("data-known-source-id"), fixture.firstCaptureId);
  assert.equal(await page.getByTestId("basis-latest").getAttribute("data-known-source-id"), fixture.unknownCaptureId);
  assert.equal(await page.getByTestId("basis-historical").getAttribute("data-pending-review-id"), "");
  assert.equal(await page.getByTestId("basis-latest").getAttribute("data-pending-review-id"), fixture.unknownReviewId);
  assert.equal(await page.getByTestId("basis-historical").getAttribute("data-basis-revision"), `${fixture.decisionId}.2`);
  assert.equal(await page.getByTestId("basis-latest").getAttribute("data-basis-revision"), `${fixture.decisionId}.2`);
  assert.equal((await page.getByTestId("packet-result").textContent())?.includes(fixture.finalOutcomeId), false);
  assert.equal(await page.getByTestId("packet-result").locator("img").count(), 0);
}
async function reference(page: Page, id: string): Promise<void> {
  await page.getByTestId("basis-refs-to-recorded-deferrals-toggle").click();
  const button = page.getByTestId("basis-ref-to-recorded-deferrals-0");
  assert.equal(await button.getAttribute("data-basis-ref-id"), id);
  await button.focus(); await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate((): Readonly<{ id: string | undefined; kind: string | undefined; endpoint: boolean }> => {
    const target = document.activeElement, endpoint = document.getElementById("basis-latest");
    if (!(target instanceof HTMLElement) || endpoint === null) throw new ReferenceError("Packet reference navigation requires its exact endpoint record.");
    return { id: target.dataset.basisRefId, kind: target.dataset.basisRefKind, endpoint: endpoint.contains(target) };
  }), { id, kind: "outcome", endpoint: true });
}

/** Native downloads and fresh-profile local inspection exercise a separate read-only packet, including real print rendering. */
export async function checkComparisonPacket(browser: Browser, url: string): Promise<void> {
  checkComparisonPacketModel();
  const fixture = basisFixture();
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const fresh = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
  for (const context of [desktop, fresh, mobile]) context.setDefaultTimeout(5000);
  try {
    const page = await desktop.newPage(), reader = await fresh.newPage(), narrow = await mobile.newPage();
    const errors: Error[] = [], externalRequests: string[] = [];
    for (const item of [page, reader, narrow]) {
      item.on("pageerror", (error: Error): void => { errors.push(error); });
      item.on("request", (request): void => {
        const target = new URL(request.url());
        if ((target.protocol === "http:" || target.protocol === "https:") && target.origin !== new URL(url).origin) externalRequests.push(target.href);
      });
    }
    await restore(page, url, fixture);
    const preserved = await storageBytes(page);
    assert.equal(preserved.local[clarificationStorageKey(fixture.state.id)], JSON.stringify(fixture.state));
    await page.getByTestId("basis-decision").selectOption(fixture.decisionId);
    await page.getByTestId("basis-event").selectOption(fixture.firstOutcomeId);
    await page.getByTestId("basis-compare-event").selectOption(fixture.deferralId);
    const downloading = page.waitForEvent("download");
    await page.getByTestId("basis-export").focus(); await page.keyboard.press("Enter");
    const download = await downloading;
    const content = await readFile(z.string().parse(await download.path()), "utf8");
    const inspected = inspectComparisonPacket(content);
    assert.equal(inspected.packet.decisionId, fixture.decisionId);
    assert.equal(inspected.packet.from.eventId, fixture.firstOutcomeId); assert.equal(inspected.packet.to.eventId, fixture.deferralId);
    samePerspectives(inspected.comparison, compareDecisionBases(fixture.state, fixture.decisionId, fixture.firstOutcomeId, fixture.deferralId));
    assert.deepEqual(await storageBytes(page), preserved, "Exporting a focused packet cannot change saved operational history or selection state.");
    const invalidEvent = randomUUID();
    await page.getByTestId("basis-compare-event").evaluate((element, id: string): void => {
      if (!(element instanceof HTMLSelectElement)) throw new TypeError("A packet endpoint must use its native historical-event selector.");
      element.add(new Option("Synthetic invalid endpoint", id));
    }, invalidEvent);
    await page.getByTestId("basis-compare-event").selectOption(invalidEvent);
    assert.equal(await page.getByTestId("basis-error").isVisible(), true);
    assert.equal(await page.getByTestId("basis-export").isDisabled(), true, "An invalid selection cannot export a stale previously valid comparison.");
    await page.getByTestId("basis-compare-event").selectOption(fixture.deferralId);
    assert.equal(await page.getByTestId("basis-export").isEnabled(), true);
    assert.deepEqual(await storageBytes(page), preserved);
    const route = `${url}/comparison.html`;
    assert.equal(new URL(z.string().parse(await page.getByTestId("basis-packet-open").getAttribute("href")), page.url()).href, route);
    await reader.goto(route); await ready(reader);
    assert.deepEqual(await storageBytes(reader), { local: {}, session: {} }, "The separate inspector must initialize no operational state in a fresh profile.");
    assert.equal(await reader.getByTestId("packet-print").isDisabled(), true);
    await upload(reader, content); await reader.getByTestId("packet-result").waitFor({ state: "visible" });
    assert.equal(await reader.getByTestId("packet-error").isVisible(), false);
    assert.equal(await reader.getByTestId("packet-print").isEnabled(), true);
    await selectedPerspectives(reader, fixture); await reference(reader, fixture.deferralId); await accessible(reader);
    assert.deepEqual(await storageBytes(reader), { local: {}, session: {} });
    await reader.getByTestId("packet-result").screenshot({ path: "output/playwright/comparison-packet-desktop.png", animations: "disabled" });
    const resources = await reader.locator('script[src], link[rel="stylesheet"], link[rel="icon"]').evaluateAll((elements): string[] => elements.map((element): string => new URL(element.getAttribute("src") ?? element.getAttribute("href") ?? "", document.baseURI).href));
    assert.ok(resources.length >= 3);
    for (const resource of resources) assert.ok(resource.startsWith(`${url}/`), `Packet asset escaped application directory: ${resource}`);
    await reader.emulateMedia({ media: "print" });
    assert.equal(await reader.getByTestId("packet-file").isVisible(), false);
    assert.equal(await reader.getByTestId("packet-print").isVisible(), false);
    assert.equal(await reader.getByTestId("packet-result").isVisible(), true);
    const pdf = await reader.pdf({ path: "output/playwright/comparison-packet-print.pdf", format: "A4", printBackground: false });
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.length > 1000);
    await reader.screenshot({ path: "output/playwright/comparison-packet-print.png", fullPage: true, animations: "disabled" });
    await reader.emulateMedia({ media: "screen" });
    assert.deepEqual(await storageBytes(reader), { local: {}, session: {} }, "Printing never records a human outcome or restores history.");
    const receipts = basisReceiptsFixture();
    await upload(reader, JSON.stringify(createComparisonPacket(receipts.state, receipts.decisionId, receipts.revisionId, receipts.secondReviewId, createdAt)));
    await reader.getByTestId("packet-result").waitFor({ state: "visible" });
    assert.equal(await reader.getByTestId("basis-receipt-from-support").getAttribute("data-source-event-id"), receipts.firstCaptureId);
    assert.equal(await reader.getByTestId("basis-receipt-to-known").getAttribute("data-source-event-id"), receipts.secondCaptureId);
    assert.equal(await reader.getByTestId("basis-receipt-to-pending").getAttribute("data-source-event-id"), receipts.secondCaptureId);
    assert.equal(await reader.getByTestId("packet-result").locator("img").count(), 0);
    assert.ok((await reader.getByTestId("packet-result").textContent())?.includes(`https://example.org/synthetic/${receipts.state.source.id}.json`));
    assert.deepEqual(await storageBytes(reader), { local: {}, session: {} });
    await reader.evaluate(({ key, value }: { key: string; value: string }): void => {
      localStorage.setItem(key, value); localStorage.setItem("packet-preservation-sentinel", "existing invalid bytes stay unchanged"); sessionStorage.setItem("packet-session-sentinel", "existing session bytes");
    }, { key: clarificationStorageKey(fixture.state.id), value: JSON.stringify(fixture.state) });
    const existing = await storageBytes(reader);
    await upload(reader, "{malformed JSON"); await reader.getByTestId("packet-error").waitFor({ state: "visible" });
    assert.equal(await reader.getByTestId("packet-result").isVisible(), false);
    assert.equal(await reader.getByTestId("packet-print").isDisabled(), true);
    assert.equal(await reader.getByTestId("basis-historical").innerHTML(), "", "Invalid input must clear the previous valid packet rather than leave stale selected evidence.");
    assert.equal(await reader.getByTestId("basis-historical").getAttribute("data-known-source-id"), null);
    assert.equal(await reader.getByTestId("packet-result").locator("[data-basis-source-event-id], [data-outcome-id]").count(), 0);
    assert.deepEqual(await storageBytes(reader), existing);
    await upload(reader, JSON.stringify({ ...inspected.packet, to: { ...inspected.packet.to, eventId: randomUUID() } })); await reader.getByTestId("packet-error").waitFor({ state: "visible" });
    assert.equal(await reader.getByTestId("packet-result").isVisible(), false);
    await upload(reader, JSON.stringify(clarificationHistoryExport(fixture.state, createdAt))); await reader.getByTestId("packet-error").waitFor({ state: "visible" });
    assert.equal(await reader.getByTestId("packet-result").isVisible(), false, "Operational export files must use recovery, never silently become a comparison packet.");
    await upload(reader, content); await reader.getByTestId("packet-result").waitFor({ state: "visible" });
    await upload(reader, " ".repeat(MAX_IMPORT_BYTES + 1)); await reader.getByTestId("packet-error").waitFor({ state: "visible" });
    assert.match(await reader.getByTestId("packet-error").innerText(), /MiB|limit|size/i);
    assert.equal(await reader.getByTestId("packet-result").isVisible(), false);
    assert.equal(await reader.getByTestId("packet-print").isDisabled(), true);
    assert.deepEqual(await storageBytes(reader), existing, "The native file-size boundary rejects before decoding without leaving stale evidence or changing storage.");
    await upload(reader, content); await reader.getByTestId("packet-result").waitFor({ state: "visible" });
    await reader.getByTestId("packet-clear").focus(); await reader.keyboard.press("Enter");
    assert.equal(await reader.getByTestId("packet-file").inputValue(), "");
    assert.equal(await reader.getByTestId("packet-result").isVisible(), false); assert.equal(await reader.getByTestId("packet-print").isDisabled(), true);
    await upload(reader, content); await reader.getByTestId("packet-result").waitFor({ state: "visible" });
    await reader.reload(); await ready(reader);
    assert.equal(await reader.getByTestId("packet-result").isVisible(), false); assert.equal(await reader.getByTestId("packet-print").isDisabled(), true);
    assert.deepEqual(await storageBytes(reader), existing, "Reload leaves only the original browser bytes; the packet is not persisted.");
    await narrow.goto(route); await ready(narrow); await upload(narrow, content); await narrow.getByTestId("packet-result").waitFor({ state: "visible" });
    await selectedPerspectives(narrow, fixture); await accessible(narrow);
    assert.equal(await narrow.evaluate((): string => getComputedStyle(document.documentElement).scrollBehavior), "auto");
    await narrow.getByTestId("packet-result").screenshot({ path: "output/playwright/comparison-packet-mobile.png", animations: "disabled" });
    assert.deepEqual(await storageBytes(narrow), { local: {}, session: {} });
    await reader.goto(`${url}/impact.html?format=6`); await ready(reader);
    const recoveryBytes = await storageBytes(reader);
    await reader.getByTestId("import-toggle").click();
    await reader.getByTestId("import-file").setInputFiles({ name: "comparison-is-not-history.json", mimeType: "application/json", buffer: Buffer.from(content) });
    await reader.getByTestId("inspect-import").click(); await reader.getByTestId("import-error").waitFor({ state: "visible" });
    assert.equal(await reader.getByTestId("confirm-import").isDisabled(), true);
    assert.equal(await reader.getByTestId("import-preview").isVisible(), false);
    assert.deepEqual(await storageBytes(reader), recoveryBytes);
    assert.deepEqual(externalRequests, [], "Local inspection and export must contact only the serving origin, never captured source URLs or external services.");
    assert.deepEqual(errors, []);
    console.log("comparison_packet_smoke_passed", { selectedEndpoints: true, minimalOneDecisionArchive: true, forwardBackwardSameFrozenLatest: true, atomicAliases: true, exactReferences: true, noFutureLeakage: true, invalidAndAmbiguousRejected: true, strictBoundedContract: true, freshProfileInspection: true, operationalRecoverySeparated: true, storageBytesPreserved: true, keyboard: true, mobile: true, reducedMotion: true, accessibility: true, printRendering: true, practitionerParticipation: false });
  } finally { await desktop.close(); await fresh.close(); await mobile.close(); }
}
