import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { appendClarificationEvidence, appendClarificationOutcome, ClarificationStateSchema, openClarificationReview, replaceClarificationReview } from "../src/clarification-model.ts";
import { clarificationStorageKey } from "../src/clarification-storage.ts";
import { sharedBasis, sharedPendingReview } from "../src/shared-model.ts";
import { appendUncertaintyRequirement, appendUncertaintyResolution, createUncertaintyState, UncertaintyStateSchema, updateUncertaintyHistory } from "../src/uncertainty-model.ts";
import type { RequirementInput, UncertaintyState } from "../src/uncertainty-model.ts";
import { uncertaintyHistoryExport, UncertaintyHistoryExportSchema } from "../src/uncertainty-export.ts";
import { uncertaintyStorageKey } from "../src/uncertainty-storage.ts";
import { basisFixture, tiedFixture } from "./basis-smoke.ts";
import { fillCreation } from "./authored-smoke.ts";

const actor: string = "SIM_BASIS";
const requiredInput: RequirementInput = {
  actor, question: "Which deployment context is declared for the exact later synthetic manifest?",
  requiredEvidence: "A later source capture must explicitly declare Production. Requested and granted permissions remain independent; runtime is not observed.",
  triggerDescription: "A later declared Production capture should prompt a separate frozen reassessment of the existing production hold.",
};
export type UncertaintyFixture = Readonly<{
  initial: UncertaintyState; required: UncertaintyState; insufficient: UncertaintyState; satisfied: UncertaintyState; completed: UncertaintyState;
  decisionId: string; reviewId: string; deferralId: string; requirementId: string; unknownCaptureId: string; productionCaptureId: string;
}>;

function uuid(index: number): string { return z.uuid().parse(`00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`); }
function time(seconds: number): string { return new Date(Date.parse("2026-10-06T00:00:00.000Z") + seconds * 1000).toISOString(); }

/** Use an existing deferred v6 prefix; requirements and observations are explicit synthetic records. */
export function uncertaintyFixture(): UncertaintyFixture {
  const original = basisFixture();
  const history = ClarificationStateSchema.parse({ ...original.state, sources: original.state.sources.slice(0, 3), reviews: original.state.reviews.slice(0, 2), outcomes: original.state.outcomes.slice(0, 2), replacements: [] });
  const initial = createUncertaintyState(history, uuid(500), time(9));
  const requirementId = uuid(501), unknownCaptureId = uuid(502), productionCaptureId = uuid(505);
  const required = appendUncertaintyRequirement(initial, original.decisionId, requiredInput, requirementId, time(9));
  const unknown = updateUncertaintyHistory(required, appendClarificationEvidence(required.history, {
    capturedAt: time(10), environment: "Unknown", requestedPermissions: ["documents:read", "documents:write"], grantedPermissions: ["documents:read"],
    sourceNote: "Synthetic later capture still declares Unknown; it cannot satisfy the Production declaration requirement or establish runtime behavior.",
  }, unknownCaptureId, uuid(503), time(10)));
  const insufficient = appendUncertaintyResolution(unknown, requirementId, {
    actor, sourceEventId: unknownCaptureId, result: "insufficient", rationale: "Synthetic accountable reviewer records that this exact later Unknown declaration does not answer the recorded applicability question.",
  }, uuid(504), time(11));
  const production = updateUncertaintyHistory(insufficient, appendClarificationEvidence(insufficient.history, {
    capturedAt: time(12), environment: "Production", requestedPermissions: ["documents:read", "documents:write", "documents:delete"], grantedPermissions: ["documents:read"],
    sourceNote: "Synthetic later Production declaration answers deployment applicability only. Added requests and unobserved runtime still require separate human reassessment.",
  }, productionCaptureId, uuid(506), time(12)));
  const satisfied = appendUncertaintyResolution(production, requirementId, {
    actor, sourceEventId: productionCaptureId, result: "satisfied", rationale: "Synthetic reviewer records the exact declared Production capture satisfying the narrow evidence requirement; no approval or runtime assurance is inferred.",
  }, uuid(507), time(13));
  const replacement = updateUncertaintyHistory(satisfied, replaceClarificationReview(satisfied.history, original.decisionId, {
    actor, rationale: "Synthetic reviewer explicitly replaces the deferred Unknown question with a separate Production reassessment, preserving both questions and the earlier basis.",
  }, uuid(508), uuid(509), time(14)));
  const completed = updateUncertaintyHistory(replacement, appendClarificationOutcome(replacement.history, original.decisionId, {
    actor, outcome: "revise", acceptedPermissions: ["documents:read", "documents:write", "documents:delete"],
    statement: "Synthetic production request scope accepts read, write and delete for the separately reviewed exact declared Production capture.",
    rationale: "Synthetic accountable outcome considers the exact clarified target and keeps declared grants separate from requests and actual runtime activity.",
  }, uuid(510), time(15)));
  return { initial, required, insufficient, satisfied, completed, decisionId: original.decisionId, reviewId: original.unknownReviewId, deferralId: original.deferralId, requirementId, unknownCaptureId, productionCaptureId };
}

