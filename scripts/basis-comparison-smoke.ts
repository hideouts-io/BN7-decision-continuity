import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { appendClarificationEvidence, appendClarificationOutcome, ClarificationStateSchema, openClarificationReview } from "../src/clarification-model.ts";
import type { ClarificationState } from "../src/clarification-model.ts";
import { clarificationHistoryExport, ClarificationHistoryExportSchema } from "../src/clarification-export.ts";
import { clarificationStorageKey } from "../src/clarification-storage.ts";
import { compareDecisionBases } from "../src/basis-comparison.ts";
import type { BasisComparison } from "../src/basis-comparison.ts";
import type { BasisSnapshot } from "../src/decision-basis.ts";
import { ambiguousFixture, basisFixture, tiedFixture } from "./basis-smoke.ts";
import type { BasisFixture, TiedFixture } from "./basis-smoke.ts";

function uuid(index: number): string { return z.uuid().parse(`00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`); }
function references(snapshot: BasisSnapshot): ReadonlySet<string> {
  return new Set([
    snapshot.record.decision.id, snapshot.record.assumption.id, snapshot.record.assumption.sourceId,
    snapshot.knownSource.id, snapshot.knownSource.evidence.id,
    ...(snapshot.support === null ? [] : [snapshot.support.id, snapshot.support.evidence.id]),
    ...snapshot.reviews.flatMap((record): string[] => [record.id, record.sourceEventId, record.evidenceId, record.basis.sourceEventId, record.basis.evidenceId]),
    ...snapshot.outcomes.flatMap((record): string[] => [record.id, record.reviewId, record.sourceEventId, record.evidenceId]),
    ...snapshot.replacements.flatMap((record): string[] => [record.id, record.oldReviewId, record.newReviewId, record.deferredOutcomeId, record.oldSourceEventId, record.oldEvidenceId, record.newSourceEventId, record.newEvidenceId]),
  ]);
}
function checkReferences(comparison: BasisComparison): void {
  const from = references(comparison.from.historical), to = references(comparison.to.historical);
  for (const fact of comparison.changedFacts) {
    assert.ok(fact.fromReferences.length + fact.toReferences.length > 0, `Changed fact ${fact.key} requires inspectable recorded references.`);
    for (const reference of fact.fromReferences) assert.ok(from.has(reference.id), `From-side ${fact.key} reference must belong to the selected recorded state: ${reference.id}`);
    for (const reference of fact.toReferences) assert.ok(to.has(reference.id), `To-side ${fact.key} reference must belong to the selected recorded state: ${reference.id}`);
  }
}
function cycleFixture(tied: TiedFixture): ClarificationState {
  const at = tied.state.sources.at(-1)?.recordedAt;
  assert.notEqual(at, undefined);
  const capture = appendClarificationEvidence(tied.state, {
    capturedAt: z.string().parse(at), requestedPermissions: ["documents:read", "documents:write", "documents:delete"],
    grantedPermissions: ["documents:read"], environment: "Unknown", sourceNote: "Synthetic second tied capture tests contradictory append order without inventing a global event sequence.",
  }, uuid(214), uuid(215), z.string().parse(at));
  const review = openClarificationReview(capture, tied.decisionId, uuid(216), z.string().parse(at));
  const state = appendClarificationOutcome(review, tied.decisionId, {
    actor: "SIM_BASIS", outcome: "revise", statement: "Synthetic request scope accepts read, write and delete for its exact capture; context and runtime remain unobserved.",
    rationale: "Synthetic accountable rationale preserves this exact capture, independent grants and unresolved context; no assurance is implied.",
    acceptedPermissions: ["documents:read", "documents:write", "documents:delete"],
  }, uuid(217), z.string().parse(at));
  return ClarificationStateSchema.parse({ ...state, outcomes: state.outcomes.toReversed() });
}

