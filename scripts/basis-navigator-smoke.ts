import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { basisNavigator } from "../src/basis-navigator.ts";
import type { BasisEvent } from "../src/basis-events.ts";
import { decisionBasisEvents } from "../src/basis-events.ts";
import { decisionBasisAt } from "../src/decision-basis.ts";
import { uncertaintyBasisAt, uncertaintyBasisEvents } from "../src/uncertainty-basis.ts";
import { UncertaintyStateSchema } from "../src/uncertainty-model.ts";
import type { UncertaintyState } from "../src/uncertainty-model.ts";
import { appendClarificationEvidence, openClarificationReview, appendClarificationOutcome, ClarificationStateSchema } from "../src/clarification-model.ts";
import type { ClarificationState } from "../src/clarification-model.ts";
import { uncertaintyHistoryExport, UncertaintyHistoryExportSchema } from "../src/uncertainty-export.ts";
import { clarificationHistoryExport, ClarificationHistoryExportSchema } from "../src/clarification-export.ts";
import { uncertaintyStorageKey } from "../src/uncertainty-storage.ts";
import { inspectComparisonPacket } from "../src/comparison-packet.ts";
import { uncertaintyFixture } from "./uncertainty-smoke.ts";
import { basisFixture, tiedFixture, ambiguousFixture } from "./basis-smoke.ts";

const createdAt: string = "2026-10-07T00:00:00.000Z";