/** Runtime invariants reject invented responsibility, references, chronology and journal replacement. */
export function checkUncertaintyModel(): void {
  const item = uncertaintyFixture(), initialBytes = JSON.stringify(item.initial), originalHistory = JSON.stringify(item.initial.history);
  const requirement = item.required.requirements[0]; assert.ok(requirement !== undefined);
  assert.equal(item.initial.schemaVersion, 7); assert.notEqual(item.initial.id, item.initial.history.id);
  assert.equal(JSON.stringify(item.required.history), originalHistory);
  assert.equal(requirement.reviewId, item.reviewId); assert.equal(requirement.deferredOutcomeId, item.deferralId);
  assert.equal(requirement.expectedEnvironment, "Production"); assert.equal(requirement.field, "environment");
  const originalBasis = sharedBasis(item.initial.history, item.decisionId);
  for (const state of [item.required, item.insufficient, item.satisfied]) {
    assert.deepEqual(sharedBasis(state.history, item.decisionId), originalBasis);
    assert.deepEqual(state.history.reviews, item.initial.history.reviews);
    assert.deepEqual(state.history.outcomes, item.initial.history.outcomes);
    assert.deepEqual(state.history.replacements, []);
  }
  assert.equal(item.insufficient.resolutions[0]?.result, "insufficient");
  assert.equal(item.satisfied.resolutions[1]?.sourceEventId, item.productionCaptureId);
  assert.equal(item.satisfied.resolutions[1]?.result, "satisfied");
  assert.equal(sharedPendingReview(item.satisfied.history, item.decisionId)?.id, item.reviewId, "Satisfying a declaration requirement cannot close or replace its frozen review.");
  assert.equal(item.completed.history.replacements[0]?.oldReviewId, item.reviewId);
  assert.equal(sharedBasis(item.completed.history, item.decisionId)?.sourceEventId, item.productionCaptureId);
  assert.deepEqual(item.completed.requirements, item.required.requirements);
  assert.deepEqual(item.completed.resolutions, item.satisfied.resolutions);
  const exported = uncertaintyHistoryExport(item.completed, time(16));
  assert.equal(exported.exportSchemaVersion, 6);
  assert.deepEqual(UncertaintyHistoryExportSchema.parse(JSON.parse(JSON.stringify(exported))).session, item.completed);
  assert.throws((): void => { uncertaintyHistoryExport(item.completed, time(14)); }, z.ZodError);

  assert.throws((): void => { appendUncertaintyRequirement(item.initial, item.decisionId, { ...requiredInput, actor: "OTHER_REVIEWER" }, uuid(520), time(9)); }, /assigned|actor|reviewer|responsib/i);
  assert.throws((): void => { appendUncertaintyRequirement(item.required, item.decisionId, requiredInput, uuid(521), time(9)); }, /requirement|already|one/i);
  assert.throws((): void => { appendUncertaintyRequirement(item.initial, uuid(522), requiredInput, uuid(523), time(9)); }, /decision|belong/i);
  assert.throws((): void => { appendUncertaintyRequirement(item.initial, item.decisionId, requiredInput, uuid(524), time(7)); }, /time|creation|record|predate|chronolog/i);
  const requestDecision = item.initial.history.originalDecisions[0]; assert.ok(requestDecision !== undefined);
  assert.throws((): void => { appendUncertaintyRequirement(item.initial, requestDecision.decision.id, requiredInput, uuid(525), time(9)); }, /Production|production|review|defer/i);
  assert.throws((): void => { appendUncertaintyResolution(item.insufficient, item.requirementId, {
    actor, sourceEventId: item.unknownCaptureId, result: "insufficient", rationale: "Synthetic repeated target must be rejected instead of duplicating an existing resolution attempt.",
  }, uuid(526), time(11)); }, /later|candidate|capture|already|order|index/i);
  assert.throws((): void => { appendUncertaintyResolution(item.required, item.requirementId, {
    actor, sourceEventId: requirement.sourceEventId, result: "insufficient", rationale: "Synthetic old frozen target is not later evidence and must not resolve its own newly recorded requirement.",
  }, uuid(527), time(10)); }, /later|capture|candidate|requirement/i);
  assert.throws((): void => { appendUncertaintyResolution(item.insufficient, item.requirementId, {
    actor, sourceEventId: item.unknownCaptureId, result: "satisfied", rationale: "Synthetic Unknown context must never satisfy a Production declaration requirement.",
  }, uuid(528), time(11)); }, /later|Production|production|capture|candidate/i);
  assert.throws((): void => { appendUncertaintyResolution(item.insufficient, item.requirementId, {
    actor: "OTHER_REVIEWER", sourceEventId: item.unknownCaptureId, result: "insufficient", rationale: "Synthetic unassigned reviewer cannot add a resolution attributed to the responsible reviewer.",
  }, uuid(529), time(11)); }, /assigned|actor|reviewer|responsib/i);
  assert.throws((): void => { appendUncertaintyResolution(item.required, uuid(530), {
    actor, sourceEventId: uuid(531), result: "insufficient", rationale: "Synthetic missing references cannot create or satisfy an uncertainty requirement.",
  }, uuid(532), time(10)); }, /requirement|belong|reference/i);
  assert.throws((): void => { appendUncertaintyResolution(item.required, item.requirementId, {
    actor, sourceEventId: uuid(533), result: "insufficient", rationale: "Synthetic missing candidate capture cannot resolve an exact recorded requirement.",
  }, uuid(534), time(10)); }, /capture|candidate|source|belong/i);
  assert.throws((): void => { appendUncertaintyResolution(item.satisfied, item.requirementId, {
    actor, sourceEventId: item.productionCaptureId, result: "insufficient", rationale: "Synthetic satisfied requirement is terminal; later appends cannot reopen its resolution implicitly.",
  }, uuid(535), time(14)); }, /satisfied|terminal|resolved|closed/i);
  assert.throws((): void => { updateUncertaintyHistory(item.satisfied, { ...item.satisfied.history, originalDecisions: item.satisfied.history.originalDecisions.map((record, index: number) => index === 0 ? { ...record, decision: { ...record.decision, rationale: "A different valid synthetic rationale must not replace the original immutable decision record." } } : record) }); }, /immutable|prefix|original|preserv|append/i);
  assert.throws((): void => { updateUncertaintyHistory(item.completed, item.initial.history); }, /immutable|prefix|append|preserv/i);
  const latest = item.satisfied.history.sources.at(-1); assert.ok(latest !== undefined);
  assert.throws((): void => { updateUncertaintyHistory(item.satisfied, { ...item.satisfied.history, sources: item.satisfied.history.sources.map((capture) => capture.id === latest.id ? { ...capture, evidence: { ...capture.evidence, sourceNote: "A different valid synthetic source note cannot replace an already recorded capture." } } : capture) }); }, /immutable|prefix|append|preserv/i);
  const resolution = item.satisfied.resolutions[1]; assert.ok(resolution !== undefined);
  const invalidStates = [
    { ...item.satisfied, requirements: [{ ...requirement, reviewId: uuid(540) }] },
    { ...item.satisfied, requirements: [{ ...requirement, deferredOutcomeId: uuid(541) }] },
    { ...item.satisfied, requirements: [{ ...requirement, actor: "OTHER_REVIEWER" }] },
    { ...item.satisfied, requirements: [{ ...requirement, expectedEnvironment: "Unknown" }] },
    { ...item.satisfied, requirements: [requirement, { ...requirement, id: uuid(542) }] },
    { ...item.satisfied, resolutions: [{ ...resolution, requirementId: resolution.id }] },
    { ...item.satisfied, resolutions: [{ ...resolution, evidenceId: uuid(543) }] },
    { ...item.satisfied, resolutions: [{ ...resolution, actor: "OTHER_REVIEWER" }] },
    { ...item.satisfied, resolutions: [{ ...resolution, recordedAt: time(10) }] },
    { ...item.satisfied, resolutions: [{ ...resolution, sourceEventId: item.unknownCaptureId, evidenceId: item.insufficient.resolutions[0]?.evidenceId }] },
  ];
  for (const state of invalidStates) assert.throws((): void => { UncertaintyStateSchema.parse(state); }, z.ZodError);
  const sameTimeClosure = UncertaintyStateSchema.safeParse({ ...item.completed, requirements: [{ ...requirement, recordedAt: time(14) }] });
  assert.equal(sameTimeClosure.success, false);
  if (sameTimeClosure.success) throw new RangeError("A same-time review closure must not invent before/after ordering for requirement creation.");
  assert.ok(sameTimeClosure.error.issues.some((issue): boolean => issue.message.includes("Same-time closure")));
  const ambiguousHistory = appendClarificationEvidence(item.initial.history, {
    capturedAt: time(8), environment: "Unknown", requestedPermissions: ["documents:read", "documents:write"], grantedPermissions: ["documents:read"],
    sourceNote: "Synthetic capture and earlier review deferral share a recording time without a recorded causal order.",
  }, uuid(570), uuid(571), time(8));
  const ambiguousBytes = JSON.stringify(ambiguousHistory), ambiguousContinuation = createUncertaintyState(ambiguousHistory, uuid(572), time(9));
  assert.deepEqual(ambiguousContinuation.history, ambiguousHistory, "Enrollment preserves a coherent latest state without inventing an ambiguous past cut.");
  assert.throws((): void => { appendUncertaintyRequirement(ambiguousContinuation, item.decisionId, requiredInput, uuid(573), time(9)); }, /ambiguous/i);
  assert.equal(JSON.stringify(ambiguousHistory), ambiguousBytes);
  const tied = tiedFixture(), tiedTime = z.string().parse(tied.state.sources.at(-1)?.recordedAt);
  const extra = appendClarificationEvidence(tied.state, {
    capturedAt: tiedTime, environment: "Unknown", requestedPermissions: ["documents:read", "documents:write", "documents:delete"], grantedPermissions: ["documents:read"],
    sourceNote: "Synthetic tied capture tests cyclic array ordering without changing or truncating the existing history.",
  }, uuid(580), uuid(581), tiedTime);
  const extraReview = openClarificationReview(extra, tied.decisionId, uuid(582), tiedTime);
  const extraOutcome = appendClarificationOutcome(extraReview, tied.decisionId, {
    actor, outcome: "revise", acceptedPermissions: ["documents:read", "documents:write", "documents:delete"],
    statement: "Synthetic request scope accepts read, write and delete for this exact capture; context and runtime remain unobserved.",
    rationale: "Synthetic accountable rationale preserves exact capture references and independently declared grants without inferring runtime assurance.",
  }, uuid(583), tiedTime);
  const cyclic = ClarificationStateSchema.parse({ ...extraOutcome, outcomes: extraOutcome.outcomes.toReversed() }), cyclicBytes = JSON.stringify(cyclic);
  assert.throws((): void => { createUncertaintyState(cyclic, uuid(584), time(9)); }, /cycle|contradict/i);
  assert.equal(JSON.stringify(cyclic), cyclicBytes);
  assert.equal(JSON.stringify(item.initial), initialBytes);
  assert.equal(JSON.stringify(item.initial.history), originalHistory);
}

