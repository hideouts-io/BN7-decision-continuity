import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { appendClarificationEvidence, appendClarificationOutcome, ClarificationStateSchema, createClarificationState, openClarificationReview, replaceClarificationReview } from "../src/clarification-model.ts";
import type { ClarificationState } from "../src/clarification-model.ts";
import { clarificationHistoryExport, ClarificationHistoryExportSchema } from "../src/clarification-export.ts";
import { clarificationStorageKey } from "../src/clarification-storage.ts";
import { decisionBasisAt, decisionBasisEvents } from "../src/decision-basis.ts";
import { createSharedState } from "../src/shared-model.ts";
import type { SharedCreationIds, SharedEvidenceInput, SharedOutcomeInput } from "../src/shared-model.ts";
import type { ContinuityPermission } from "../src/continuity-model.ts";
import { sharedHistoryExport } from "../src/shared-export.ts";
import { fillCreation } from "./authored-smoke.ts";

const actor: string = "SIM_BASIS";
const initialStatement: string = "Synthetic production request scope accepts read and write after its exact declared Production review.";
const finalStatement: string = "Synthetic production request scope now accepts read, write and delete for the separately reviewed clarified capture.";
const capturedMarkup: string = "Synthetic source note: <img src=x onerror=alert(1)> remains captured text; runtime activity is Not observed.";
const futureNote: string = "Synthetic later Production declaration adds delete; this text must not appear in the earlier Unknown view.";
export type BasisFixture = Readonly<{
  state: ClarificationState; decisionId: string; baselineId: string; firstCaptureId: string; firstEvidenceId: string;
  firstReviewId: string; firstOutcomeId: string; unknownCaptureId: string; unknownReviewId: string; deferralId: string;
  clarifiedCaptureId: string; replacementId: string; replacementReviewId: string; finalOutcomeId: string;
}>;
export type TiedFixture = Readonly<{ state: ClarificationState; decisionId: string; captureId: string; reviewId: string; outcomeId: string }>;
export type AmbiguousFixture = Readonly<{ state: ClarificationState; reversed: ClarificationState; decisionId: string; captureId: string; outcomeId: string }>;

function uuid(index: number): string { return z.uuid().parse(`00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`); }
function time(seconds: number): string { return new Date(Date.parse("2026-10-06T00:00:00.000Z") + seconds * 1000).toISOString(); }
function creationIds(offset: number): SharedCreationIds {
  return { session: uuid(offset), source: uuid(offset + 1), event: uuid(offset + 2), evidence: uuid(offset + 3), decisions: [uuid(offset + 4), uuid(offset + 5), uuid(offset + 6)], assumptions: [uuid(offset + 7), uuid(offset + 8), uuid(offset + 9)] };
}
function evidence(capturedAt: string, requested: readonly ContinuityPermission[], environment: "Unknown" | "Production", sourceNote: string): SharedEvidenceInput {
  return { capturedAt, requestedPermissions: [...requested], grantedPermissions: ["documents:read"], environment, sourceNote };
}
function revised(statement: string, accepted: readonly ContinuityPermission[]): SharedOutcomeInput {
  return { actor, outcome: "revise", statement, rationale: "Synthetic accountable rationale considers this exact capture and preserves independent grants, declared context and runtime uncertainty.", acceptedPermissions: [...accepted] };
}
function deferred(): SharedOutcomeInput {
  return { actor, outcome: "defer", statement: "Preserve the earlier synthetic production scope while deployment applicability remains Unknown and the review remains open.", rationale: "Synthetic reviewer defers the exact Unknown capture; a later declaration requires a separate frozen question and outcome.", acceptedPermissions: null };
}