/** The compact navigator projects exact causal cuts without imposing an order on incomparable tied records. */
export function checkBasisNavigatorModel(): void {
  const fixture = uncertaintyFixture(), events = uncertaintyBasisEvents(fixture.completed, fixture.decisionId), preserved = JSON.stringify(events);
  const requirement = fixture.completed.requirements[0], response = fixture.completed.resolutions[1], replacement = fixture.completed.history.replacements[0];
  assert.ok(requirement !== undefined && response !== undefined && replacement !== undefined);
  const projection = basisNavigator(events, requirement.id, response.id), nodes = projection.groups.flatMap((group) => group.nodes);
  assert.deepEqual(nodes.map((node) => node.event), events, "Nodes retain exact canonical records, member aliases and direct predecessor edges.");
  assert.deepEqual(projection.from.includedEventIds, uncertaintyBasisAt(fixture.completed, fixture.decisionId, requirement.id).includedEventIds);
  assert.deepEqual(projection.to.includedEventIds, uncertaintyBasisAt(fixture.completed, fixture.decisionId, response.id).includedEventIds);
  assert.equal(nodes.find((node): boolean => node.event.id === requirement.id)?.fromSelected, true);
  assert.equal(nodes.find((node): boolean => node.event.id === response.id)?.toSelected, true);
  assert.equal(nodes.find((node): boolean => node.event.id === replacement.id)?.toIncluded, false, "The navigator cannot show a later review replacement as part of a satisfied response cut.");
  const alias = basisNavigator(events, replacement.id, replacement.newReviewId);
  assert.equal(alias.to.requestedId, replacement.newReviewId);
  assert.equal(alias.to.canonicalEventId, replacement.id);
  assert.deepEqual(alias.from.includedEventIds, alias.to.includedEventIds);
  assert.deepEqual(nodes.find((node): boolean => node.event.id === replacement.id)?.event.memberIds, [replacement.id, replacement.newReviewId]);
  for (const [from, to] of [[response.id, requirement.id], [response.id, response.id], ["latest", requirement.id], ["latest", "latest"]] as const) {
    const view = basisNavigator(events, from, to);
    assert.deepEqual(view.from.includedEventIds, uncertaintyBasisAt(fixture.completed, fixture.decisionId, from).includedEventIds);
    assert.deepEqual(view.to.includedEventIds, uncertaintyBasisAt(fixture.completed, fixture.decisionId, to).includedEventIds);
  }
  const legacy = basisFixture(), legacyEvents = decisionBasisEvents(legacy.state, legacy.decisionId), legacyProjection = basisNavigator(legacyEvents, legacy.firstOutcomeId, legacy.deferralId);
  assert.deepEqual(legacyProjection.from.includedEventIds, decisionBasisAt(legacy.state, legacy.decisionId, legacy.firstOutcomeId).includedEventIds);
  assert.deepEqual(legacyProjection.to.includedEventIds, decisionBasisAt(legacy.state, legacy.decisionId, legacy.deferralId).includedEventIds);
  const tied = tiedFixture(), ordered = basisNavigator(decisionBasisEvents(tied.state, tied.decisionId), tied.captureId, tied.reviewId);
  assert.equal(ordered.from.status, "available"); assert.equal(ordered.to.status, "available");
  assert.deepEqual(ordered.from.includedEventIds, decisionBasisAt(tied.state, tied.decisionId, tied.captureId).includedEventIds);
  assert.equal(ordered.from.includedEventIds.includes(tied.reviewId), false);
  assert.equal(ordered.to.includedEventIds.includes(tied.captureId), true);
  const exactTimes = decisionBasisEvents(tied.state, tied.decisionId).map((event): BasisEvent => event.id === tied.captureId ? { ...event, recordedAt: event.recordedAt.replace(".000Z", "Z") } : event);
  const equivalentTimes = basisNavigator(exactTimes, tied.captureId, tied.reviewId), tiedGroup = equivalentTimes.groups.find((group): boolean => group.nodes.some((node): boolean => node.event.id === tied.captureId));
  assert.ok(tiedGroup !== undefined && tiedGroup.timestamps.length === 2, "One numeric instant retains both exact recording timestamp spellings.");
  assert.deepEqual(equivalentTimes.from.includedEventIds, ordered.from.includedEventIds); assert.deepEqual(equivalentTimes.to.includedEventIds, ordered.to.includedEventIds);
  const ambiguous = ambiguousFixture(), ambiguousEvents = decisionBasisEvents(ambiguous.state, ambiguous.decisionId), unavailable = basisNavigator(ambiguousEvents, ambiguous.captureId, "latest");
  assert.equal(unavailable.from.status, "unavailable"); assert.ok(unavailable.from.ambiguousWith.length > 0); assert.deepEqual(unavailable.from.includedEventIds, []);
  assert.equal(unavailable.to.status, "available"); assert.equal(unavailable.to.includedEventIds.length, ambiguousEvents.length);
  const absent = randomUUID(), missing = basisNavigator(events, absent, response.id);
  assert.equal(missing.from.requestedId, absent); assert.equal(missing.from.canonicalEventId, null); assert.equal(missing.from.status, "unavailable");
  assert.deepEqual(missing.from.includedEventIds, []); assert.equal(missing.groups.flatMap((group) => group.nodes).some((node): boolean => node.fromIncluded), false);
  const baseline = legacyEvents[0]; assert.ok(baseline !== undefined);
  const bounded = Array.from({ length: 257 }, (_, index: number): BasisEvent => ({ ...baseline, id: randomUUID(), recordedAt: new Date(Date.parse(createdAt) + index * 1000).toISOString(), memberIds: [], predecessorIds: [] })).map((event): BasisEvent => ({ ...event, memberIds: [event.id] }));
  assert.equal(basisNavigator(bounded.slice(0, 256), "latest", "latest").from.includedEventIds.length, 256);
  assert.throws((): void => { basisNavigator(bounded, "latest", "latest"); }, /256|bound|at most/i);
  assert.throws((): void => { basisNavigator([baseline, baseline], "latest", "latest"); }, /distinct|duplicate|unique/i);
  assert.throws((): void => { basisNavigator([{ ...baseline, recordedAt: "not a recording time" }], "latest", "latest"); }, /time|date|invalid|record/i);
  assert.throws((): void => { basisNavigator([{ ...baseline, predecessorIds: [randomUUID()] }], "latest", "latest"); }, /refer|dependency|exist|event/i);
  const second = legacyEvents[1]; assert.ok(second !== undefined);
  assert.throws((): void => { basisNavigator([{ ...baseline, predecessorIds: [second.id] }, { ...second, predecessorIds: [] }], "latest", "latest"); }, /chronolog|contradict|predat|time|later/i);
  assert.throws((): void => { basisNavigator([{ ...baseline, predecessorIds: [second.id] }, { ...second, recordedAt: baseline.recordedAt, predecessorIds: [baseline.id] }], "latest", "latest"); }, /cycle/i);
  assert.equal(JSON.stringify(events), preserved, "Rendering selections and invalid boundaries preserve the input event graph.");
}