async function bytes(page: Page): Promise<Record<string, string>> { return page.evaluate((): Record<string, string> => Object.fromEntries(Object.entries(localStorage))); }
async function ready(page: Page): Promise<void> { await page.locator('html[data-app-ready="true"]').waitFor(); }
async function saved(page: Page): Promise<UncertaintyState> {
  const id = z.uuid().parse(new URL(page.url()).searchParams.get("session"));
  const raw = await page.evaluate((key: string): string | null => localStorage.getItem(key), uncertaintyStorageKey(id));
  return UncertaintyStateSchema.parse(JSON.parse(z.string().parse(raw)));
}
async function capture(page: Page, environment: string): Promise<void> {
  await page.getByTestId("shared-time").fill(new Date().toISOString().slice(0, -1).replace(/0+$/, "").replace(/\.$/, ""));
  await page.getByTestId("shared-request-read").check(); await page.getByTestId("shared-request-write").check();
  await page.getByTestId("shared-grant-read").check(); await page.getByTestId("shared-environment").selectOption(environment);
  await page.getByTestId("shared-note").fill("Synthetic declaration for technical rehearsal. Requested access and declared grants stay independent; actual deployment and runtime remain unobserved. <img src=x> stays text.");
  await page.getByTestId("shared-capture").click();
}
async function outcome(page: Page, value: string): Promise<void> {
  await page.getByTestId("shared-outcome").selectOption(value);
  if (value === "revise") { await page.getByTestId("shared-boundary-read").check(); await page.getByTestId("shared-boundary-write").check(); }
  await page.getByTestId("shared-rationale").fill("Simulated accountable reviewer entry tests the exact declaration, preserved scope and independent grants; it establishes no practitioner participation or runtime assurance.");
  await page.getByTestId("shared-statement").fill(value === "defer" ? "Synthetic production hold remains pending declared applicability and a separate accountable reassessment; no approval was recorded." : "Synthetic revised read/write scope applies only to the separately reviewed declared Production capture; runtime remains unobserved.");
  await page.getByTestId("shared-record-outcome").click();
}
async function inspect(page: Page, content: string): Promise<void> {
  await page.getByTestId("import-file").setInputFiles({ name: "uncertainty-history.json", mimeType: "application/json", buffer: Buffer.from(content) });
  await page.getByTestId("inspect-import").click();
}
async function download(page: Page): Promise<string> {
  const waiting = page.waitForEvent("download"); await page.getByTestId("shared-export").click();
  return readFile(z.string().parse(await (await waiting).path()), "utf8");
}
async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(result.violations.map((item): string => `${item.id}: ${item.nodes.map((node): string => node.target.join(", ")).join(", ")}`), []);
  assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true);
}
async function resolve(page: Page, requirementId: string, sourceEventId: string, result: string): Promise<void> {
  await page.getByTestId("uncertainty-requirement-select").selectOption(requirementId);
  await page.getByTestId("uncertainty-candidate-select").selectOption(sourceEventId);
  await page.getByTestId("uncertainty-result").selectOption(result);
  await page.getByTestId("uncertainty-resolution-rationale").fill("Simulated reviewer records this exact candidate declaration against the stated evidence requirement, preserving runtime uncertainty and the separate decision hold.");
  await page.getByTestId("uncertainty-add-resolution").focus(); await page.keyboard.press("Enter");
}