/** A resolved revision precedes the Unknown review; clarification must preserve that revision rather than restore revision 1. */
export function basisFixture(): BasisFixture {
  const ids = creationIds(100), decisionId = ids.decisions[2];
  const baseline = createClarificationState(actor, ids, time(0));
  const first = appendClarificationEvidence(baseline, evidence(time(1), ["documents:read", "documents:write"], "Production", capturedMarkup), uuid(110), uuid(111), time(2));
  const reviewed = openClarificationReview(first, decisionId, uuid(112), time(3));
  const resolved = appendClarificationOutcome(reviewed, decisionId, revised(initialStatement, ["documents:read", "documents:write"]), uuid(113), time(4));
  const unknown = appendClarificationEvidence(resolved, evidence(time(5), ["documents:read", "documents:write"], "Unknown", "Synthetic Unknown context capture requires another applicability assessment; effective permissions and runtime stay unobserved."), uuid(114), uuid(115), time(6));
  const unknownReview = openClarificationReview(unknown, decisionId, uuid(116), time(7));
  const held = appendClarificationOutcome(unknownReview, decisionId, deferred(), uuid(117), time(8));
  const clarified = appendClarificationEvidence(held, evidence(time(9), ["documents:read", "documents:write", "documents:delete"], "Production", futureNote), uuid(118), uuid(119), time(10));
  const replacement = replaceClarificationReview(clarified, decisionId, { actor, rationale: "Synthetic reviewer explicitly replaces the deferred Unknown question with the later Production declaration; the prior accepted scope stays unchanged." }, uuid(120), uuid(121), time(11));
  const state = appendClarificationOutcome(replacement, decisionId, revised(finalStatement, ["documents:read", "documents:write", "documents:delete"]), uuid(122), time(12));
  return { state, decisionId, baselineId: ids.event, firstCaptureId: uuid(110), firstEvidenceId: uuid(111), firstReviewId: uuid(112), firstOutcomeId: uuid(113), unknownCaptureId: uuid(114), unknownReviewId: uuid(116), deferralId: uuid(117), clarifiedCaptureId: uuid(118), replacementId: uuid(120), replacementReviewId: uuid(121), finalOutcomeId: uuid(122) };
}
export function tiedFixture(): TiedFixture {
  const ids = creationIds(200), decisionId = ids.decisions[0];
  const baseline = createClarificationState(actor, ids, time(0));
  const capture = appendClarificationEvidence(baseline, evidence(time(1), ["documents:read", "documents:write"], "Unknown", "Synthetic same-millisecond capture with an exact dependent review and resolution."), uuid(210), uuid(211), time(1));
  const review = openClarificationReview(capture, decisionId, uuid(212), time(1));
  const state = appendClarificationOutcome(review, decisionId, revised("Synthetic request scope accepts read and write for this exact captured boundary; deployment and runtime remain unobserved.", ["documents:read", "documents:write"]), uuid(213), time(1));
  return { state, decisionId, captureId: uuid(210), reviewId: uuid(212), outcomeId: uuid(213) };
}
export function ambiguousFixture(): AmbiguousFixture {
  const ids = creationIds(300), decisionId = ids.decisions[0];
  const baseline = createClarificationState(actor, ids, time(0));
  const capture = appendClarificationEvidence(baseline, evidence(time(1), ["documents:read", "documents:write"], "Unknown", "Synthetic original target for independent equal-time capture and outcome operations."), uuid(310), uuid(311), time(1));
  const reviewed = openClarificationReview(capture, decisionId, uuid(312), time(2));
  const next = evidence(time(3), ["documents:read", "documents:write", "documents:delete"], "Unknown", "Synthetic independent equal-time capture has no recorded causal order relative to the old review outcome.");
  const outcome = revised("Synthetic request scope accepts read and write for this exact captured boundary; deployment and runtime remain unobserved.", ["documents:read", "documents:write"]);
  const state = appendClarificationOutcome(appendClarificationEvidence(reviewed, next, uuid(313), uuid(314), time(3)), decisionId, outcome, uuid(315), time(3));
  const reversed = appendClarificationEvidence(appendClarificationOutcome(reviewed, decisionId, outcome, uuid(315), time(3)), next, uuid(313), uuid(314), time(3));
  return { state, reversed, decisionId, captureId: uuid(313), outcomeId: uuid(315) };
}