type Workspace = ClarificationState | UncertaintyState;
type Side = "from" | "to";
type StorageBytes = Readonly<{ local: Record<string, string>; session: Record<string, string> }>;
async function bytes(page: Page): Promise<StorageBytes> {
  return page.evaluate((): StorageBytes => ({ local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage)) }));
}
async function ready(page: Page): Promise<void> { await page.locator('html[data-app-ready="true"]').waitFor(); }
async function restore(page: Page, url: string, state: Workspace): Promise<void> {
  const content = JSON.stringify(state.schemaVersion === 7 ? uncertaintyHistoryExport(state, createdAt) : clarificationHistoryExport(state, createdAt));
  await page.goto(`${url}/impact.html?format=${state.schemaVersion}`); await ready(page);
  const preserved = await bytes(page);
  await page.getByTestId("import-toggle").click(); await page.getByTestId("import-file").setInputFiles({ name: "synthetic-navigator-history.json", mimeType: "application/json", buffer: Buffer.from(content) });
  await page.getByTestId("inspect-import").click(); await page.getByTestId("import-preview").waitFor({ state: "visible" }); assert.deepEqual(await bytes(page), preserved);
  const navigation = page.waitForEvent("domcontentloaded"); await page.getByTestId("confirm-import").click(); await navigation; await ready(page);
  assert.equal(new URL(page.url()).searchParams.get("session"), state.id);
}
async function choose(page: Page, side: Side, id: string): Promise<void> {
  const control = page.getByTestId(`basis-nav-${side}-${id}`);
  await control.focus(); await page.keyboard.press("Enter");
  assert.equal(await page.getByTestId(side === "from" ? "basis-event" : "basis-compare-event").inputValue(), id);
  assert.equal(await page.evaluate((): string | undefined => document.activeElement instanceof HTMLElement ? document.activeElement.dataset.testid : undefined), `basis-nav-${side}-${id}`, "Navigator selection keeps keyboard focus on its stable control after rendering.");
}
async function openRecord(page: Page, side: Side, eventId: string, index: number, kind: string, id: string): Promise<void> {
  await page.getByTestId(`basis-nav-details-${eventId}`).click();
  const control = page.getByTestId(`basis-nav-open-${side}-${eventId}-${index}`);
  assert.equal(await control.getAttribute("data-basis-ref-kind"), kind); assert.equal(await control.getAttribute("data-basis-ref-id"), id);
  await control.focus(); await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate((endpoint: string): Readonly<{ id: string | undefined; kind: string | undefined; contained: boolean }> => {
    const target = document.activeElement, column = document.getElementById(endpoint);
    if (!(target instanceof HTMLElement) || column === null) throw new ReferenceError("Navigator record focus requires its exact endpoint column.");
    return { id: target.dataset.basisRefId, kind: target.dataset.basisRefKind, contained: column.contains(target) };
  }, side === "from" ? "basis-historical" : "basis-latest"), { id, kind, contained: true });
}
async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(result.violations.map((item): string => `${item.id}: ${item.nodes.map((node): string => node.target.join(", ")).join(", ")}`), []);
  assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true);
}
async function screenshot(page: Page, testId: string, path: string): Promise<void> {
  const navigator = page.getByTestId(testId);
  await navigator.evaluate((element: HTMLElement): void => element.scrollIntoView({ block: "start", behavior: "instant" }));
  const box = await navigator.boundingBox(), viewport = page.viewportSize(); assert.ok(box !== null && viewport !== null);
  assert.ok(box.x >= 0 && box.y >= 0 && box.width <= viewport.width);
  await page.screenshot({ path, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, viewport.height - box.y) }, animations: "disabled" });
}
async function download(page: Page, id: string): Promise<string> {
  const waiting = page.waitForEvent("download"); await page.getByTestId(id).focus(); await page.keyboard.press("Enter");
  return readFile(z.string().parse(await (await waiting).path()), "utf8");
}
function cyclicHistory(): Readonly<{ state: ClarificationState; decisionId: string }> {
  const fixture = tiedFixture(), latest = fixture.state.sources.at(-1), original = fixture.state.originalDecisions.find((record): boolean => record.decision.id === fixture.decisionId);
  assert.ok(latest !== undefined && original !== undefined);
  const capture = appendClarificationEvidence(fixture.state, { capturedAt: latest.recordedAt, environment: "Unknown", requestedPermissions: ["documents:read", "documents:write", "documents:delete"], grantedPermissions: ["documents:read"], sourceNote: "Synthetic tied later capture preserves its recorded source and declared permission boundary." }, randomUUID(), randomUUID(), latest.recordedAt);
  const review = openClarificationReview(capture, fixture.decisionId, randomUUID(), latest.recordedAt);
  const state = appendClarificationOutcome(review, fixture.decisionId, { actor: original.decision.actor, outcome: "revise", acceptedPermissions: ["documents:read", "documents:write", "documents:delete"], statement: "Synthetic request scope accepts read, write and delete for this exact captured boundary; runtime remains unobserved.", rationale: "Synthetic accountable review preserves the exact capture and separately declared grants without inferring deployment or runtime assurance." }, randomUUID(), latest.recordedAt);
  return { state: ClarificationStateSchema.parse({ ...state, outcomes: state.outcomes.toReversed() }), decisionId: fixture.decisionId };
}

