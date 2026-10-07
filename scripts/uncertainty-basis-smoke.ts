import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { UncertaintyStateSchema } from "../src/uncertainty-model.ts";
import type { UncertaintyState } from "../src/uncertainty-model.ts";
import { uncertaintyHistoryExport, UncertaintyHistoryExportSchema } from "../src/uncertainty-export.ts";
import { uncertaintyStorageKey } from "../src/uncertainty-storage.ts";
import { uncertaintyBasisAt, uncertaintyBasisEvents, compareUncertaintyDecisionBases } from "../src/uncertainty-basis.ts";
import { createUncertaintyComparisonPacket } from "../src/uncertainty-comparison-packet.ts";
import { inspectComparisonPacket, MAX_COMPARISON_PACKET_BYTES } from "../src/comparison-packet.ts";
import { parseHistoryExport } from "../src/recovery.ts";
import { uncertaintyFixture } from "./uncertainty-smoke.ts";

const createdAt: string = "2026-10-07T00:00:00.000Z";

/** Exact journal references establish order; timestamps alone never imply a response preceded approval. */
export function checkUncertaintyBasisModel(): void {
  const fixture = uncertaintyFixture(), state = fixture.completed, preserved = JSON.stringify(state);
  const requirement = state.requirements[0], insufficient = state.resolutions[0], satisfied = state.resolutions[1];
  const replacement = state.history.replacements[0], terminal = state.history.outcomes.at(-1);
  assert.ok(requirement !== undefined && insufficient !== undefined && satisfied !== undefined && replacement !== undefined && terminal !== undefined);
  const before = uncertaintyBasisAt(state, fixture.decisionId, fixture.deferralId);
  assert.deepEqual(before.clarificationContext.requirements, [], "A later question cannot appear at its earlier deferral.");
  const required = uncertaintyBasisAt(state, fixture.decisionId, requirement.id);
  assert.equal(required.clarificationContext.requirements[0]?.status, "unresolved");
  assert.deepEqual(required.clarificationContext.requirements[0]?.requirement, requirement);
  assert.deepEqual(required.clarificationContext.requirements[0]?.resolutions, []);
  const attempted = uncertaintyBasisAt(state, fixture.decisionId, insufficient.id);
  assert.equal(attempted.clarificationContext.requirements[0]?.status, "insufficient");
  assert.deepEqual(attempted.clarificationContext.requirements[0]?.resolutions, [insufficient]);
  assert.equal(attempted.historical.knownSource.id, fixture.unknownCaptureId);
  const addressed = uncertaintyBasisAt(state, fixture.decisionId, satisfied.id);
  assert.equal(addressed.clarificationContext.requirements[0]?.status, "satisfied");
  assert.deepEqual(addressed.clarificationContext.requirements[0]?.resolutions, [insufficient, satisfied]);
  for (const perspective of [required, attempted, addressed]) {
    assert.deepEqual(perspective.historical.basis, before.historical.basis, "An evidence response does not revise the decision basis.");
    assert.equal(perspective.historical.pendingReview?.id, fixture.reviewId, "Satisfaction cannot close or replace the frozen review.");
    assert.equal(perspective.historical.outcomes.some((outcome): boolean => outcome.id === terminal.id), false);
  }
  const replaced = uncertaintyBasisAt(state, fixture.decisionId, replacement.id);
  assert.equal(replaced.historical.pendingReview?.id, replacement.newReviewId);
  assert.deepEqual(replaced.historical.basis, before.historical.basis);
  assert.deepEqual(uncertaintyBasisAt(state, fixture.decisionId, replacement.newReviewId).includedEventIds, replaced.includedEventIds, "Replacement and its new review retain their atomic alias.");
  assert.equal(uncertaintyBasisAt(state, fixture.decisionId, terminal.id).historical.basis?.sourceEventId, fixture.productionCaptureId);
  for (const [from, to, direction] of [[requirement.id, satisfied.id, "forward"], [satisfied.id, insufficient.id, "backward"], [satisfied.id, satisfied.id, "same"], [requirement.id, "latest", "forward"]] as const) {
    const comparison = compareUncertaintyDecisionBases(state, fixture.decisionId, from, to);
    assert.equal(comparison.direction, direction);
    assert.deepEqual(comparison.clarificationContexts?.from, uncertaintyBasisAt(state, fixture.decisionId, from).clarificationContext);
    assert.deepEqual(comparison.clarificationContexts?.to, uncertaintyBasisAt(state, fixture.decisionId, to).clarificationContext);
  }
  const status = compareUncertaintyDecisionBases(state, fixture.decisionId, insufficient.id, satisfied.id).clarificationChanges.find((fact): boolean => fact.key === `clarification-${requirement.id}-status`);
  assert.ok(status !== undefined);
  for (const exact of [{ kind: "resolution", id: satisfied.id }, { kind: "source-event", id: satisfied.sourceEventId }, { kind: "evidence", id: satisfied.evidenceId }]) assert.ok(status.toReferences.some((reference): boolean => reference.kind === exact.kind && reference.id === exact.id), "Satisfied status must cite its exact accountable response and evaluated capture.");
  assert.ok(status.fromReferences.some((reference): boolean => reference.kind === "resolution" && reference.id === insufficient.id));
  for (const later of [satisfied.id, satisfied.sourceEventId, satisfied.evidenceId]) assert.equal(status.fromReferences.some((reference): boolean => reference.id === later), false, "An earlier insufficient status cannot cite the later satisfying response or capture.");
  const packet = createUncertaintyComparisonPacket(state, fixture.decisionId, requirement.id, insufficient.id, createdAt);
  assert.equal(packet.packetSchemaVersion, 2);
  assert.deepEqual(packet.clarification.requirements, [requirement]);
  assert.deepEqual(packet.clarification.resolutions, [insufficient]);
  const content = JSON.stringify(packet), inspected = inspectComparisonPacket(content);
  assert.deepEqual(inspected.comparison.clarificationContexts?.from, required.clarificationContext);
  assert.deepEqual(inspected.comparison.clarificationContexts?.to, attempted.clarificationContext);
  for (const future of [satisfied.id, fixture.productionCaptureId, replacement.id, replacement.newReviewId, terminal.id]) assert.equal(content.includes(future), false, "Packet endpoint metadata and focused records exclude later captures, responses and outcomes.");
  assert.throws((): void => { parseHistoryExport(content); }, z.ZodError, "Packet v2 is not an operational recovery file.");
  for (const value of [
    { ...packet, clarification: { ...packet.clarification, unsupportedField: true } },
    { ...packet, clarification: { ...packet.clarification, requirements: [{ ...requirement, unsupportedField: true }] } },
    { ...packet, clarification: { ...packet.clarification, resolutions: [{ ...insufficient, unsupportedField: true }] } },
    { ...packet, clarification: { ...packet.clarification, requirements: [{ ...requirement, reviewId: randomUUID() }] } },
    { ...packet, clarification: { ...packet.clarification, resolutions: [{ ...insufficient, evidenceId: randomUUID() }] } },
    { ...packet, clarification: { ...packet.clarification, resolutions: [{ ...insufficient, actor: "OTHER_REVIEWER" }] } },
    { ...packet, clarification: { ...packet.clarification, resolutions: [...packet.clarification.resolutions, satisfied] } },
    { ...packet, clarification: { ...packet.clarification, requirements: [requirement, requirement] } },
    { ...packet, from: { ...packet.from, eventId: randomUUID() } },
    { ...packet, decisionId: state.history.originalDecisions[0]?.decision.id },
    { ...packet, from: { ...packet.from, includedEventIds: packet.from.includedEventIds.filter((id): boolean => id !== requirement.id) } },
    { ...packet, createdAt: "2020-01-01T00:00:00.000Z" },
  ]) assert.throws((): void => { inspectComparisonPacket(JSON.stringify(value)); });
  const terminalPacket = createUncertaintyComparisonPacket(state, fixture.decisionId, satisfied.id, "latest", createdAt);
  assert.deepEqual(inspectComparisonPacket(JSON.stringify(terminalPacket)).comparison.clarificationContexts?.to, uncertaintyBasisAt(state, fixture.decisionId, "latest").clarificationContext);
  const earlierPacket = createUncertaintyComparisonPacket(state, fixture.decisionId, fixture.deferralId, fixture.deferralId, createdAt);
  assert.throws((): void => { inspectComparisonPacket(JSON.stringify({ ...earlierPacket, createdAt: before.event?.recordedAt })); }, /enroll|creation|predate|time/i, "Creation cannot predate preserved envelope enrollment even when both cuts precede it.");
  const sameTimeRequirement = UncertaintyStateSchema.parse({ ...fixture.required, createdAt: before.event?.recordedAt, requirements: [{ ...requirement, recordedAt: before.event?.recordedAt }] });
  assert.deepEqual(uncertaintyBasisAt(sameTimeRequirement, fixture.decisionId, fixture.deferralId).clarificationContext.requirements, []);
  assert.equal(uncertaintyBasisAt(sameTimeRequirement, fixture.decisionId, requirement.id).clarificationContext.requirements[0]?.status, "unresolved", "A referenced deferral establishes same-time causal order.");
  const production = state.history.sources.find((capture): boolean => capture.id === fixture.productionCaptureId);
  assert.ok(production !== undefined);
  const sameTimeResponse = UncertaintyStateSchema.parse({ ...fixture.satisfied, resolutions: [insufficient, { ...satisfied, recordedAt: production.recordedAt }] });
  assert.equal(uncertaintyBasisAt(sameTimeResponse, fixture.decisionId, production.id).clarificationContext.requirements[0]?.status, "insufficient");
  assert.equal(uncertaintyBasisAt(sameTimeResponse, fixture.decisionId, satisfied.id).clarificationContext.requirements[0]?.status, "satisfied", "A response is causally after its exact same-time evidence capture.");
  const tiedResponses = UncertaintyStateSchema.parse({ ...fixture.satisfied, history: { ...fixture.satisfied.history, sources: fixture.satisfied.history.sources.map((capture) => capture.id === production.id ? { ...capture, recordedAt: insufficient.recordedAt, evidence: { ...capture.evidence, capturedAt: insufficient.recordedAt } } : capture) }, resolutions: [insufficient, { ...satisfied, recordedAt: insufficient.recordedAt }] });
  assert.deepEqual(uncertaintyBasisAt(tiedResponses, fixture.decisionId, satisfied.id).clarificationContext.requirements[0]?.resolutions.map((response): string => response.result), ["insufficient", "satisfied"], "A later same-array response preserves its earlier attempt and exact capture as causal parents.");
  assert.throws((): void => { uncertaintyBasisAt(tiedResponses, fixture.decisionId, insufficient.id); }, /ambiguous/i, "The earlier response and unrelated same-time new capture have no invented order.");
  const unrelatedTie = UncertaintyStateSchema.parse({ ...state, resolutions: [insufficient, { ...satisfied, recordedAt: replacement.recordedAt }] });
  for (const id of [satisfied.id, replacement.id]) {
    assert.throws((): void => { uncertaintyBasisAt(unrelatedTie, fixture.decisionId, id); }, /ambiguous/i);
    assert.throws((): void => { createUncertaintyComparisonPacket(unrelatedTie, fixture.decisionId, id, "latest", createdAt); }, /ambiguous/i);
  }
  assert.equal(uncertaintyBasisAt(unrelatedTie, fixture.decisionId, "latest").clarificationContext.requirements[0]?.status, "satisfied", "Latest can preserve both records without inventing their order.");
  const count = uncertaintyBasisEvents(state, fixture.decisionId).length;
  const added = Array.from({ length: 257 - count }, (_, index: number): UncertaintyState["history"]["sources"][number] => {
    const recordedAt = new Date(Date.parse("2026-10-06T00:00:20.000Z") + index * 1000).toISOString();
    return { id: randomUUID(), recordedAt, evidence: { ...production.evidence, id: randomUUID(), capturedAt: recordedAt, sourceNote: "Synthetic bounded journal history retains independent permission declarations and unobserved runtime." } };
  });
  const atLimit = UncertaintyStateSchema.parse({ ...state, history: { ...state.history, sources: [...state.history.sources, ...added.slice(0, added.length - 1)] } });
  assert.equal(uncertaintyBasisEvents(atLimit, fixture.decisionId).length, 256);
  assert.equal(createUncertaintyComparisonPacket(atLimit, fixture.decisionId, "latest", "latest", createdAt).from.includedEventIds.length, 256);
  const overLimit = UncertaintyStateSchema.parse({ ...state, history: { ...state.history, sources: [...state.history.sources, ...added] } }), overLimitBytes = JSON.stringify(overLimit);
  assert.throws((): void => { uncertaintyBasisAt(overLimit, fixture.decisionId, "latest"); }, /256|bound|at most/i);
  assert.throws((): void => { createUncertaintyComparisonPacket(overLimit, fixture.decisionId, "latest", "latest", createdAt); }, /256|bound|at most/i);
  assert.equal(JSON.stringify(overLimit), overLimitBytes);
  const largePairs = Array.from({ length: 120 }, (_, index: number) => {
    const captureTime = new Date(Date.parse("2026-10-06T00:00:20.000Z") + index * 2000).toISOString(), responseTime = new Date(Date.parse(captureTime) + 1000).toISOString();
    const capture: UncertaintyState["history"]["sources"][number] = { id: randomUUID(), recordedAt: captureTime, evidence: { ...production.evidence, id: randomUUID(), capturedAt: captureTime, environment: "Unknown", sourceNote: "界".repeat(1000) } };
    const response: UncertaintyState["resolutions"][number] = { ...insufficient, id: randomUUID(), sourceEventId: capture.id, evidenceId: capture.evidence.id, recordedAt: responseTime, rationale: "界".repeat(2000) };
    return { capture, response };
  });
  const large = UncertaintyStateSchema.parse({ ...fixture.insufficient, history: { ...fixture.insufficient.history, sources: [...fixture.insufficient.history.sources, ...largePairs.map((pair) => pair.capture)] }, resolutions: [...fixture.insufficient.resolutions, ...largePairs.map((pair) => pair.response)] });
  const largeEvents = uncertaintyBasisEvents(large, fixture.decisionId);
  assert.ok(largeEvents.length < 256);
  const small = createUncertaintyComparisonPacket(fixture.insufficient, fixture.decisionId, "latest", "latest", createdAt);
  const largeEndpoint = { selection: "frozen-latest", eventId: null, includedEventIds: largeEvents.map((event): string => event.id) };
  const oversized = JSON.stringify({ ...small, from: largeEndpoint, to: largeEndpoint, archive: { ...small.archive, sources: large.history.sources }, clarification: { ...small.clarification, resolutions: large.resolutions } }, null, 2);
  assert.ok(oversized.length < MAX_COMPARISON_PACKET_BYTES && new TextEncoder().encode(oversized).byteLength > MAX_COMPARISON_PACKET_BYTES, "A valid large v2 archive exercises actual UTF-8 bytes rather than character count.");
  assert.throws((): void => { createUncertaintyComparisonPacket(large, fixture.decisionId, "latest", "latest", createdAt); }, /MiB|limit|size/i);
  assert.throws((): void => { inspectComparisonPacket(oversized); }, /MiB|limit|size/i);
  assert.equal(JSON.stringify(state), preserved);
  assert.equal(JSON.stringify(packet), content);
}