/** Exhaust real storage in a disposable browser profile; no storage implementation is replaced. */
async function checkQuotaFailure(browser: Browser, url: string, content: string, completed: UncertaintyState): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(5000);
  try {
    const page = await context.newPage();
    await page.goto(`${url}/impact.html?format=7`); await ready(page); await page.getByTestId("import-toggle").click();
    await inspect(page, content); await page.getByTestId("confirm-import").click();
    await page.waitForURL((next: URL): boolean => next.searchParams.get("format") === "7" && next.searchParams.get("session") === completed.id); await ready(page);
    const key = uncertaintyStorageKey(completed.id), original = await page.evaluate((id: string): string | null => localStorage.getItem(id), key);
    const quota = await page.evaluate((): Readonly<{ quotaExceeded: true; writes: number }> => {
      let writes: number = 0;
      for (const size of [65536, 4096, 256, 16, 1]) {
        let exhausted: boolean = false;
        for (let attempt = 0; attempt < 256; attempt += 1) {
          try {
            localStorage.setItem(`decision-continuity-quota-smoke:${writes}`, "Q".repeat(size));
            writes += 1;
          } catch (error) {
            if (!(error instanceof DOMException) || error.name !== "QuotaExceededError") throw error;
            exhausted = true;
            break;
          }
        }
        if (!exhausted) throw new RangeError("Real browser quota was not reached within the isolated test's bounded storage budget.");
      }
      return { quotaExceeded: true, writes };
    });
    assert.equal(quota.quotaExceeded, true); assert.ok(quota.writes > 0);
    await capture(page, "Unknown");
    assert.match(await page.getByTestId("shared-error").innerText(), /QuotaExceededError|quota|storage.*full/i);
    assert.equal(await page.evaluate((id: string): string | null => localStorage.getItem(id), key), original, "A real quota failure must preserve the complete prior atomic v7 record.");
    assert.deepEqual(await saved(page), completed);
  } finally { await context.close(); }
}

