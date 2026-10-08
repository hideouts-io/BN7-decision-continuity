import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { basisReviewBrief } from "../src/basis-review-brief.ts";
import { compareDecisionBases } from "../src/basis-comparison.ts";
import type { BasisComparison, BasisReference } from "../src/basis-comparison.ts";
import { compareUncertaintyDecisionBases } from "../src/uncertainty-basis.ts";
import { ClarificationStateSchema } from "../src/clarification-model.ts";
import type { ClarificationHistory, ClarificationState } from "../src/clarification-model.ts";
import { UncertaintyStateSchema } from "../src/uncertainty-model.ts";
import type { UncertaintyState } from "../src/uncertainty-model.ts";
import { uncertaintyHistoryExport, UncertaintyHistoryExportSchema } from "../src/uncertainty-export.ts";
import { clarificationHistoryExport } from "../src/clarification-export.ts";
import { createComparisonPacket, inspectComparisonPacket } from "../src/comparison-packet.ts";
import { createUncertaintyComparisonPacket } from "../src/uncertainty-comparison-packet.ts";
import { uncertaintyStorageKey } from "../src/uncertainty-storage.ts";
import { basisFixture } from "./basis-smoke.ts";
import { uncertaintyFixture } from "./uncertainty-smoke.ts";
import { basisReceiptsFixture } from "./basis-receipts-smoke.ts";

type Brief = ReturnType<typeof basisReviewBrief>;
type Section = Brief["sections"][number];
type Side = "from" | "to";
const createdAt: string = "2026-10-07T00:00:00.000Z";

function section(brief: Brief, key: Section["key"]): Section {
  const result = brief.sections.find((item): boolean => item.key === key);
  if (result === undefined) throw new ReferenceError(`Review brief requires its ${key} section.`);
  return result;
}
function exactReference(history: ClarificationHistory, comparison: BasisComparison, side: Side, reference: BasisReference): void {
  const endpoint = comparison[side], snapshot = endpoint.historical, context = comparison.clarificationContexts?.[side];
  if (reference.kind === "decision") assert.equal(reference.id, snapshot.record.decision.id);
  else if (reference.kind === "assumption") assert.equal(reference.id, snapshot.record.assumption.id);
  else if (reference.kind === "source") assert.equal(reference.id, history.source.id);
  else if (reference.kind === "source-event" || reference.kind === "evidence") {
    const capture = history.sources.find((event): boolean => reference.kind === "source-event" ? event.id === reference.id : event.evidence.id === reference.id);
    assert.ok(capture !== undefined && endpoint.includedEventIds.includes(capture.id), "Brief evidence citations must belong to this selected endpoint's exact causal cut.");
  } else if (reference.kind === "review") assert.ok(snapshot.reviews.some((record): boolean => record.id === reference.id));
  else if (reference.kind === "outcome") assert.ok(snapshot.outcomes.some((record): boolean => record.id === reference.id));
  else if (reference.kind === "replacement") assert.ok(snapshot.replacements.some((record): boolean => record.id === reference.id));
  else if (reference.kind === "requirement") assert.ok(context?.requirements.some((record): boolean => record.requirement.id === reference.id));
  else assert.ok(context?.requirements.some((record): boolean => record.resolutions.some((response): boolean => response.id === reference.id)));
}
function inspectBrief(history: ClarificationHistory, comparison: BasisComparison): Brief {
  const preserved = JSON.stringify(comparison), brief = basisReviewBrief(comparison);
  assert.equal(brief.direction, comparison.direction);
  const original = [...comparison.changedFacts, ...comparison.receiptChanges, ...comparison.clarificationChanges];
  const changes = brief.sections.flatMap((item) => item.changes);
  assert.deepEqual(changes.map((fact): string => fact.key).toSorted(), original.map((fact): string => fact.key).toSorted(), "The brief retains every changed fact rather than hiding a lower-priority difference.");
  for (const change of changes) {
    const expected = original.find((fact): boolean => fact.key === change.key); assert.ok(expected !== undefined);
    assert.deepEqual([change.label, change.fromValue, change.toValue], [expected.label, expected.fromValue, expected.toValue]);
  }
  for (const item of brief.sections) {
    if (item.key === "human-review") assert.deepEqual(item.recordChanges, comparison.recordChanges);
    else assert.deepEqual(item.recordChanges, []);
    for (const side of ["from", "to"] as const) {
      for (const fact of item[side]) { assert.ok(fact.references.length > 0); for (const reference of fact.references) exactReference(history, comparison, side, reference); }
      for (const fact of item.changes) for (const reference of side === "from" ? fact.fromReferences : fact.toReferences) exactReference(history, comparison, side, reference);
    }
  }
  assert.equal(JSON.stringify(comparison), preserved, "Deriving a brief does not rewrite its comparison, records or selections.");
  return brief;
}