function checkModel(fixture: BasisFixture, tied: TiedFixture, ambiguous: AmbiguousFixture): void {
  const originalBytes = JSON.stringify(fixture.state), events = decisionBasisEvents(fixture.state, fixture.decisionId);
  assert.equal(events.length, 10, "The replacement and new review form one selectable atomic event.");
  assert.deepEqual(events.find((event): boolean => event.kind === "original")?.memberIds, [fixture.baselineId, fixture.decisionId]);
  assert.deepEqual(events.find((event): boolean => event.kind === "replacement")?.memberIds, [fixture.replacementId, fixture.replacementReviewId]);
  const original = decisionBasisAt(fixture.state, fixture.decisionId, fixture.baselineId);
  assert.equal(original.historical.basis?.revision, `${fixture.decisionId}.1`);
  assert.equal(original.historical.knownSource.id, fixture.baselineId);
  assert.deepEqual(original.historical.reviews, []); assert.deepEqual(original.historical.outcomes, []);
  assert.deepEqual(original.includedEventIds, [fixture.baselineId]);
  assert.ok(original.excludedEventIds.includes(fixture.finalOutcomeId));
  assert.deepEqual(decisionBasisAt(fixture.state, fixture.decisionId, fixture.decisionId), original);
  const firstCapture = decisionBasisAt(fixture.state, fixture.decisionId, fixture.firstCaptureId);
  assert.equal(firstCapture.historical.knownSource.recordedAt, time(2));
  assert.equal(firstCapture.historical.knownSource.evidence.capturedAt, time(1));
  assert.equal(firstCapture.historical.basis?.revision, `${fixture.decisionId}.1`);
  assert.equal(firstCapture.historical.pendingReview, null);
  const firstReview = decisionBasisAt(fixture.state, fixture.decisionId, fixture.firstReviewId);
  assert.equal(firstReview.historical.pendingReview?.id, fixture.firstReviewId);
  assert.equal(firstReview.historical.basis?.revision, `${fixture.decisionId}.1`);
  assert.deepEqual(firstReview.historical.outcomes, []);
  const revisedBasis = decisionBasisAt(fixture.state, fixture.decisionId, fixture.firstOutcomeId);
  assert.equal(revisedBasis.historical.basis?.statement, initialStatement);
  assert.equal(revisedBasis.historical.support?.id, fixture.firstCaptureId);
  assert.equal(revisedBasis.historical.pendingReview, null);
  const deferredBasis = decisionBasisAt(fixture.state, fixture.decisionId, fixture.deferralId);
  assert.equal(deferredBasis.historical.basis?.revision, `${fixture.decisionId}.2`);
  assert.equal(deferredBasis.historical.basis?.statement, initialStatement);
  assert.deepEqual(deferredBasis.historical.basis?.acceptedPermissions, ["documents:read", "documents:write"]);
  assert.equal(deferredBasis.historical.record.assumption.scope, "Production");
  assert.deepEqual(deferredBasis.historical.record.assumption.acceptedPermissions, ["documents:read"]);
  assert.equal(deferredBasis.historical.support?.evidence.id, fixture.firstEvidenceId);
  assert.equal(deferredBasis.historical.knownSource.id, fixture.unknownCaptureId);
  assert.equal(deferredBasis.historical.pendingReview?.id, fixture.unknownReviewId);
  assert.deepEqual(deferredBasis.historical.outcomes.map((outcome): string => outcome.id), [fixture.firstOutcomeId, fixture.deferralId]);
  assert.deepEqual(deferredBasis.historical.replacements, []);
  assert.equal(JSON.stringify(deferredBasis.historical).includes(futureNote), false);
  assert.equal(JSON.stringify(deferredBasis.historical).includes(finalStatement), false);
  assert.equal(deferredBasis.latest.basis?.revision, `${fixture.decisionId}.4`);
  assert.equal(deferredBasis.latest.knownSource.id, fixture.clarifiedCaptureId);
  const clarified = decisionBasisAt(fixture.state, fixture.decisionId, fixture.clarifiedCaptureId);
  assert.equal(clarified.historical.pendingReview?.id, fixture.unknownReviewId, "A capture cannot silently replace the old review.");
  assert.deepEqual(clarified.historical.replacements, []);
  const replacement = decisionBasisAt(fixture.state, fixture.decisionId, fixture.replacementId);
  assert.deepEqual(decisionBasisAt(fixture.state, fixture.decisionId, fixture.replacementReviewId), replacement);
  assert.equal(replacement.historical.basis?.revision, `${fixture.decisionId}.2`);
  assert.equal(replacement.historical.pendingReview?.id, fixture.replacementReviewId);
  assert.equal(replacement.historical.reviews.length, 3); assert.equal(replacement.historical.outcomes.length, 2);
  assert.equal(replacement.historical.replacements.length, 1);
  assert.equal(replacement.historical.reviews[1]?.evidenceId, fixture.state.reviews[1]?.evidenceId);
  assert.equal(decisionBasisAt(fixture.state, fixture.decisionId, "latest").event, null);
  assert.deepEqual(decisionBasisAt(fixture.state, fixture.decisionId, fixture.finalOutcomeId).historical, deferredBasis.latest);
  assert.throws((): void => { decisionBasisAt(fixture.state, fixture.decisionId, uuid(900)); }, /event.*does not belong/i);
  assert.throws((): void => { decisionBasisAt(fixture.state, uuid(901), fixture.firstReviewId); }, /decision.*does not belong/i);
  const independent = fixture.state.originalDecisions[0]; assert.ok(independent !== undefined);
  assert.throws((): void => { decisionBasisAt(fixture.state, independent.decision.id, fixture.firstReviewId); }, /event.*does not belong/i);
  assert.throws((): void => { decisionBasisAt(fixture.state, fixture.decisionId, fixture.firstEvidenceId); }, /event.*does not belong/i);
  assert.equal(JSON.stringify(fixture.state), originalBytes, "Success and failure must preserve every input field.");
  const tiedCapture = decisionBasisAt(tied.state, tied.decisionId, tied.captureId);
  assert.deepEqual(tiedCapture.historical.reviews, []); assert.deepEqual(tiedCapture.historical.outcomes, []);
  const tiedReview = decisionBasisAt(tied.state, tied.decisionId, tied.reviewId);
  assert.equal(tiedReview.historical.pendingReview?.id, tied.reviewId); assert.deepEqual(tiedReview.historical.outcomes, []);
  assert.equal(decisionBasisAt(tied.state, tied.decisionId, tied.outcomeId).historical.basis?.revision, `${tied.decisionId}.2`);
  const ambiguousBytes = JSON.stringify(ambiguous.state);
  assert.equal(ambiguousBytes, JSON.stringify(ambiguous.reversed), "Opposite mutation orders really produce indistinguishable valid v6 history.");
  assert.throws((): void => { decisionBasisAt(ambiguous.state, ambiguous.decisionId, ambiguous.captureId); }, /ambiguous/i);
  assert.throws((): void => { decisionBasisAt(ambiguous.state, ambiguous.decisionId, ambiguous.outcomeId); }, /ambiguous/i);
  assert.equal(decisionBasisAt(ambiguous.state, ambiguous.decisionId, "latest").historical.basis?.revision, `${ambiguous.decisionId}.2`);
  assert.equal(JSON.stringify(ambiguous.state), ambiguousBytes);
  checkWithdrawal(fixture);
  checkCycle(tied);
  checkEventBound();
}
function checkWithdrawal(fixture: BasisFixture): void {
  const capture = appendClarificationEvidence(fixture.state, evidence(time(13), ["documents:read", "documents:write", "documents:delete"], "Unknown", "Synthetic later Unknown context allows an accountable withdrawal without inventing deployment assurance."), uuid(123), uuid(124), time(13));
  const review = openClarificationReview(capture, fixture.decisionId, uuid(125), time(14));
  const state = appendClarificationOutcome(review, fixture.decisionId, { actor, outcome: "withdraw", rationale: "Synthetic reviewer withdraws the active scope while deployment applicability remains unresolved.", statement: "Withdraw this synthetic production decision; earlier scopes and evidence remain preserved.", acceptedPermissions: null }, uuid(126), time(15));
  const inspection = decisionBasisAt(state, fixture.decisionId, uuid(126));
  assert.equal(inspection.historical.basis, null); assert.equal(inspection.historical.support, null);
  assert.equal(inspection.historical.pendingReview, null); assert.equal(inspection.historical.outcomes.at(-1)?.outcome, "withdraw");
  assert.equal(decisionBasisAt(state, fixture.decisionId, fixture.deferralId).historical.basis?.revision, `${fixture.decisionId}.2`);
  assert.equal(decisionBasisAt(state, fixture.decisionId, fixture.deferralId).latest.basis, null);
}
function checkCycle(tied: TiedFixture): void {
  const capture = appendClarificationEvidence(tied.state, evidence(time(1), ["documents:read", "documents:write", "documents:delete"], "Unknown", "Synthetic second tied capture for contradictory recorded outcome ordering."), uuid(214), uuid(215), time(1));
  const review = openClarificationReview(capture, tied.decisionId, uuid(216), time(1));
  const state = appendClarificationOutcome(review, tied.decisionId, revised("Synthetic request scope accepts read, write and delete for this exact captured boundary, without deployment assurance.", ["documents:read", "documents:write", "documents:delete"]), uuid(217), time(1));
  const contradictory = ClarificationStateSchema.parse({ ...state, outcomes: state.outcomes.toReversed() });
  assert.throws((): void => { decisionBasisAt(contradictory, tied.decisionId, uuid(217)); }, /cycle|contradict/i);
  assert.throws((): void => { decisionBasisAt(contradictory, tied.decisionId, "latest"); }, /cycle|contradict/i);
}
function checkEventBound(): void {
  const ids = creationIds(1000), baseline = createClarificationState(actor, ids, time(0));
  const sources = Array.from({ length: 256 }, (_, index: number): ClarificationState["sources"][number] => ({ id: uuid(1100 + index * 2), recordedAt: time(index + 1), evidence: { ...evidence(time(index + 1), ["documents:read"], "Unknown", "Synthetic recorded capture for the explicit bounded historical inspector limit."), id: uuid(1101 + index * 2), sourceId: baseline.source.id, observedActivity: "Not observed", provenance: "Synthetic" } }));
  const state = ClarificationStateSchema.parse({ ...baseline, sources: [...baseline.sources, ...sources] });
  const recordedBytes = JSON.stringify(state);
  const atLimit = ClarificationStateSchema.parse({ ...state, sources: state.sources.slice(0, 256) });
  assert.equal(decisionBasisEvents(atLimit, ids.decisions[0]).length, 256);
  assert.equal(decisionBasisAt(atLimit, ids.decisions[0], "latest").historical.knownSource.id, atLimit.sources.at(-1)?.id);
  assert.throws((): void => { decisionBasisEvents(state, ids.decisions[0]); }, /at most 256|256.*events/i);
  assert.equal(JSON.stringify(state), recordedBytes, "The bound must fail without truncating recorded history.");
}