type StorageBytes = Readonly<{ local: Record<string, string>; session: Record<string, string> }>;
async function bytes(page: Page): Promise<StorageBytes> {
  return page.evaluate((): StorageBytes => ({ local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage)) }));
}
async function ready(page: Page): Promise<void> { await page.locator('html[data-app-ready="true"]').waitFor(); }
async function restore(page: Page, url: string, state: UncertaintyState): Promise<void> {
  await page.goto(`${url}/impact.html?format=7`); await ready(page);
  const original = await bytes(page);
  await page.getByTestId("import-toggle").click();
  await page.getByTestId("import-file").setInputFiles({ name: "synthetic-clarification-history.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(uncertaintyHistoryExport(state, createdAt))) });
  await page.getByTestId("inspect-import").click(); await page.getByTestId("import-preview").waitFor({ state: "visible" });
  assert.deepEqual(await bytes(page), original);
  const navigation = page.waitForEvent("domcontentloaded"); await page.getByTestId("confirm-import").click(); await navigation; await ready(page);
  assert.equal(new URL(page.url()).searchParams.get("session"), state.id);
}
async function upload(page: Page, content: string): Promise<void> {
  await page.getByTestId("packet-file").setInputFiles({ name: "synthetic-clarification-comparison.json", mimeType: "application/json", buffer: Buffer.from(content) });
  assert.equal(await page.getByTestId("packet-result").isVisible(), false);
  assert.equal(await page.getByTestId("packet-print").isDisabled(), true);
  await page.getByTestId("packet-inspect").focus(); await page.keyboard.press("Enter");
}
async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(result.violations.map((item): string => `${item.id}: ${item.nodes.map((node): string => node.target.join(", ")).join(", ")}`), []);
  assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true);
}
async function reference(page: Page, key: string, index: number, kind: string, id: string): Promise<void> {
  const toggle = page.getByTestId(`basis-refs-to-${key}-toggle`);
  if (!(await toggle.locator("..").evaluate((element): boolean => element instanceof HTMLDetailsElement && element.open))) await toggle.click();
  const button = page.getByTestId(`basis-ref-to-${key}-${index}`);
  assert.equal(await button.getAttribute("data-basis-ref-kind"), kind); assert.equal(await button.getAttribute("data-basis-ref-id"), id);
  await button.focus(); await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate((): Readonly<{ id: string | undefined; kind: string | undefined; endpoint: boolean }> => {
    const target = document.activeElement, endpoint = document.getElementById("basis-latest");
    if (!(target instanceof HTMLElement) || endpoint === null) throw new ReferenceError("Journal reference navigation requires its exact endpoint record.");
    return { id: target.dataset.basisRefId, kind: target.dataset.basisRefKind, endpoint: endpoint.contains(target) };
  }), { id, kind, endpoint: true });
}