/** Brief facts and citations use only the requested cuts, never the inherited latest snapshot or a generated verdict. */
export function checkBasisReviewBriefModel(): void {
  const fixture = basisFixture(), preserved = JSON.stringify(fixture.state);
  const same = inspectBrief(fixture.state, compareDecisionBases(fixture.state, fixture.decisionId, fixture.firstOutcomeId, fixture.firstOutcomeId));
  assert.equal(same.direction, "same"); assert.deepEqual(section(same, "decision").from, section(same, "decision").to);
  assert.equal(same.sections.flatMap((item) => item.changes).length, 0);
  const evidenceOnly = inspectBrief(fixture.state, compareDecisionBases(fixture.state, fixture.decisionId, fixture.baselineId, fixture.firstCaptureId));
  assert.equal(section(evidenceOnly, "decision").changes.length, 0); assert.deepEqual(section(evidenceOnly, "human-review").recordChanges, []);
  assert.ok(section(evidenceOnly, "evidence").changes.some((fact): boolean => fact.key === "known-requested" && fact.toValue.includes("documents:write")));
  const held = inspectBrief(fixture.state, compareDecisionBases(fixture.state, fixture.decisionId, fixture.deferralId, fixture.replacementId));
  assert.equal(section(held, "decision").changes.length, 0); assert.ok(section(held, "human-review").recordChanges.some((record): boolean => record.kind === "replacement" && record.addedIds.includes(fixture.replacementId)));
  const changed = inspectBrief(fixture.state, compareDecisionBases(fixture.state, fixture.decisionId, fixture.replacementId, fixture.finalOutcomeId));
  const terminalOutcome = fixture.state.outcomes.find((record): boolean => record.id === fixture.finalOutcomeId); assert.ok(terminalOutcome !== undefined);
  assert.ok(section(changed, "decision").changes.some((fact): boolean => fact.key === "active-revision" && fact.toValue === terminalOutcome.revision));
  const reversed = inspectBrief(fixture.state, compareDecisionBases(fixture.state, fixture.decisionId, fixture.finalOutcomeId, fixture.replacementId));
  assert.equal(reversed.direction, "backward"); assert.ok(section(reversed, "human-review").recordChanges.some((record): boolean => record.kind === "outcome" && record.removedIds.includes(fixture.finalOutcomeId)));
  const packet1 = inspectComparisonPacket(JSON.stringify(createComparisonPacket(fixture.state, fixture.decisionId, fixture.firstOutcomeId, fixture.deferralId, createdAt)));
  assert.deepEqual(basisReviewBrief(packet1.comparison), inspectBrief(fixture.state, compareDecisionBases(fixture.state, fixture.decisionId, fixture.firstOutcomeId, fixture.deferralId)), "A frozen v1 packet derives the same brief without access to omitted later records.");
  const uncertainty = uncertaintyFixture(), state = uncertainty.completed, insufficient = state.resolutions[0], satisfied = state.resolutions[1], requirement = state.requirements[0];
  assert.ok(insufficient !== undefined && satisfied !== undefined && requirement !== undefined);
  const addressed = inspectBrief(state.history, compareUncertaintyDecisionBases(state, uncertainty.decisionId, insufficient.id, satisfied.id));
  assert.equal(section(addressed, "decision").changes.length, 0); assert.deepEqual(section(addressed, "human-review").recordChanges, []);
  const questionChange = section(addressed, "questions").changes.find((fact): boolean => fact.key === `clarification-${requirement.id}-status`); assert.ok(questionChange !== undefined);
  assert.equal(questionChange.fromValue, "insufficient"); assert.equal(questionChange.toValue, "satisfied");
  assert.ok(questionChange.toReferences.some((reference): boolean => reference.kind === "resolution" && reference.id === satisfied.id));
  assert.ok(section(addressed, "human-review").to.some((fact): boolean => fact.key === "pending-review" && fact.references.some((reference): boolean => reference.kind === "review" && reference.id === uncertainty.reviewId)), "A satisfying evidence response leaves the independent human review visible.");
  const earlierComparison = compareUncertaintyDecisionBases(state, uncertainty.decisionId, requirement.id, insufficient.id), earlier = inspectBrief(state.history, earlierComparison);
  for (const future of [satisfied.id, uncertainty.productionCaptureId, ...state.history.replacements.flatMap((record): string[] => [record.id, record.newReviewId]), state.history.outcomes.at(-1)?.id]) if (future !== undefined) assert.equal(JSON.stringify(earlier).includes(future), false, "Later history in inherited latest snapshots cannot leak into the earlier brief.");
  const packet2 = inspectComparisonPacket(JSON.stringify(createUncertaintyComparisonPacket(state, uncertainty.decisionId, requirement.id, insufficient.id, createdAt)));
  assert.deepEqual(basisReviewBrief(packet2.comparison), earlier, "A frozen v2 packet preserves the exact selected brief while omitted upstream completeness remains unproved.");
  const receipts = basisReceiptsFixture(), receiptBrief = inspectBrief(receipts.state, compareDecisionBases(receipts.state, receipts.decisionId, receipts.revisionId, "latest"));
  const known = section(receiptBrief, "evidence").to.find((fact): boolean => fact.key === "known-declaration"); assert.ok(known !== undefined);
  assert.ok(known.references.some((reference): boolean => reference.kind === "source-event" && reference.id === receipts.manualCaptureId));
  assert.match(z.string().parse(section(receiptBrief, "evidence").to.find((fact): boolean => fact.key === "known-receipt")?.value), /manual|not recorded|unmarked/i, "An unmarked capture cannot inherit an earlier or later declared source revision.");
  const invalid = ClarificationStateSchema.parse({ ...receipts.state, sources: receipts.state.sources.map((capture) => capture.id === receipts.manualCaptureId ? { ...capture, evidence: { ...capture.evidence, sourceNote: "DC_SOURCE_FILE_V1\n{malformed synthetic declaration}" } } : capture) });
  const invalidBrief = inspectBrief(invalid, compareDecisionBases(invalid, receipts.decisionId, receipts.revisionId, "latest"));
  assert.match(z.string().parse(section(invalidBrief, "evidence").to.find((fact): boolean => fact.key === "known-receipt")?.value), /invalid|unavailable/i);
  assert.throws((): void => { basisReviewBrief({ ...earlierComparison, changedFacts: [...earlierComparison.changedFacts, { key: "unsupported-derived-verdict", label: "Unsupported synthetic claim", fromValue: "None", toValue: "Approve", fromReferences: [], toReferences: [] }] }); }, /unsupported|unknown|unrecognized|partition|classify/i);
  assert.throws((): void => { basisReviewBrief({ ...earlierComparison, changedFacts: earlierComparison.changedFacts.map((fact) => fact.key === "known-source-event" ? { ...fact, toReferences: [{ kind: "source-event", id: uncertainty.productionCaptureId }] } : fact) }); }, /reference|supported|selected endpoint/i, "A future capture citation cannot be accepted just because inherited latest contains it.");
  assert.equal(JSON.stringify(fixture.state), preserved);
}