async function bytes(page: Page): Promise<Record<string, string>> { return page.evaluate((): Record<string, string> => Object.fromEntries(Object.entries(localStorage))); }
async function saved(page: Page, id: string): Promise<ClarificationState> {
  return ClarificationStateSchema.parse(JSON.parse(z.string().parse(await page.evaluate((key: string): string | null => localStorage.getItem(key), clarificationStorageKey(id)))));
}
async function ready(page: Page): Promise<void> { await page.locator('html[data-app-ready="true"]').waitFor(); }
async function restore(page: Page, content: string, id: string): Promise<void> {
  const before = await bytes(page);
  await page.getByTestId("import-toggle").click();
  await page.getByTestId("import-file").setInputFiles({ name: "basis-history.json", mimeType: "application/json", buffer: Buffer.from(content) });
  await page.getByTestId("inspect-import").click();
  await page.getByTestId("import-preview").waitFor({ state: "visible" });
  assert.equal(await page.getByTestId("confirm-import").isEnabled(), true);
  assert.deepEqual(await bytes(page), before, "Export inspection itself must write no browser storage.");
  const navigation = page.waitForEvent("domcontentloaded");
  await page.getByTestId("confirm-import").click(); await navigation; await ready(page);
  assert.equal(new URL(page.url()).searchParams.get("session"), id);
}
async function download(page: Page): Promise<string> {
  const waiting = page.waitForEvent("download"); await page.getByTestId("shared-export").click();
  return readFile(z.string().parse(await (await waiting).path()), "utf8");
}
async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(result.violations.map((item): string => `${item.id}: ${item.nodes.map((node): string => node.target.join(", ")).join(", ")}`), []);
  assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true, "Historical references must wrap within the viewport.");
}
async function historical(page: Page, fixture: BasisFixture): Promise<void> {
  await page.getByTestId("basis-decision").selectOption(fixture.decisionId);
  await page.getByTestId("basis-event").selectOption(fixture.deferralId);
  assert.equal(await page.getByTestId("basis-historical").getAttribute("data-basis-revision"), `${fixture.decisionId}.2`);
  assert.equal(await page.getByTestId("basis-historical").getAttribute("data-known-source-id"), fixture.unknownCaptureId);
  assert.equal(await page.getByTestId("basis-historical").getAttribute("data-pending-review-id"), fixture.unknownReviewId);
  assert.equal(await page.getByTestId("basis-latest").getAttribute("data-basis-revision"), `${fixture.decisionId}.4`);
  assert.equal(await page.getByTestId("basis-latest").getAttribute("data-known-source-id"), fixture.clarifiedCaptureId);
  const text = z.string().parse(await page.getByTestId("basis-historical").textContent());
  assert.ok(text.includes(initialStatement)); assert.equal(text.includes(finalStatement), false); assert.equal(text.includes(futureNote), false);
  await page.getByTestId("basis-historical-evidence").locator("summary").click();
  assert.equal(await page.getByTestId("basis-historical-support-note").innerText(), capturedMarkup);
  assert.ok((await page.getByTestId("basis-latest").innerText()).includes(finalStatement));
  assert.ok((await page.getByTestId("basis-differences").innerText()).includes(`${fixture.decisionId}.2`));
  assert.equal(await page.getByTestId("basis-panel").locator("img").count(), 0, "Captured markup must remain escaped text.");
}