/** Native v7 export, isolated packet inspection and recovery remain distinct operations with preserved bytes. */
export async function checkUncertaintyBasis(browser: Browser, url: string): Promise<void> {
  checkUncertaintyBasisModel();
  const fixture = uncertaintyFixture(), state = fixture.completed, requirement = state.requirements[0], response = state.resolutions[1];
  assert.ok(requirement !== undefined && response !== undefined);
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const fresh = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
  for (const context of [desktop, fresh, mobile]) context.setDefaultTimeout(5000);
  try {
    const page = await desktop.newPage(), reader = await fresh.newPage(), narrow = await mobile.newPage();
    const errors: Error[] = [], external: string[] = [];
    for (const item of [page, reader, narrow]) {
      item.on("pageerror", (error: Error): void => { errors.push(error); });
      item.on("request", (request): void => { const target = new URL(request.url()); if ((target.protocol === "http:" || target.protocol === "https:") && target.origin !== new URL(url).origin) external.push(target.href); });
    }
    await restore(page, url, state);
    const preserved = await bytes(page);
    assert.equal(preserved.local[uncertaintyStorageKey(state.id)], JSON.stringify(state));
    await page.getByTestId("basis-decision").selectOption(fixture.decisionId);
    await page.getByTestId("basis-event").selectOption(requirement.id);
    await page.getByTestId("basis-compare-event").selectOption(response.id);
    assert.equal(await page.getByTestId("basis-error").isVisible(), false);
    assert.equal(await page.getByTestId(`basis-historical-requirement-${requirement.id}-question`).innerText(), requirement.question);
    assert.equal(await page.getByTestId(`basis-historical-requirement-${requirement.id}-required-evidence`).innerText(), requirement.requiredEvidence);
    assert.equal(await page.getByTestId(`basis-historical-requirement-${requirement.id}-trigger`).innerText(), requirement.triggerDescription);
    assert.equal(await page.getByTestId(`basis-historical-requirement-${requirement.id}-actor`).innerText(), requirement.actor);
    assert.equal(await page.getByTestId(`basis-historical-resolution-${response.id}-result`).count(), 0);
    assert.equal(await page.getByTestId(`basis-latest-resolution-${response.id}-result`).innerText(), response.result);
    assert.equal(await page.getByTestId("basis-latest").getAttribute("data-pending-review-id"), fixture.reviewId);
    const downloading = page.waitForEvent("download"); await page.getByTestId("basis-export").focus(); await page.keyboard.press("Enter");
    const content = await readFile(z.string().parse(await (await downloading).path()), "utf8");
    const inspected = inspectComparisonPacket(content);
    assert.equal(inspected.packet.packetSchemaVersion, 2); assert.equal(inspected.packet.from.eventId, requirement.id); assert.equal(inspected.packet.to.eventId, response.id);
    assert.deepEqual(await bytes(page), preserved);
    const historyDownload = page.waitForEvent("download"); await page.getByTestId("shared-export").click();
    const history = await readFile(z.string().parse(await (await historyDownload).path()), "utf8");
    assert.deepEqual(UncertaintyHistoryExportSchema.parse(JSON.parse(history)).session, state);
    await page.reload(); await ready(page); assert.deepEqual(await bytes(page), preserved);
    await reader.goto(`${url}/comparison.html`); await ready(reader);
    await upload(reader, content); await reader.getByTestId("packet-result").waitFor({ state: "visible" });
    assert.equal(await reader.getByTestId("packet-error").isVisible(), false);
    assert.deepEqual(await bytes(reader), { local: {}, session: {} });
    assert.equal(await reader.getByTestId(`basis-historical-resolution-${response.id}-result`).count(), 0);
    assert.equal(await reader.getByTestId(`basis-latest-resolution-${response.id}-result`).innerText(), response.result);
    await reference(reader, `clarification-${requirement.id}-status`, 0, "requirement", requirement.id);
    await reference(reader, `clarification-${requirement.id}-responses`, 4, "resolution", response.id);
    await reference(reader, `clarification-${requirement.id}-responses`, 6, "source-event", response.sourceEventId);
    await reader.getByTestId(`basis-latest-resolution-${response.id}-references`).click();
    assert.equal(await reader.getByTestId(`basis-latest-resolution-${response.id}-references-source-event`).innerText(), response.sourceEventId);
    assert.equal(await reader.getByTestId(`basis-latest-resolution-${response.id}-references-evidence`).innerText(), response.evidenceId);
    await accessible(reader);
    await reader.getByTestId("packet-result").screenshot({ path: "output/playwright/uncertainty-basis-desktop.png", animations: "disabled" });
    await reader.emulateMedia({ media: "print" });
    const pdf = await reader.pdf({ path: "output/playwright/uncertainty-basis-print.pdf", format: "A4", printBackground: false });
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-"); assert.ok(pdf.length > 1000);
    await reader.emulateMedia({ media: "screen" }); assert.deepEqual(await bytes(reader), { local: {}, session: {} });
    await upload(reader, JSON.stringify({ ...inspected.packet, from: { ...inspected.packet.from, eventId: randomUUID() } })); await reader.getByTestId("packet-error").waitFor({ state: "visible" });
    assert.equal(await reader.getByTestId("packet-result").isVisible(), false); assert.equal(await reader.getByTestId("packet-print").isDisabled(), true);
    assert.equal(await reader.getByTestId("basis-historical").innerHTML(), "");
    await upload(reader, content); await reader.getByTestId("packet-result").waitFor({ state: "visible" });
    await reader.getByTestId("packet-clear").focus(); await reader.keyboard.press("Enter");
    assert.equal(await reader.getByTestId("packet-result").isVisible(), false); assert.equal(await reader.getByTestId("packet-print").isDisabled(), true);
    await upload(reader, content); await reader.getByTestId("packet-result").waitFor({ state: "visible" });
    await reader.reload(); await ready(reader); assert.equal(await reader.getByTestId("packet-result").isVisible(), false); assert.deepEqual(await bytes(reader), { local: {}, session: {} });
    await narrow.goto(`${url}/comparison.html`); await ready(narrow); await upload(narrow, content); await narrow.getByTestId("packet-result").waitFor({ state: "visible" });
    await accessible(narrow); assert.equal(await narrow.evaluate((): string => getComputedStyle(document.documentElement).scrollBehavior), "auto");
    await narrow.getByTestId("packet-result").screenshot({ path: "output/playwright/uncertainty-basis-mobile.png", animations: "disabled" });
    assert.deepEqual(await bytes(narrow), { local: {}, session: {} });
    await reader.goto(`${url}/impact.html?format=7`); await ready(reader);
    const recoveryBytes = await bytes(reader); await reader.getByTestId("import-toggle").click();
    await reader.getByTestId("import-file").setInputFiles({ name: "comparison-is-not-history.json", mimeType: "application/json", buffer: Buffer.from(content) });
    await reader.getByTestId("inspect-import").click(); await reader.getByTestId("import-error").waitFor({ state: "visible" });
    assert.equal(await reader.getByTestId("confirm-import").isDisabled(), true); assert.deepEqual(await bytes(reader), recoveryBytes);
    assert.deepEqual(errors, []); assert.deepEqual(external, [], "Historical journal export/inspection may contact only its serving origin.");
    console.log("uncertainty_basis_smoke_passed", { exactQuestionAndResponses: true, causalSameTime: true, unrelatedTiesRejected: true, noFutureJournalLeakage: true, separateApproval: true, combinedEventBound: true, packetV2: true, nativeExportAndFreshInspection: true, oldBytesPreserved: true, operationalRecoverySeparated: true, keyboard: true, mobile: true, accessibility: true, print: true, practitionerParticipation: false });
  } finally { await desktop.close(); await fresh.close(); await mobile.close(); }
}