type Workspace = ClarificationState | UncertaintyState;
type StorageBytes = Readonly<{ local: Record<string, string>; session: Record<string, string> }>;
async function bytes(page: Page): Promise<StorageBytes> { return page.evaluate((): StorageBytes => ({ local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage)) })); }
async function ready(page: Page): Promise<void> { await page.locator('html[data-app-ready="true"]').waitFor(); }
async function restore(page: Page, url: string, state: Workspace): Promise<void> {
  const content = JSON.stringify(state.schemaVersion === 7 ? uncertaintyHistoryExport(state, createdAt) : clarificationHistoryExport(state, createdAt));
  await page.goto(`${url}/impact.html?format=${state.schemaVersion}`); await ready(page); const preserved = await bytes(page);
  await page.getByTestId("import-toggle").click(); await page.getByTestId("import-file").setInputFiles({ name: "synthetic-brief-history.json", mimeType: "application/json", buffer: Buffer.from(content) });
  await page.getByTestId("inspect-import").click(); await page.getByTestId("import-preview").waitFor({ state: "visible" }); assert.deepEqual(await bytes(page), preserved);
  const navigation = page.waitForEvent("domcontentloaded"); await page.getByTestId("confirm-import").click(); await navigation; await ready(page);
}
async function reference(page: Page, sectionKey: Section["key"], side: Side, factKey: string, index: number, expected: BasisReference): Promise<void> {
  const details = page.getByTestId(`basis-brief-${sectionKey}-details`);
  if (!(await details.evaluate((element): boolean => element instanceof HTMLDetailsElement && element.open))) await page.getByTestId(`basis-brief-${sectionKey}-summary`).click();
  const toggle = page.getByTestId(`basis-brief-ref-${sectionKey}-${side}-${factKey}-toggle`);
  if (!(await toggle.locator("..").evaluate((element): boolean => element instanceof HTMLDetailsElement && element.open))) await toggle.click();
  const control = page.getByTestId(`basis-brief-ref-${sectionKey}-${side}-${factKey}-${index}`);
  assert.equal(await control.getAttribute("data-basis-ref-kind"), expected.kind); assert.equal(await control.getAttribute("data-basis-ref-id"), expected.id);
  await control.focus(); await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate((id: string): Readonly<{ id: string | undefined; kind: string | undefined; contained: boolean }> => {
    const target = document.activeElement, endpoint = document.getElementById(id);
    if (!(target instanceof HTMLElement) || endpoint === null) throw new ReferenceError("Brief reference navigation requires its exact selected endpoint.");
    return { id: target.dataset.basisRefId, kind: target.dataset.basisRefKind, contained: endpoint.contains(target) };
  }, side === "from" ? "basis-historical" : "basis-latest"), { id: expected.id, kind: expected.kind, contained: true });
}
async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(result.violations.map((item): string => `${item.id}: ${item.nodes.map((node): string => node.target.join(", ")).join(", ")}`), []);
  assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true);
}
async function briefDisclosureStates(page: Page): Promise<readonly boolean[]> {
  return page.getByTestId("basis-review-brief").locator("details").evaluateAll((elements): boolean[] => elements.map((element): boolean => {
    if (!(element instanceof HTMLDetailsElement)) throw new TypeError("A printable brief disclosure must be native details.");
    return element.open;
  }));
}
async function download(page: Page, id: string): Promise<string> { const waiting = page.waitForEvent("download"); await page.getByTestId(id).focus(); await page.keyboard.press("Enter"); return readFile(z.string().parse(await (await waiting).path()), "utf8"); }
async function upload(page: Page, content: string): Promise<void> {
  await page.getByTestId("packet-file").setInputFiles({ name: "synthetic-brief-comparison.json", mimeType: "application/json", buffer: Buffer.from(content) });
  assert.equal(await page.getByTestId("basis-review-brief").isVisible(), false);
  await page.getByTestId("packet-inspect").focus(); await page.keyboard.press("Enter");
}