/** Real recovery and native selectors exercise immutable recorded perspectives without a service mock or storage migration. */
export async function checkDecisionBasis(browser: Browser, url: string): Promise<void> {
  const fixture = basisFixture(), tied = tiedFixture(), ambiguous = ambiguousFixture();
  checkModel(fixture, tied, ambiguous);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
  for (const item of [context, mobile]) item.setDefaultTimeout(5000);
  try {
    const page = await context.newPage(), destination = await mobile.newPage(), errors: Error[] = [];
    page.on("pageerror", (error: Error): void => { errors.push(error); });
    destination.on("pageerror", (error: Error): void => { errors.push(error); });
    await page.goto(url); await ready(page); await page.getByTestId("load-control").click();
    await page.getByTestId("new-version-session").click(); await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    await page.getByTestId("your-decisions").click(); await fillCreation(page, "Older basis inspector v3 guard");
    await page.getByTestId("authored-create").click(); await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    await page.getByTestId("new-continuity").click(); await fillCreation(page, "Older basis inspector v4 guard");
    await page.getByTestId("authored-create").click(); await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    const old = createSharedState(actor, creationIds(2000), time(0));
    await page.goto(`${url}/impact.html`); await ready(page); await restore(page, JSON.stringify(sharedHistoryExport(old, time(20))), old.id);
    const older = await bytes(page); assert.equal(Object.keys(older).length, 5);
    const content: string = JSON.stringify(clarificationHistoryExport(fixture.state, time(20)), null, 2);
    await page.goto(`${url}/impact.html?format=6`); await ready(page); await restore(page, content, fixture.state.id);
    assert.deepEqual(await saved(page, fixture.state.id), fixture.state);
    for (const [key, value] of Object.entries(older)) assert.equal((await bytes(page))[key], value);
    const preserved = await bytes(page);
    await historical(page, fixture); await accessible(page);
    assert.deepEqual(await bytes(page), preserved);
    await page.getByTestId("basis-event").selectOption(fixture.baselineId);
    assert.equal(await page.getByTestId("basis-historical").getAttribute("data-basis-revision"), `${fixture.decisionId}.1`);
    assert.equal((await page.getByTestId("basis-historical").innerText()).includes(initialStatement), false);
    await page.getByTestId("basis-event").selectOption(fixture.firstCaptureId);
    assert.ok((await page.getByTestId("basis-historical-known-source").innerText()).includes(time(1)));
    assert.ok((await page.getByTestId("basis-historical-known-source").innerText()).includes(time(2)));
    await page.getByTestId("basis-event").selectOption(fixture.replacementId);
    assert.equal(await page.getByTestId("basis-historical").getAttribute("data-pending-review-id"), fixture.replacementReviewId);
    assert.equal(await page.getByTestId("basis-historical").getAttribute("data-basis-revision"), `${fixture.decisionId}.2`);
    await page.getByTestId("basis-historical-replacements").locator("summary").click();
    assert.ok((await page.getByTestId("basis-historical-replacements").innerText()).includes(fixture.unknownReviewId));
    const options = await page.getByTestId("basis-event").evaluate((element): string[] => {
      if (!(element instanceof HTMLSelectElement)) throw new TypeError("Historical event picker must be a native select.");
      return Array.from(element.options, (option): string => option.value);
    });
    const preceding = options[options.indexOf(fixture.deferralId) - 1]; assert.notEqual(preceding, undefined);
    await page.getByTestId("basis-event").selectOption(z.string().parse(preceding)); await page.getByTestId("basis-event").focus();
    await page.keyboard.press("o"); await page.keyboard.press("Tab");
    assert.equal(await page.getByTestId("basis-event").inputValue(), fixture.deferralId, "Native keyboard selection must inspect the chosen event.");
    await historical(page, fixture);
    await page.getByTestId("basis-panel").screenshot({ path: "output/playwright/basis-desktop.png", animations: "disabled" });
    assert.deepEqual(await bytes(page), preserved);
    await page.reload(); await ready(page); assert.deepEqual(await bytes(page), preserved); await historical(page, fixture);
    const downloaded = await download(page);
    assert.deepEqual(ClarificationHistoryExportSchema.parse(JSON.parse(downloaded)).session, fixture.state);
    assert.deepEqual(await bytes(page), preserved);
    await restore(page, downloaded, fixture.state.id); assert.deepEqual(await bytes(page), preserved);
    await destination.goto(`${url}/impact.html?format=6`); await ready(destination);
    await restore(destination, downloaded, fixture.state.id);
    const mobileBytes = await bytes(destination); await historical(destination, fixture); await accessible(destination);
    assert.equal(await destination.evaluate((): string => getComputedStyle(document.documentElement).scrollBehavior), "auto");
    await destination.getByTestId("basis-panel").screenshot({ path: "output/playwright/basis-mobile.png", animations: "disabled" });
    assert.deepEqual(await bytes(destination), mobileBytes);
    await restore(page, JSON.stringify(clarificationHistoryExport(ambiguous.state, time(20))), ambiguous.state.id);
    const beforeError = await bytes(page);
    await page.getByTestId("basis-decision").selectOption(ambiguous.decisionId);
    await page.getByTestId("basis-event").selectOption(ambiguous.captureId);
    await page.getByTestId("basis-error").waitFor({ state: "visible" });
    assert.match(await page.getByTestId("basis-error").innerText(), /ambiguous/i);
    assert.equal(await page.getByTestId("basis-latest").isVisible(), true);
    assert.equal(await page.getByTestId("basis-historical").getAttribute("data-basis-revision"), null);
    assert.equal(await page.getByTestId("basis-historical").getAttribute("data-known-source-id"), null);
    assert.match(await page.getByTestId("basis-historical").innerText(), /unavailable/i);
    assert.deepEqual(await bytes(page), beforeError, "An ambiguous historical selection must preserve all actual stored bytes.");
    await page.getByTestId("basis-event").selectOption("latest");
    assert.equal(await page.getByTestId("basis-error").isVisible(), false);
    assert.equal(await page.getByTestId("basis-historical").getAttribute("data-basis-revision"), `${ambiguous.decisionId}.2`);
    assert.deepEqual(await bytes(page), beforeError);
    for (const [key, value] of Object.entries(older)) assert.equal((await bytes(page))[key], value);
    assert.deepEqual(errors, []);
    console.log("decision_basis_smoke_passed", { revisionBeforeClarification: true, atomicReplacement: true, noFutureLeakage: true, equalTimeCausalOrder: true, equalTimeAmbiguityRejected: true, cyclesRejected: true, unknownSelectionsRejected: true, withdrawal: true, eventBound: 256, pureInputs: true, rawStoragePreserved: true, olderFormatsPreserved: 5, recovery: true, keyboard: true, mobile: true, accessibility: true, practitionerParticipation: false });
  } finally { await context.close(); await mobile.close(); }
}