/** Real recovered history, native navigation and portable exports remain read-only across keyboard and narrow-screen use. */
export async function checkBasisNavigator(browser: Browser, url: string): Promise<void> {
  checkBasisNavigatorModel();
  const fixture = uncertaintyFixture(), state = fixture.completed, requirement = state.requirements[0], insufficient = state.resolutions[0], satisfied = state.resolutions[1], replacement = state.history.replacements[0], terminal = state.history.outcomes.at(-1);
  assert.ok(requirement !== undefined && insufficient !== undefined && satisfied !== undefined && replacement !== undefined && terminal !== undefined);
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const fresh = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
  for (const context of [desktop, fresh, mobile]) context.setDefaultTimeout(5000);
  try {
    const page = await desktop.newPage(), reader = await fresh.newPage(), narrow = await mobile.newPage(), errors: Error[] = [], external: string[] = [];
    for (const item of [page, reader, narrow]) {
      item.on("pageerror", (error: Error): void => { errors.push(error); });
      item.on("request", (request): void => { const target = new URL(request.url()); if ((target.protocol === "http:" || target.protocol === "https:") && target.origin !== new URL(url).origin) external.push(target.href); });
    }
    await restore(page, url, state); const preserved = await bytes(page);
    assert.equal(preserved.local[uncertaintyStorageKey(state.id)], JSON.stringify(state));
    await page.getByTestId("basis-decision").selectOption(fixture.decisionId);
    await choose(page, "from", requirement.id);
    for (const id of [insufficient.id, satisfied.id, replacement.id, terminal.id]) {
      await choose(page, "to", id);
      assert.equal(await page.getByTestId("basis-error").isVisible(), false);
      assert.equal(await page.getByTestId("basis-latest").getAttribute("data-event-id"), id);
      assert.equal(await page.getByTestId("basis-comparison-summary").getAttribute("data-direction"), "forward");
      assert.equal(await page.getByTestId(`basis-nav-event-${id}`).getAttribute("data-to-state"), "included");
      assert.equal(await page.getByTestId(`basis-nav-event-${id}`).getAttribute("data-to-selected"), "true");
    }
    await choose(page, "to", satisfied.id);
    assert.equal(await page.getByTestId("basis-latest").getAttribute("data-pending-review-id"), fixture.reviewId);
    await openRecord(page, "to", satisfied.id, 0, "resolution", satisfied.id);
    await openRecord(page, "from", requirement.id, 0, "requirement", requirement.id);
    await choose(page, "from", satisfied.id); await choose(page, "to", insufficient.id);
    assert.equal(await page.getByTestId("basis-comparison-summary").getAttribute("data-direction"), "backward");
    await choose(page, "to", satisfied.id); assert.equal(await page.getByTestId("basis-comparison-summary").getAttribute("data-direction"), "same");
    await choose(page, "to", replacement.id);
    assert.equal(await page.getByTestId(`basis-nav-event-${replacement.id}`).getAttribute("data-to-selected"), "true");
    await openRecord(page, "to", replacement.id, 1, "review", replacement.newReviewId);
    await choose(page, "from", requirement.id); await choose(page, "to", satisfied.id);
    const packet = await download(page, "basis-export"), inspected = inspectComparisonPacket(packet);
    assert.equal(inspected.packet.packetSchemaVersion, 2); assert.equal(inspected.packet.from.eventId, requirement.id); assert.equal(inspected.packet.to.eventId, satisfied.id);
    await reader.goto(`${url}/comparison.html`); await ready(reader);
    await reader.getByTestId("packet-file").setInputFiles({ name: "navigator-selected-comparison.json", mimeType: "application/json", buffer: Buffer.from(packet) }); await reader.getByTestId("packet-inspect").click(); await reader.getByTestId("packet-result").waitFor({ state: "visible" });
    assert.equal(await reader.getByTestId("basis-navigator").count(), 0, "Packet inspection retains its frozen contract without operational navigator controls.");
    assert.equal(await reader.getByTestId("basis-latest").getAttribute("data-event-id"), satisfied.id); assert.deepEqual(await bytes(reader), { local: {}, session: {} });
    assert.deepEqual(UncertaintyHistoryExportSchema.parse(JSON.parse(await download(page, "shared-export"))).session, state); assert.deepEqual(await bytes(page), preserved);
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.getByTestId("basis-navigator").isVisible(), false, "Print omits interactive scrolling navigation rather than clipping its event cards.");
    assert.equal(await page.getByTestId("basis-historical").isVisible(), true); assert.equal(await page.getByTestId("basis-latest").isVisible(), true);
    assert.deepEqual(await bytes(page), preserved, "Print presentation cannot record or restore history.");
    await page.emulateMedia({ media: "screen" });
    await accessible(page); await screenshot(page, "basis-navigator", "output/playwright/basis-navigator-desktop.png");
    const other = state.history.originalDecisions.find((record): boolean => record.decision.id !== fixture.decisionId); assert.ok(other !== undefined);
    await page.getByTestId("basis-decision").selectOption(other.decision.id);
    assert.equal(await page.getByTestId("basis-event").inputValue(), requirement.id); assert.equal(await page.getByTestId("basis-compare-event").inputValue(), satisfied.id);
    assert.equal(await page.getByTestId("basis-error").isVisible(), true); assert.equal(await page.getByTestId("basis-export").isDisabled(), true);
    await choose(page, "from", "latest"); assert.equal(await page.getByTestId("basis-export").isDisabled(), true);
    await choose(page, "to", "latest"); assert.equal(await page.getByTestId("basis-export").isEnabled(), true);
    assert.deepEqual(await bytes(page), preserved); await page.reload(); await ready(page); assert.deepEqual(await bytes(page), preserved);
    const tiedState = UncertaintyStateSchema.parse({ ...state, id: randomUUID(), resolutions: [insufficient, { ...satisfied, recordedAt: replacement.recordedAt }] });
    await restore(page, url, tiedState); const tiedBytes = await bytes(page);
    await choose(page, "from", satisfied.id); assert.equal(await page.getByTestId("basis-error").isVisible(), true); assert.equal(await page.getByTestId("basis-export").isDisabled(), true);
    await choose(page, "from", "latest"); assert.equal(await page.getByTestId("basis-error").isVisible(), false); assert.deepEqual(await bytes(page), tiedBytes);
    const legacy = basisFixture(); await restore(page, url, legacy.state); const legacyBytes = await bytes(page);
    await page.getByTestId("basis-decision").selectOption(legacy.decisionId); await choose(page, "from", legacy.firstOutcomeId); await choose(page, "to", legacy.deferralId);
    assert.equal(inspectComparisonPacket(await download(page, "basis-export")).packet.packetSchemaVersion, 1);
    assert.deepEqual(ClarificationHistoryExportSchema.parse(JSON.parse(await download(page, "shared-export"))).session, legacy.state); assert.deepEqual(await bytes(page), legacyBytes);
    const cyclic = cyclicHistory(); await restore(page, url, cyclic.state); const cyclicBytes = await bytes(page);
    assert.ok(await page.getByTestId("basis-navigator").locator("[data-event-id]").count() > 0, "The unaffected initial Production graph is available before changing decisions.");
    await page.getByTestId("basis-decision").selectOption(cyclic.decisionId);
    assert.equal(await page.getByTestId("basis-nav-error").isVisible(), true); assert.equal(await page.getByTestId("basis-export").isDisabled(), true);
    assert.equal(await page.getByTestId("basis-navigator").locator("[data-event-id], [data-basis-nav-event-id], [data-basis-ref-id]").count(), 0, "A contradictory selected graph clears previously available cards and record controls.");
    assert.equal(await page.getByTestId("basis-historical").getAttribute("data-event-id"), null); assert.equal(await page.getByTestId("basis-latest").getAttribute("data-event-id"), null);
    assert.deepEqual(await bytes(page), cyclicBytes);
    await restore(narrow, url, state); const mobileBytes = await bytes(narrow);
    await narrow.getByTestId("basis-decision").selectOption(fixture.decisionId); await choose(narrow, "from", requirement.id); await choose(narrow, "to", insufficient.id); await choose(narrow, "to", satisfied.id);
    await accessible(narrow); assert.equal(await narrow.evaluate((): string => getComputedStyle(document.documentElement).scrollBehavior), "auto");
    await screenshot(narrow, "basis-nav-scroll", "output/playwright/basis-navigator-mobile.png"); assert.deepEqual(await bytes(narrow), mobileBytes);
    assert.deepEqual(errors, []); assert.deepEqual(external, [], "A navigator reads local records and contacts only its serving origin.");
    console.log("basis_navigator_smoke_passed", { exactGraphAndCuts: true, atomicAliases: true, causalTiesAndAmbiguity: true, nativeSelectorSynchronization: true, keyboardFocusPreserved: true, exactRecordFocus: true, noFallbackOnDecisionChange: true, separateApproval: true, packetVersionsPreserved: true, historyExportReloadPreserved: true, invalidReadOnly: true, printSelectedBasisPreserved: true, mobile: true, reducedMotion: true, accessibility: true, practitionerParticipation: false });
  } finally { await desktop.close(); await fresh.close(); await mobile.close(); }
}