/** Shared workspace and frozen packet briefs preserve native histories and exact local references across presentation changes. */
export async function checkBasisReviewBrief(browser: Browser, url: string): Promise<void> {
  checkBasisReviewBriefModel();
  const fixture = uncertaintyFixture(), state = fixture.completed, insufficient = state.resolutions[0], satisfied = state.resolutions[1]; assert.ok(insufficient !== undefined && satisfied !== undefined);
  const comparison = compareUncertaintyDecisionBases(state, fixture.decisionId, insufficient.id, satisfied.id), brief = basisReviewBrief(comparison);
  const responseFact = section(brief, "questions").to.find((fact): boolean => fact.references.some((reference): boolean => reference.kind === "resolution" && reference.id === satisfied.id)); assert.ok(responseFact !== undefined);
  const responseIndex = responseFact.references.findIndex((reference): boolean => reference.kind === "resolution" && reference.id === satisfied.id), responseReference = responseFact.references[responseIndex]; assert.ok(responseReference !== undefined);
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), fresh = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
  for (const context of [desktop, fresh, mobile]) context.setDefaultTimeout(5000);
  try {
    const page = await desktop.newPage(), reader = await fresh.newPage(), narrow = await mobile.newPage(), errors: Error[] = [], external: string[] = [];
    for (const item of [page, reader, narrow]) { item.on("pageerror", (error: Error): void => { errors.push(error); }); item.on("request", (request): void => { const target = new URL(request.url()); if ((target.protocol === "http:" || target.protocol === "https:") && target.origin !== new URL(url).origin) external.push(target.href); }); }
    await restore(page, url, state); const preserved = await bytes(page); assert.equal(preserved.local[uncertaintyStorageKey(state.id)], JSON.stringify(state));
    await page.getByTestId("basis-decision").selectOption(fixture.decisionId); await page.getByTestId("basis-event").selectOption(insufficient.id); await page.getByTestId("basis-compare-event").selectOption(satisfied.id);
    assert.equal(await page.getByTestId("basis-review-brief").isVisible(), true);
    await page.getByTestId("basis-review-brief").screenshot({ path: "output/playwright/basis-review-brief-desktop.png", animations: "disabled" });
    await reference(page, "questions", "to", responseFact.key, responseIndex, responseReference);
    assert.equal(await page.getByTestId("basis-latest").getAttribute("data-pending-review-id"), fixture.reviewId); assert.deepEqual(await bytes(page), preserved);
    const packet = await download(page, "basis-export"); assert.equal(inspectComparisonPacket(packet).packet.packetSchemaVersion, 2);
    await reader.goto(`${url}/comparison.html`); await ready(reader); await upload(reader, packet); await reader.getByTestId("packet-result").waitFor({ state: "visible" });
    await reader.getByTestId("basis-review-brief").screenshot({ path: "output/playwright/basis-review-brief-packet.png", animations: "disabled" });
    await reference(reader, "questions", "to", responseFact.key, responseIndex, responseReference); assert.deepEqual(await bytes(reader), { local: {}, session: {} });
    await accessible(reader);
    const beforePrint = await briefDisclosureStates(reader); assert.ok(beforePrint.length > 4 && beforePrint.some((open): boolean => !open));
    await reader.evaluate((): void => { window.dispatchEvent(new Event("beforeprint")); });
    assert.equal((await briefDisclosureStates(reader)).every((open): boolean => open), true, "The print lifecycle exposes all brief facts and citations.");
    await reader.emulateMedia({ media: "print" }); assert.equal(await reader.getByTestId("basis-review-brief").isVisible(), true); assert.equal(await reader.getByTestId("basis-historical").isVisible(), true); assert.equal(await reader.getByTestId("basis-latest").isVisible(), true); assert.deepEqual(await bytes(reader), { local: {}, session: {} });
    await reader.evaluate((): void => { window.dispatchEvent(new Event("afterprint")); });
    assert.deepEqual(await briefDisclosureStates(reader), beforePrint, "Ending print restores the reader's exact previous disclosure states.");
    assert.deepEqual(await bytes(reader), { local: {}, session: {} }); await reader.emulateMedia({ media: "screen" });
    await upload(reader, "{malformed JSON"); await reader.getByTestId("packet-error").waitFor({ state: "visible" }); assert.equal(await reader.getByTestId("basis-review-brief").innerHTML(), ""); assert.equal(await reader.getByTestId("packet-print").isDisabled(), true);
    await upload(reader, packet); await reader.getByTestId("packet-result").waitFor({ state: "visible" }); await reader.reload(); await ready(reader); assert.equal(await reader.getByTestId("basis-review-brief").isVisible(), false); assert.deepEqual(await bytes(reader), { local: {}, session: {} });
    const other = state.history.originalDecisions.find((record): boolean => record.decision.id !== fixture.decisionId); assert.ok(other !== undefined); await page.getByTestId("basis-decision").selectOption(other.decision.id);
    assert.equal(await page.getByTestId("basis-review-brief").isVisible(), false); assert.equal(await page.getByTestId("basis-review-brief").innerHTML(), ""); assert.equal(await page.getByTestId("basis-export").isDisabled(), true); assert.deepEqual(await bytes(page), preserved);
    await page.getByTestId("basis-decision").selectOption(fixture.decisionId); assert.equal(await page.getByTestId("basis-review-brief").isVisible(), true);
    assert.deepEqual(UncertaintyHistoryExportSchema.parse(JSON.parse(await download(page, "shared-export"))).session, state); await page.reload(); await ready(page); assert.deepEqual(await bytes(page), preserved);
    const legacy = basisFixture(), legacyComparison = compareDecisionBases(legacy.state, legacy.decisionId, legacy.firstOutcomeId, legacy.deferralId), legacyBrief = basisReviewBrief(legacyComparison);
    await restore(page, url, legacy.state); const legacyBytes = await bytes(page); await page.getByTestId("basis-decision").selectOption(legacy.decisionId); await page.getByTestId("basis-event").selectOption(legacy.firstOutcomeId); await page.getByTestId("basis-compare-event").selectOption(legacy.deferralId);
    const legacyPacket = await download(page, "basis-export"); assert.equal(inspectComparisonPacket(legacyPacket).packet.packetSchemaVersion, 1); assert.deepEqual(await bytes(page), legacyBytes);
    await upload(reader, legacyPacket); await reader.getByTestId("packet-result").waitFor({ state: "visible" });
    const scope = section(legacyBrief, "decision").from.find((fact): boolean => fact.key === "active-scope"); assert.ok(scope !== undefined && scope.references[0] !== undefined); await reference(reader, "decision", "from", scope.key, 0, scope.references[0]);
    const unsafeRationale = "Synthetic reviewer rationale: <img src=x onerror=alert(1)> remains literal text and supplies no runtime assurance.";
    const terminal = state.history.outcomes.at(-1); assert.ok(terminal !== undefined);
    const escaped = UncertaintyStateSchema.parse({ ...state, history: { ...state.history, outcomes: state.history.outcomes.map((outcome) => outcome.id === terminal.id ? { ...outcome, rationale: unsafeRationale } : outcome) } });
    await upload(reader, JSON.stringify(createUncertaintyComparisonPacket(escaped, fixture.decisionId, satisfied.id, terminal.id, createdAt))); await reader.getByTestId("packet-result").waitFor({ state: "visible" });
    assert.ok((await reader.getByTestId("basis-review-brief").textContent())?.includes(unsafeRationale)); assert.equal(await reader.getByTestId("basis-review-brief").locator("img").count(), 0); assert.deepEqual(await bytes(reader), { local: {}, session: {} });
    const replacement = state.history.replacements[0]; assert.ok(replacement !== undefined);
    const ambiguous = UncertaintyStateSchema.parse({ ...state, id: randomUUID(), resolutions: [insufficient, { ...satisfied, recordedAt: replacement.recordedAt }] });
    await restore(page, url, ambiguous); const ambiguousBytes = await bytes(page); await page.getByTestId("basis-decision").selectOption(fixture.decisionId); await page.getByTestId("basis-event").selectOption(insufficient.id); await page.getByTestId("basis-compare-event").selectOption(satisfied.id);
    assert.equal(await page.getByTestId("basis-error").isVisible(), true); assert.equal(await page.getByTestId("basis-review-brief").innerHTML(), ""); assert.equal(await page.getByTestId("basis-review-brief").isVisible(), false); assert.equal(await page.getByTestId("basis-export").isDisabled(), true); assert.deepEqual(await bytes(page), ambiguousBytes);
    await narrow.goto(`${url}/comparison.html`); await ready(narrow); await upload(narrow, packet); await narrow.getByTestId("packet-result").waitFor({ state: "visible" }); await narrow.getByTestId("basis-review-brief").screenshot({ path: "output/playwright/basis-review-brief-mobile.png", animations: "disabled" }); await accessible(narrow); await reference(narrow, "questions", "to", responseFact.key, responseIndex, responseReference); assert.equal(await narrow.evaluate((): string => getComputedStyle(document.documentElement).scrollBehavior), "auto"); assert.deepEqual(await bytes(narrow), { local: {}, session: {} });
    assert.deepEqual(errors, []); assert.deepEqual(external, [], "Briefs inspect local records without fetching sources, uploading evidence or contacting AI services.");
    console.log("basis_review_brief_smoke_passed", { completeFactPartition: true, exactEndpointCitations: true, noFutureSnapshotLeakage: true, satisfactionSeparateFromApproval: true, missingDeclarationsExplicit: true, unchangedEvidenceOnlyReversedSame: true, frozenV1V2Equivalent: true, nativeReferences: true, staleBriefCleared: true, escapedNarratives: true, oldBytesPreserved: true, keyboard: true, mobile: true, reducedMotion: true, accessibility: true, print: true, practitionerParticipation: false });
  } finally { await desktop.close(); await fresh.close(); await mobile.close(); }
}