/** Compare real synthetic domain records in both directions without mutating their bytes or fabricating causal order. */
export function checkBasisComparisonModel(): void {
  const fixture = basisFixture(), tied = tiedFixture(), ambiguous = ambiguousFixture();
  const preserved = JSON.stringify(fixture.state), tiedBytes = JSON.stringify(tied.state), ambiguousBytes = JSON.stringify(ambiguous.state);
  const earlier = compareDecisionBases(fixture.state, fixture.decisionId, fixture.firstOutcomeId, fixture.deferralId);
  assert.equal(earlier.direction, "forward");
  assert.equal(earlier.from.historical.basis?.revision, `${fixture.decisionId}.2`);
  assert.equal(earlier.to.historical.basis?.revision, `${fixture.decisionId}.2`, "Deferral retains the resolved earlier boundary.");
  assert.equal(earlier.to.historical.pendingReview?.id, fixture.unknownReviewId);
  assert.equal(earlier.to.historical.pendingReview?.evidenceId, fixture.state.reviews[1]?.evidenceId);
  assert.deepEqual(earlier.addedEventIds, [fixture.unknownCaptureId, fixture.unknownReviewId, fixture.deferralId]);
  assert.deepEqual(earlier.removedEventIds, []);
  assert.equal(earlier.ruleVersionStatus, "unrecorded");
  assert.ok(earlier.preservedOriginalRules.length > 0);
  const fromStatement = fixture.state.outcomes[0]?.statement, finalStatement = fixture.state.outcomes.at(-1)?.statement;
  const futureNote = fixture.state.sources.at(-1)?.evidence.sourceNote;
  assert.notEqual(fromStatement, undefined); assert.notEqual(finalStatement, undefined); assert.notEqual(futureNote, undefined);
  const facts = JSON.stringify({ from: earlier.from.historical, to: earlier.to.historical, changedFacts: earlier.changedFacts, recordChanges: earlier.recordChanges });
  assert.ok(facts.includes(z.string().parse(fromStatement)));
  assert.equal(facts.includes(z.string().parse(finalStatement)), false);
  assert.equal(facts.includes(z.string().parse(futureNote)), false);
  assert.equal(facts.includes(fixture.finalOutcomeId), false, "Comparison facts must exclude events beyond both selected cuts.");
  assert.deepEqual(earlier.recordChanges.find((item): boolean => item.kind === "deferral")?.addedIds, [fixture.deferralId]);
  assert.equal(earlier.changedFacts.some((fact): boolean => fact.key === "active-boundary"), false);
  assert.equal(earlier.changedFacts.find((fact): boolean => fact.key === "known-environment")?.toValue, "Unknown");
  checkReferences(earlier);
  const reversed = compareDecisionBases(fixture.state, fixture.decisionId, fixture.deferralId, fixture.firstOutcomeId);
  assert.equal(reversed.direction, "backward"); assert.deepEqual(reversed.addedEventIds, []);
  assert.deepEqual(reversed.removedEventIds, earlier.addedEventIds);
  assert.deepEqual(reversed.from.historical, earlier.to.historical); assert.deepEqual(reversed.to.historical, earlier.from.historical);
  for (const fact of earlier.changedFacts) {
    const reverse = reversed.changedFacts.find((item): boolean => item.key === fact.key); assert.ok(reverse !== undefined);
    assert.equal(reverse.fromValue, fact.toValue); assert.equal(reverse.toValue, fact.fromValue);
    assert.deepEqual(reverse.fromReferences, fact.toReferences); assert.deepEqual(reverse.toReferences, fact.fromReferences);
  }
  const identical = compareDecisionBases(fixture.state, fixture.decisionId, fixture.firstOutcomeId, fixture.firstOutcomeId);
  assert.equal(identical.direction, "same"); assert.deepEqual(identical.changedFacts, []);
  assert.deepEqual(identical.addedEventIds, []); assert.deepEqual(identical.removedEventIds, []);
  assert.ok(identical.recordChanges.every((item): boolean => item.addedIds.length === 0 && item.removedIds.length === 0));
  const baselineAlias = compareDecisionBases(fixture.state, fixture.decisionId, fixture.baselineId, fixture.decisionId);
  assert.equal(baselineAlias.direction, "same"); assert.deepEqual(baselineAlias.changedFacts, []);
  const replacementAlias = compareDecisionBases(fixture.state, fixture.decisionId, fixture.replacementId, fixture.replacementReviewId);
  assert.equal(replacementAlias.direction, "same"); assert.deepEqual(replacementAlias.changedFacts, []);
  const replaced = compareDecisionBases(fixture.state, fixture.decisionId, fixture.deferralId, fixture.replacementId);
  assert.deepEqual(replaced.recordChanges.find((item): boolean => item.kind === "replacement")?.addedIds, [fixture.replacementId]);
  assert.deepEqual(replaced.recordChanges.find((item): boolean => item.kind === "review")?.addedIds, [fixture.replacementReviewId]);
  assert.equal(replaced.changedFacts.some((item): boolean => item.key === "active-boundary"), false, "Replacing a question never changes the decision basis.");
  checkReferences(replaced);
  const latestAlias = compareDecisionBases(fixture.state, fixture.decisionId, fixture.finalOutcomeId, "latest");
  assert.equal(latestAlias.direction, "same"); assert.deepEqual(latestAlias.changedFacts, []);
  const tiedCapture = compareDecisionBases(tied.state, tied.decisionId, tied.captureId, tied.reviewId);
  assert.equal(tiedCapture.direction, "forward"); assert.deepEqual(tiedCapture.addedEventIds, [tied.reviewId]);
  assert.equal(tiedCapture.to.historical.outcomes.length, 0);
  const tiedResolution = compareDecisionBases(tied.state, tied.decisionId, tied.reviewId, tied.outcomeId);
  assert.equal(tiedResolution.direction, "forward"); assert.equal(tiedResolution.to.historical.pendingReview, null);
  assert.equal(tiedResolution.changedFacts.find((item): boolean => item.key === "active-revision")?.toValue, `${tied.decisionId}.2`);
  checkReferences(tiedResolution);
  const latestTied = tied.state.sources.at(-1); assert.ok(latestTied !== undefined);
  const reordered = appendClarificationEvidence(tied.state, {
    capturedAt: "2026-10-06T00:00:02.000Z", requestedPermissions: ["documents:write", "documents:read"],
    grantedPermissions: ["documents:read"], environment: "Unknown", sourceNote: latestTied.evidence.sourceNote,
  }, uuid(218), uuid(219), "2026-10-06T00:00:02.000Z");
  const permissionOrder = compareDecisionBases(reordered, tied.decisionId, tied.outcomeId, uuid(218));
  assert.equal(permissionOrder.changedFacts.some((item): boolean => item.key === "known-requested"), false, "Permission sets do not change because their recorded presentation order differs.");
  assert.deepEqual(reordered.sources.at(-1)?.evidence.requestedPermissions, ["documents:write", "documents:read"], "Comparing declared sets must not normalize stored arrays.");
  const withdrawalCapture = appendClarificationEvidence(fixture.state, {
    capturedAt: "2026-10-06T00:00:13.000Z", requestedPermissions: ["documents:read", "documents:write", "documents:delete"],
    grantedPermissions: ["documents:read"], environment: "Unknown", sourceNote: "Synthetic later unresolved context tests a withdrawal comparison while preserving all earlier accepted boundaries.",
  }, uuid(123), uuid(124), "2026-10-06T00:00:13.000Z");
  const withdrawalReview = openClarificationReview(withdrawalCapture, fixture.decisionId, uuid(125), "2026-10-06T00:00:14.000Z");
  const withdrawn = appendClarificationOutcome(withdrawalReview, fixture.decisionId, {
    actor: "SIM_BASIS", outcome: "withdraw", acceptedPermissions: null,
    statement: "Withdraw this synthetic production decision while preserving its earlier evidence and recorded outcomes.",
    rationale: "Synthetic reviewer withdraws the active boundary because declared applicability remains Unknown; no runtime assurance is inferred.",
  }, uuid(126), "2026-10-06T00:00:15.000Z");
  const withdrawalBytes = JSON.stringify(withdrawn), withdrawal = compareDecisionBases(withdrawn, fixture.decisionId, fixture.finalOutcomeId, uuid(126));
  assert.equal(withdrawal.direction, "forward"); assert.equal(withdrawal.to.historical.basis, null); assert.equal(withdrawal.to.historical.support, null);
  assert.match(z.string().parse(withdrawal.changedFacts.find((item): boolean => item.key === "active-scope")?.toValue), /withdrawn/i);
  assert.ok(withdrawal.changedFacts.find((item): boolean => item.key === "active-scope")?.toReferences.some((ref): boolean => ref.kind === "outcome" && ref.id === uuid(126)));
  checkReferences(withdrawal); assert.equal(JSON.stringify(withdrawn), withdrawalBytes);
  for (const [from, to] of [[uuid(900), "latest"], ["latest", uuid(900)], [fixture.firstEvidenceId, "latest"], ["latest", fixture.firstEvidenceId]]) {
    assert.throws((): void => { compareDecisionBases(fixture.state, fixture.decisionId, z.string().parse(from), z.string().parse(to)); }, /event.*does not belong/i);
  }
  const otherDecision = fixture.state.originalDecisions[0]?.decision.id; assert.notEqual(otherDecision, undefined);
  assert.throws((): void => { compareDecisionBases(fixture.state, z.string().parse(otherDecision), fixture.firstReviewId, "latest"); }, /event.*does not belong/i);
  assert.throws((): void => { compareDecisionBases(fixture.state, z.string().parse(otherDecision), "latest", fixture.firstReviewId); }, /event.*does not belong/i);
  assert.throws((): void => { compareDecisionBases(fixture.state, uuid(901), "latest", "latest"); }, /decision.*does not belong/i);
  assert.throws((): void => { compareDecisionBases(fixture.state, fixture.decisionId, "not-an-event-uuid", "latest"); }, z.ZodError);
  assert.throws((): void => { compareDecisionBases(fixture.state, fixture.decisionId, "latest", "not-an-event-uuid"); }, z.ZodError);
  for (const [from, to] of [[ambiguous.captureId, "latest"], ["latest", ambiguous.outcomeId], [ambiguous.captureId, ambiguous.outcomeId]]) {
    assert.throws((): void => { compareDecisionBases(ambiguous.state, ambiguous.decisionId, z.string().parse(from), z.string().parse(to)); }, /ambiguous/i);
  }
  assert.equal(compareDecisionBases(ambiguous.state, ambiguous.decisionId, "latest", "latest").direction, "same");
  const cycle = cycleFixture(tied), cycleBytes = JSON.stringify(cycle);
  assert.throws((): void => { compareDecisionBases(cycle, tied.decisionId, tied.captureId, "latest"); }, /cycle|contradict/i);
  assert.throws((): void => { compareDecisionBases(cycle, tied.decisionId, "latest", "latest"); }, /cycle|contradict/i);
  assert.equal(JSON.stringify(cycle), cycleBytes);
  assert.equal(JSON.stringify(fixture.state), preserved); assert.equal(JSON.stringify(tied.state), tiedBytes); assert.equal(JSON.stringify(ambiguous.state), ambiguousBytes);
}