/** Real local enrollment, evidence attempts, separate reassessment and file recovery preserve older bytes. */
export async function checkActionableUncertainty(browser: Browser, url: string): Promise<void> {
  checkUncertaintyModel();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
  for (const item of [context, mobile]) item.setDefaultTimeout(5000);
  try {
    const page = await context.newPage(), destination = await mobile.newPage(), errors: Error[] = [], expectedMissingErrors: Error[] = [];
    let missingRecoveryStartup: boolean = true;
    page.on("pageerror", (error: Error): void => { errors.push(error); });
    destination.on("pageerror", (error: Error): void => {
      if (missingRecoveryStartup) expectedMissingErrors.push(error);
      else errors.push(error);
    });
    await page.goto(url); await ready(page); await page.getByTestId("load-control").click();
    await page.getByTestId("new-version-session").click(); await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    await page.getByTestId("your-decisions").click(); await fillCreation(page, "Older v3 uncertainty guard");
    await page.getByTestId("authored-create").click(); await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    await page.getByTestId("new-continuity").click(); await fillCreation(page, "Older v4 uncertainty guard");
    await page.getByTestId("authored-create").click(); await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    await page.getByTestId("shared-impact").click(); await ready(page);
    await page.getByTestId("shared-actor").fill(actor); await page.getByTestId("shared-synthetic").check(); await page.getByTestId("shared-create").click();
    await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    const older = await bytes(page);
    await page.getByTestId("clarification-workspace").click(); await ready(page);
    assert.deepEqual(await bytes(page), older, "Opening v6 must not enroll or migrate older records.");
    await page.getByTestId("shared-actor").fill(actor); await page.getByTestId("shared-synthetic").check(); await page.getByTestId("shared-create").click();
    await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    const v6id = z.uuid().parse(new URL(page.url()).searchParams.get("session"));
    const v6initial = ClarificationStateSchema.parse(JSON.parse(z.string().parse(await page.evaluate((key: string): string | null => localStorage.getItem(key), clarificationStorageKey(v6id)))));
    const production = v6initial.originalDecisions[2]; assert.ok(production !== undefined);
    await capture(page, "Unknown"); await page.getByTestId("shared-review-decision").selectOption(production.decision.id); await page.getByTestId("shared-open-review").click();
    await outcome(page, "defer");
    const beforeEnrollment = await bytes(page), preservedV6 = z.string().parse(beforeEnrollment[clarificationStorageKey(v6id)]);
    await page.getByTestId("uncertainty-enroll").focus(); await page.keyboard.press("Enter");
    await page.waitForURL((next: URL): boolean => next.searchParams.get("format") === "7" && next.searchParams.get("session") !== v6id); await ready(page);
    const initial = await saved(page), originalBasis = sharedBasis(initial.history, production.decision.id), oldReview = sharedPendingReview(initial.history, production.decision.id);
    assert.ok(oldReview !== null); assert.equal(initial.history.id, v6id); assert.deepEqual(initial.history, ClarificationStateSchema.parse(JSON.parse(preservedV6)));
    assert.deepEqual(initial.requirements, []); assert.deepEqual(initial.resolutions, []);
    for (const [key, value] of Object.entries(beforeEnrollment)) assert.equal((await bytes(page))[key], value);
    assert.equal(await page.getByTestId("uncertainty-question").inputValue(), "");
    assert.equal(await page.getByTestId("uncertainty-required-evidence").inputValue(), "");
    assert.equal(await page.getByTestId("uncertainty-trigger-description").inputValue(), "");
    await page.getByTestId("shared-review-decision").selectOption(production.decision.id);
    await page.getByTestId("uncertainty-question").fill(requiredInput.question);
    await page.getByTestId("uncertainty-required-evidence").fill(requiredInput.requiredEvidence);
    await page.getByTestId("uncertainty-trigger-description").fill(requiredInput.triggerDescription);
    await page.getByTestId("uncertainty-add-requirement").focus(); await page.keyboard.press("Enter");
    const required = await saved(page), requirement = required.requirements[0]; assert.ok(requirement !== undefined);
    assert.equal(requirement.reviewId, oldReview.id); assert.equal(requirement.deferredOutcomeId, initial.history.outcomes.at(-1)?.id);
    assert.deepEqual(required.history, initial.history); await accessible(page);
    await capture(page, "Unknown"); const unknown = await saved(page), unknownCapture = unknown.history.sources.at(-1); assert.ok(unknownCapture !== undefined);
    const beforeInvalidResolution = await bytes(page);
    await resolve(page, requirement.id, unknownCapture.id, "satisfied");
    assert.match(await page.getByTestId("shared-error").innerText(), /Production|production|declar/i);
    assert.deepEqual(await bytes(page), beforeInvalidResolution, "An Unknown declaration cannot satisfy the requirement or change any saved bytes.");
    await resolve(page, requirement.id, unknownCapture.id, "insufficient"); const insufficient = await saved(page);
    assert.equal(insufficient.resolutions.length, 1); assert.equal(insufficient.resolutions[0]?.result, "insufficient");
    assert.deepEqual(insufficient.history, unknown.history);
    await capture(page, "Production"); const productionState = await saved(page), productionCapture = productionState.history.sources.at(-1); assert.ok(productionCapture !== undefined);
    await resolve(page, requirement.id, productionCapture.id, "satisfied"); const satisfied = await saved(page);
    assert.equal(satisfied.resolutions.length, 2); assert.equal(satisfied.resolutions[1]?.sourceEventId, productionCapture.id);
    assert.deepEqual(satisfied.history, productionState.history);
    assert.deepEqual(satisfied.history.reviews, initial.history.reviews); assert.deepEqual(satisfied.history.outcomes, initial.history.outcomes);
    assert.deepEqual(sharedBasis(satisfied.history, production.decision.id), originalBasis);
    assert.equal(sharedPendingReview(satisfied.history, production.decision.id)?.id, oldReview.id);
    assert.equal(await page.getByTestId("uncertainty-add-resolution").isDisabled(), true);
    assert.equal(await page.locator('#shared-outcome option[value="revise"]').isDisabled(), true, "Evidence satisfaction cannot approve the old Unknown target.");
    assert.equal(await page.locator("#uncertainty-history img").count(), 0); await accessible(page);
    await page.getByTestId("replacement-rationale").fill("Simulated responsible reviewer opens a separate frozen question for the clarified Production declaration; satisfaction itself supplied no decision approval.");
    await page.getByTestId("replacement-actor").fill(actor); await page.getByTestId("replace-review").click();
    const replaced = await saved(page); assert.equal(replaced.history.replacements.length, 1);
    assert.deepEqual(replaced.requirements, satisfied.requirements); assert.deepEqual(replaced.resolutions, satisfied.resolutions);
    assert.deepEqual(sharedBasis(replaced.history, production.decision.id), originalBasis);
    await outcome(page, "revise"); const completed = await saved(page);
    assert.equal(sharedBasis(completed.history, production.decision.id)?.sourceEventId, productionCapture.id);
    assert.equal(completed.history.outcomes.length, initial.history.outcomes.length + 1);
    const completeBytes = await bytes(page), content = await download(page), exported = UncertaintyHistoryExportSchema.parse(JSON.parse(content));
    assert.deepEqual(exported.session, completed); assert.equal(exported.exportSchemaVersion, 6);
    for (const [key, value] of Object.entries(beforeEnrollment)) assert.equal(completeBytes[key], value, "Wrapped v7 evolution preserves every original v1-v6 storage byte.");
    await page.reload(); await ready(page); assert.deepEqual(await saved(page), completed); assert.deepEqual(await bytes(page), completeBytes);
    const missing = destination.waitForEvent("pageerror");
    await destination.goto(`${url}/impact.html?format=7&session=${completed.id}`); await ready(destination);
    const missingError = await missing;
    assert.match(missingError.message, /absent from this browser profile and origin/);
    assert.ok(missingError.message.includes(completed.id)); assert.equal(expectedMissingErrors.length, 1);
    missingRecoveryStartup = false;
    assert.equal(await destination.getByTestId("shared-error").isVisible(), true);
    assert.match(await destination.getByTestId("shared-error").innerText(), /absent from this browser profile and origin/);
    assert.equal(await destination.getByTestId("shared-actor").isDisabled(), true);
    assert.equal(await destination.getByTestId("import-file").isEnabled(), true);
    assert.equal(await destination.getByTestId("inspect-import").isEnabled(), true);
    assert.deepEqual(await bytes(destination), {}, "A missing named continuation must not create history or block explicit file recovery.");
    await destination.getByTestId("import-toggle").click();
    await inspect(destination, content); await destination.getByTestId("import-preview").waitFor({ state: "visible" });
    assert.deepEqual(await bytes(destination), {});
    const restoredNavigation = destination.waitForEvent("domcontentloaded");
    await destination.getByTestId("confirm-import").click(); await restoredNavigation; await ready(destination);
    assert.equal(new URL(destination.url()).searchParams.get("format"), "7");
    assert.equal(new URL(destination.url()).searchParams.get("session"), completed.id);
    assert.deepEqual(await saved(destination), completed); await accessible(destination);
    assert.equal(await destination.evaluate((): string => getComputedStyle(document.documentElement).scrollBehavior), "auto");
    await destination.getByTestId("uncertainty-references-0").focus(); await destination.keyboard.press("Enter");
    const narrowBytes = await bytes(destination);
    await destination.getByTestId("uncertainty-panel").screenshot({ path: "output/playwright/actionable-uncertainty-mobile.png", animations: "disabled" });
    assert.deepEqual(await bytes(destination), narrowBytes);
    await page.getByTestId("uncertainty-panel").screenshot({ path: "output/playwright/actionable-uncertainty-desktop.png", animations: "disabled" });
    assert.deepEqual(UncertaintyHistoryExportSchema.parse(JSON.parse(await download(destination))).session, completed);
    await destination.getByTestId("import-toggle").click(); await inspect(destination, content); await destination.getByTestId("confirm-import").click();
    await destination.waitForURL((next: URL): boolean => next.searchParams.get("session") === completed.id); await ready(destination); assert.deepEqual(await bytes(destination), narrowBytes);
    await destination.getByTestId("import-toggle").click();
    const resolution = completed.resolutions[1]; assert.ok(resolution !== undefined);
    const tampered = [
      { ...completed, requirements: [{ ...requirement, reviewId: uuid(560) }] },
      { ...completed, requirements: [{ ...requirement, sourceEventId: productionCapture.id }] },
      { ...completed, requirements: [{ ...requirement, actor: "OTHER_REVIEWER" }] },
      { ...completed, resolutions: [{ ...resolution, requirementId: resolution.id }] },
      { ...completed, resolutions: [{ ...resolution, sourceEventId: unknownCapture.id, evidenceId: unknownCapture.evidence.id }] },
      { ...completed, resolutions: [{ ...resolution, evidenceId: uuid(561) }] },
      { ...completed, resolutions: [{ ...resolution, recordedAt: requirement.recordedAt }] },
    ];
    for (const session of tampered) {
      await inspect(destination, JSON.stringify({ ...exported, session })); await destination.getByTestId("import-error").waitFor({ state: "visible" });
      assert.deepEqual(await bytes(destination), narrowBytes);
    }
    const conflicting = { ...completed, requirements: [{ ...requirement, question: "A different valid synthetic question conflicts with the existing recorded requirement history." }] };
    await inspect(destination, JSON.stringify({ ...exported, session: conflicting })); await destination.getByTestId("import-error").waitFor({ state: "visible" });
    assert.match(await destination.getByTestId("import-error").innerText(), /already contains different history/); assert.deepEqual(await bytes(destination), narrowBytes);
    await checkQuotaFailure(browser, url, content, completed);
    const stale = await context.newPage(); await stale.goto(page.url()); await ready(stale);
    await capture(page, "Unknown"); const newest = await bytes(page); await capture(stale, "Production");
    assert.match(await stale.getByTestId("shared-error").innerText(), /another tab/); assert.deepEqual(await bytes(stale), newest);
    assert.deepEqual(errors, []);
    console.log("actionable_uncertainty_smoke_passed", { explicitEnrollment: true, accountableRequirement: true, insufficientThenSatisfied: true, noAutomaticApproval: true, separateReassessment: true, exactReferences: true, immutableJournals: true, olderBytesPreserved: true, recovery: true, missingNamedSessionRecovery: true, tamperingRejected: tampered.length, ambiguousRequirementRejected: true, cyclicEnrollmentRejected: true, conflictRejected: true, staleWritesRejected: true, realQuotaFailurePreserved: true, keyboard: true, mobile: true, reducedMotion: true, accessibility: true, practitionerParticipation: false });
  } finally { await context.close(); await mobile.close(); }
}