async function bytes(page: Page): Promise<Record<string, string>> { return page.evaluate((): Record<string, string> => Object.fromEntries(Object.entries(localStorage))); }
async function saved(page: Page, id: string): Promise<ClarificationState> {
  const value = await page.evaluate((key: string): string | null => localStorage.getItem(key), clarificationStorageKey(id));
  return ClarificationStateSchema.parse(JSON.parse(z.string().parse(value)));
}
async function ready(page: Page): Promise<void> { await page.locator('html[data-app-ready="true"]').waitFor(); }
async function restore(page: Page, content: string, id: string): Promise<void> {
  const before = await bytes(page);
  await page.getByTestId("import-toggle").click();
  await page.getByTestId("import-file").setInputFiles({ name: "comparison-history.json", mimeType: "application/json", buffer: Buffer.from(content) });
  await page.getByTestId("inspect-import").click(); await page.getByTestId("import-preview").waitFor({ state: "visible" });
  assert.deepEqual(await bytes(page), before);
  assert.equal(await page.getByTestId("confirm-import").isEnabled(), true);
  const navigation = page.waitForEvent("domcontentloaded"); await page.getByTestId("confirm-import").click(); await navigation; await ready(page);
  assert.equal(new URL(page.url()).searchParams.get("session"), id);
}
async function downloaded(page: Page): Promise<string> {
  const waiting = page.waitForEvent("download"); await page.getByTestId("shared-export").click();
  return readFile(z.string().parse(await (await waiting).path()), "utf8");
}
async function compareEarlier(page: Page, fixture: BasisFixture): Promise<void> {
  await page.getByTestId("basis-decision").selectOption(fixture.decisionId);
  await page.getByTestId("basis-event").selectOption(fixture.firstOutcomeId);
  await page.getByTestId("basis-compare-event").selectOption(fixture.deferralId);
  assert.equal(await page.getByTestId("basis-error").isVisible(), false);
  assert.equal(await page.getByTestId("basis-historical").getAttribute("data-basis-revision"), `${fixture.decisionId}.2`);
  assert.equal(await page.getByTestId("basis-latest").getAttribute("data-basis-revision"), `${fixture.decisionId}.2`);
  assert.equal(await page.getByTestId("basis-historical").getAttribute("data-known-source-id"), fixture.firstCaptureId);
  assert.equal(await page.getByTestId("basis-latest").getAttribute("data-known-source-id"), fixture.unknownCaptureId);
  assert.equal(await page.getByTestId("basis-latest").getAttribute("data-pending-review-id"), fixture.unknownReviewId);
  const recordedFacts = `${await page.getByTestId("basis-historical").textContent()} ${await page.getByTestId("basis-latest").textContent()} ${await page.getByTestId("basis-differences").textContent()}`;
  assert.equal(recordedFacts.includes(z.string().parse(fixture.state.outcomes.at(-1)?.statement)), false);
  assert.equal(recordedFacts.includes(z.string().parse(fixture.state.sources.at(-1)?.evidence.sourceNote)), false);
  const deferralReferences = page.getByTestId("basis-difference-recorded-deferrals-to-refs");
  assert.equal(await deferralReferences.getAttribute("open"), null);
  await page.getByTestId("basis-refs-to-recorded-deferrals-toggle").click();
  assert.ok((await deferralReferences.innerText()).includes(fixture.deferralId), "A recorded deferral difference requires its exact outcome reference.");
  await page.getByTestId("basis-refs-to-recorded-deferrals-toggle").click();
  assert.equal(await deferralReferences.getAttribute("open"), null, "Reference disclosures return to the compact default presentation.");
  assert.equal(await page.getByTestId("basis-panel").locator("img").count(), 0, "Source markup remains captured text.");
}
async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(result.violations.map((item): string => `${item.id}: ${item.nodes.map((node): string => node.target.join(", ")).join(", ")}`), []);
  assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true);
}
async function inspectReference(page: Page, side: "from" | "to", key: string, index: number, kind: string, id: string, context: string): Promise<void> {
  const disclosure = page.getByTestId(`basis-difference-${key}-${side}-refs`);
  assert.equal(await disclosure.getAttribute("open"), null);
  await page.getByTestId(`basis-refs-${side}-${key}-toggle`).click();
  const control = page.getByTestId(`basis-ref-${side}-${key}-${index}`);
  assert.equal(await control.isVisible(), true);
  assert.equal(await control.getAttribute("data-basis-ref-kind"), kind);
  assert.equal(await control.getAttribute("data-basis-ref-id"), id);
  assert.equal(await control.getAttribute("aria-label"), `Inspect ${side === "from" ? "From" : "To"} ${kind} ${id} for ${context}`, "The accessible action identifies its endpoint, exact record and human-readable context.");
  await control.focus(); await page.keyboard.press("Enter");
  const prefix = side === "from" ? "basis-historical" : "basis-latest";
  const focused = await page.evaluate((columnId: string): Readonly<{ inside: boolean; kind: string | null; id: string | null }> => {
    const target = document.activeElement, column = document.getElementById(columnId);
    if (!(target instanceof HTMLElement) || column === null) throw new ReferenceError("An exact recorded reference requires its focused endpoint target.");
    return { inside: column.contains(target), kind: target.dataset.basisRefKind ?? null, id: target.dataset.basisRefId ?? null };
  }, prefix);
  assert.deepEqual(focused, { inside: true, kind, id }, "Reference navigation must stay inside the selected endpoint, never substitute latest records.");
  assert.equal(await page.getByTestId("basis-error").isVisible(), false);
}
async function invalidOption(page: Page, picker: string, value: string): Promise<void> {
  await page.getByTestId(picker).evaluate((element, id: string): void => {
    if (!(element instanceof HTMLSelectElement)) throw new TypeError("Comparison endpoint must be a native select.");
    element.add(new Option("Synthetic invalid selection", id));
  }, value);
  await page.getByTestId(picker).selectOption(value);
}

/** Native selectors, real recovery and export exercise two selected recorded cuts rather than replaying current rules. */
export async function checkBasisComparison(browser: Browser, url: string): Promise<void> {
  checkBasisComparisonModel();
  const fixture = basisFixture(), tied = tiedFixture(), ambiguous = ambiguousFixture();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
  for (const item of [context, mobile]) item.setDefaultTimeout(5000);
  try {
    const page = await context.newPage(), narrow = await mobile.newPage(), failures: Error[] = [];
    page.on("pageerror", (error: Error): void => { failures.push(error); }); narrow.on("pageerror", (error: Error): void => { failures.push(error); });
    await page.goto(`${url}/impact.html?format=6`); await ready(page);
    await restore(page, JSON.stringify(clarificationHistoryExport(fixture.state, "2026-10-06T00:00:20.000Z")), fixture.state.id);
    assert.deepEqual(await saved(page, fixture.state.id), fixture.state);
    const preserved = await bytes(page);
    assert.equal(await page.getByTestId("basis-event").inputValue(), "latest");
    assert.equal(await page.getByTestId("basis-compare-event").inputValue(), "latest");
    await compareEarlier(page, fixture); await accessible(page);
    const environmentRow = page.getByTestId("basis-difference-known-environment");
    assert.ok((await environmentRow.getAttribute("data-from-reference-ids"))?.includes(fixture.firstCaptureId));
    assert.ok((await environmentRow.getAttribute("data-to-reference-ids"))?.includes(fixture.unknownCaptureId));
    const comparison = compareDecisionBases(fixture.state, fixture.decisionId, fixture.firstOutcomeId, fixture.deferralId);
    const environmentContext = z.string().parse(comparison.changedFacts.find((item): boolean => item.key === "known-environment")?.label);
    const deferralContext = z.string().parse(comparison.changedFacts.find((item): boolean => item.key === "recorded-deferrals")?.label);
    const ruleContext = z.string().parse(comparison.preservedOriginalRules.find((item): boolean => item.key === "monitored-field")?.label);
    await inspectReference(page, "from", "known-environment", 1, "source-event", fixture.firstCaptureId, environmentContext);
    await inspectReference(page, "to", "known-environment", 1, "source-event", fixture.unknownCaptureId, environmentContext);
    await inspectReference(page, "to", "recorded-deferrals", 0, "outcome", fixture.deferralId, deferralContext);
    await page.getByTestId("basis-preserved-rules-toggle").click();
    const baselineEvidence = z.string().parse(fixture.state.sources[0]?.evidence.id);
    await inspectReference(page, "from", "rule-monitored-field", 3, "evidence", baselineEvidence, ruleContext);
    await inspectReference(page, "to", "rule-monitored-field", 3, "evidence", baselineEvidence, ruleContext);
    assert.deepEqual(await bytes(page), preserved);
    await page.getByTestId("basis-event").selectOption(fixture.deferralId);
    await page.getByTestId("basis-compare-event").selectOption(fixture.firstOutcomeId);
    assert.equal(await page.getByTestId("basis-historical").getAttribute("data-pending-review-id"), fixture.unknownReviewId);
    assert.equal(await page.getByTestId("basis-latest").getAttribute("data-pending-review-id"), "");
    assert.match(await page.getByTestId("basis-selection-status").innerText(), /backward|reverse|earlier|later to earlier/i);
    await page.getByTestId("basis-event").selectOption(fixture.firstOutcomeId);
    assert.match(await page.getByTestId("basis-differences").innerText(), /same|match|no.*difference/i);
    await compareEarlier(page, fixture);
    await page.getByTestId("basis-compare-event").selectOption(fixture.unknownReviewId);
    await page.getByTestId("basis-compare-event").focus(); await page.keyboard.press("o"); await page.keyboard.press("Tab");
    assert.equal(await page.getByTestId("basis-compare-event").inputValue(), fixture.deferralId, "Keyboard selection compares the chosen second event.");
    await page.getByTestId("basis-panel").screenshot({ path: "output/playwright/basis-comparison-desktop.png", animations: "disabled" });
    await invalidOption(page, "basis-compare-event", uuid(900));
    assert.match(await page.getByTestId("basis-error").innerText(), /event.*does not belong/i);
    assert.equal(await page.getByTestId("basis-historical").getAttribute("data-basis-revision"), `${fixture.decisionId}.2`);
    assert.equal(await page.getByTestId("basis-latest").getAttribute("data-basis-revision"), null);
    assert.match(await page.getByTestId("basis-latest").innerText(), /unavailable/i);
    await page.getByTestId("basis-compare-event").selectOption("latest");
    assert.equal(await page.getByTestId("basis-error").isVisible(), false);
    const otherDecision = z.string().parse(fixture.state.originalDecisions[0]?.decision.id);
    await page.getByTestId("basis-decision").selectOption(otherDecision);
    await invalidOption(page, "basis-compare-event", fixture.firstReviewId);
    assert.match(await page.getByTestId("basis-error").innerText(), /event.*does not belong/i);
    await compareEarlier(page, fixture);
    assert.deepEqual(await bytes(page), preserved);
    await page.reload(); await ready(page);
    assert.equal(await page.getByTestId("basis-event").inputValue(), "latest");
    assert.equal(await page.getByTestId("basis-compare-event").inputValue(), "latest");
    assert.deepEqual(await bytes(page), preserved);
    await compareEarlier(page, fixture);
    const content = await downloaded(page);
    assert.deepEqual(ClarificationHistoryExportSchema.parse(JSON.parse(content)).session, fixture.state);
    await restore(page, content, fixture.state.id); assert.deepEqual(await bytes(page), preserved);
    await narrow.goto(`${url}/impact.html?format=6`); await ready(narrow); await restore(narrow, content, fixture.state.id);
    const mobileBytes = await bytes(narrow); await compareEarlier(narrow, fixture); await accessible(narrow);
    assert.equal(await narrow.evaluate((): string => getComputedStyle(document.documentElement).scrollBehavior), "auto");
    await narrow.getByTestId("basis-panel").screenshot({ path: "output/playwright/basis-comparison-mobile.png", animations: "disabled" });
    await narrow.getByTestId("basis-panel").scrollIntoViewIfNeeded();
    await narrow.getByTestId("basis-decision").scrollIntoViewIfNeeded();
    await narrow.screenshot({ path: "output/playwright/basis-comparison-mobile-viewport.png", fullPage: false, animations: "disabled" });
    assert.deepEqual(await bytes(narrow), mobileBytes);
    await restore(page, JSON.stringify(clarificationHistoryExport(tied.state, "2026-10-06T00:00:20.000Z")), tied.state.id);
    await page.getByTestId("basis-decision").selectOption(tied.decisionId);
    await page.getByTestId("basis-event").selectOption(tied.captureId); await page.getByTestId("basis-compare-event").selectOption(tied.reviewId);
    assert.equal(await page.getByTestId("basis-error").isVisible(), false);
    assert.equal(await page.getByTestId("basis-historical").getAttribute("data-pending-review-id"), "");
    assert.equal(await page.getByTestId("basis-latest").getAttribute("data-pending-review-id"), tied.reviewId);
    await restore(page, JSON.stringify(clarificationHistoryExport(ambiguous.state, "2026-10-06T00:00:20.000Z")), ambiguous.state.id);
    const errorBytes = await bytes(page);
    await page.getByTestId("basis-decision").selectOption(ambiguous.decisionId);
    await page.getByTestId("basis-event").selectOption(ambiguous.captureId);
    assert.match(await page.getByTestId("basis-error").innerText(), /ambiguous/i);
    assert.equal(await page.getByTestId("basis-historical").getAttribute("data-basis-revision"), null);
    assert.equal(await page.getByTestId("basis-latest").getAttribute("data-basis-revision"), `${ambiguous.decisionId}.2`);
    await page.getByTestId("basis-compare-event").selectOption(ambiguous.outcomeId);
    assert.equal(await page.getByTestId("basis-historical").getAttribute("data-known-source-id"), null);
    assert.equal(await page.getByTestId("basis-latest").getAttribute("data-known-source-id"), null);
    assert.match(await page.getByTestId("basis-differences").innerText(), /unavailable/i);
    await page.getByTestId("basis-event").selectOption("latest");
    assert.equal(await page.getByTestId("basis-historical").getAttribute("data-basis-revision"), `${ambiguous.decisionId}.2`);
    assert.equal(await page.getByTestId("basis-latest").getAttribute("data-basis-revision"), null);
    await page.getByTestId("basis-compare-event").selectOption("latest");
    assert.equal(await page.getByTestId("basis-error").isVisible(), false);
    assert.deepEqual(await bytes(page), errorBytes);
    assert.deepEqual(failures, []);
    console.log("basis_comparison_smoke_passed", { twoRecordedCuts: true, reverseAndSame: true, atomicAliases: true, exactReferences: true, noFutureFactLeakage: true, causalTies: true, ambiguousEndpointsRejected: true, cyclesRejected: true, independentColumns: true, rawStoragePreserved: true, reloadDefaults: true, recovery: true, keyboard: true, mobile: true, reducedMotion: true, accessibility: true, practitionerParticipation: false });
  } finally { await context.close(); await mobile.close(); }
}
