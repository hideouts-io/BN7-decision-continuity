import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Browser, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { ClarificationStateSchema } from "../src/clarification-model.ts";
import type { ClarificationState } from "../src/clarification-model.ts";
import { clarificationStorageKey } from "../src/clarification-storage.ts";
import { ClarificationHistoryExportSchema } from "../src/clarification-export.ts";
import { sharedBasis } from "../src/shared-model.ts";
import { fillCreation } from "./authored-smoke.ts";

async function bytes(page: Page): Promise<Record<string, string>> { return page.evaluate((): Record<string, string> => Object.fromEntries(Object.entries(localStorage))); }
async function saved(page: Page): Promise<ClarificationState> {
  const id = z.uuid().parse(new URL(page.url()).searchParams.get("session"));
  return ClarificationStateSchema.parse(JSON.parse(z.string().parse(await page.evaluate((key: string): string | null => localStorage.getItem(key), clarificationStorageKey(id)))));
}
async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(result.violations.map((item): string => `${item.id}: ${item.nodes.map((node): string => node.target.join(" ")).join(", ")}`), []);
  assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true);
}
async function capture(page: Page, environment: string): Promise<void> {
  await page.getByTestId("shared-time").fill(new Date().toISOString().slice(0, -1).replace(/0+$/, "").replace(/\.$/, ""));
  await page.getByTestId("shared-request-read").check(); await page.getByTestId("shared-request-write").check();
  await page.getByTestId("shared-grant-read").check(); await page.getByTestId("shared-environment").selectOption(environment);
  await page.getByTestId("shared-note").fill("Synthetic manifest declaration for technical rehearsal only. Effective grants, actual deployment and runtime activity remain unobserved.");
  await page.getByTestId("shared-capture").click();
}
async function outcome(page: Page, value: string): Promise<void> {
  await page.getByTestId("shared-outcome").selectOption(value);
  if (value === "revise") { await page.getByTestId("shared-boundary-read").check(); await page.getByTestId("shared-boundary-write").check(); }
  await page.getByTestId("shared-rationale").fill("Simulated reviewer response for technical testing only: consider this exact declared-context capture, retain runtime uncertainty, and record a bounded decision.");
  await page.getByTestId("shared-statement").fill(value === "defer" ? "Synthetic production hold remains pending declared context and separate reassessment; no approval was recorded." : "Synthetic revised read/write assessment applies only to the declared Production capture; no real deployment or runtime assurance is established.");
  await page.getByTestId("shared-record-outcome").click();
}
async function download(page: Page): Promise<string> {
  const waiting = page.waitForEvent("download"); await page.getByTestId("shared-export").click();
  return readFile(z.string().parse(await (await waiting).path()), "utf8");
}
async function inspect(page: Page, content: string): Promise<void> {
  await page.getByTestId("import-file").setInputFiles({ name: "clarified-history.json", mimeType: "application/json", buffer: Buffer.from(content) });
  await page.getByTestId("inspect-import").click();
}

/** Real browser capture, explicit replacement, frozen history, file recovery and preserved older namespaces. */
export async function checkReviewClarification(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
  for (const item of [context, mobile]) item.setDefaultTimeout(5000);
  try {
    const page = await context.newPage(), destination = await mobile.newPage();
    await page.goto(url); await page.getByTestId("load-control").click();
    await page.getByTestId("new-version-session").click(); await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    await page.getByTestId("your-decisions").click(); await fillCreation(page, "Older v3 clarification guard");
    await page.getByTestId("authored-create").click(); await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    await page.getByTestId("new-continuity").click(); await fillCreation(page, "Older v4 clarification guard");
    await page.getByTestId("authored-create").click(); await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    await page.getByTestId("shared-impact").click();
    await page.getByTestId("shared-actor").fill("SIM_REVIEWER"); await page.getByTestId("shared-synthetic").check(); await page.getByTestId("shared-create").click();
    await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    const oldExport = await download(page), older = await bytes(page); assert.equal(Object.keys(older).length, 5);
    await page.getByTestId("clarification-workspace").click(); assert.deepEqual(await bytes(page), older);
    await accessible(page);
    await page.getByTestId("shared-actor").fill("SIM_REVIEWER"); await page.getByTestId("shared-synthetic").check(); await page.getByTestId("shared-create").click();
    await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    const initial = await saved(page), production = initial.originalDecisions[2]; assert.ok(production !== undefined);
    const originalBasis = sharedBasis(initial, production.decision.id);
    await capture(page, "Unknown"); await page.getByTestId("shared-review-decision").selectOption(production.decision.id); await page.getByTestId("shared-open-review").click();
    assert.equal(await page.locator('#shared-outcome option[value="revise"]').isDisabled(), true);
    assert.equal(await page.getByTestId("replace-review").isDisabled(), true);
    await outcome(page, "defer"); const deferred = await saved(page), oldReview = deferred.reviews[0]; assert.ok(oldReview !== undefined);
    await capture(page, "Production");
    assert.deepEqual((await saved(page)).reviews, deferred.reviews); assert.deepEqual((await saved(page)).outcomes, deferred.outcomes);
    assert.deepEqual(sharedBasis(await saved(page), production.decision.id), originalBasis);
    assert.equal(await page.locator('#shared-outcome option[value="revise"]').isDisabled(), true, "Later clarification cannot approve the old Unknown review.");
    await page.getByTestId("replacement-rationale").fill("Simulated reviewer response: later declared Production context answers the applicability gap, requiring a separate frozen review; runtime remains unobserved. <img src=x> stays text.");
    const beforeReplacement = await bytes(page);
    await page.getByTestId("replacement-actor").fill("OTHER_REVIEWER"); await page.getByTestId("replace-review").click();
    assert.ok((await page.getByTestId("shared-error").innerText()).includes("Only the assigned")); assert.deepEqual(await bytes(page), beforeReplacement);
    await page.getByTestId("replacement-actor").fill("SIM_REVIEWER"); await page.getByTestId("replace-review").focus(); await page.keyboard.press("Enter");
    const replaced = await saved(page), replacement = replaced.replacements[0], newReview = replaced.reviews[1]; assert.ok(replacement !== undefined && newReview !== undefined);
    assert.deepEqual(replaced.reviews[0], oldReview); assert.deepEqual(replaced.outcomes, deferred.outcomes);
    assert.equal(replacement.oldReviewId, oldReview.id); assert.equal(replacement.newReviewId, newReview.id);
    assert.equal(replacement.deferredOutcomeId, deferred.outcomes[0]?.id);
    assert.deepEqual(sharedBasis(replaced, production.decision.id), originalBasis, "Replacement is not approval or a basis revision.");
    assert.equal(await page.getByTestId("trail-outcome-2").count(), 0, "The old deferral must not appear as an outcome for the replacement review.");
    const inspectionBytes = await bytes(page);
    await page.getByTestId("replacement-old-0").focus(); await page.keyboard.press("Enter");
    assert.equal(await page.locator("#shared-inspector").evaluate((element): boolean => element === document.activeElement), true);
    assert.equal(await page.getByTestId("frozen-review-snapshot").getAttribute("data-evidence-id"), oldReview.evidenceId);
    assert.equal(await page.getByTestId("frozen-review-snapshot").getAttribute("data-environment"), "Unknown");
    assert.ok((await page.getByTestId("replacement-inspection").innerText()).includes("earlier unanswered question"));
    await page.getByTestId("replacement-new-0").click();
    assert.equal(await page.getByTestId("frozen-review-snapshot").getAttribute("data-evidence-id"), newReview.evidenceId);
    assert.equal(await page.getByTestId("frozen-review-snapshot").getAttribute("data-environment"), "Production");
    assert.deepEqual(await bytes(page), inspectionBytes); assert.equal(await page.locator("#clarification-events img").count(), 0);
    await accessible(page); await page.getByTestId("replacement-old-0").focus();
    await page.locator("#clarification-history").screenshot({ path: "output/playwright/clarification-desktop.png", animations: "disabled" });
    await outcome(page, "revise"); const completed = await saved(page);
    assert.equal(sharedBasis(completed, production.decision.id)?.evidenceId, newReview.evidenceId);
    for (const record of completed.originalDecisions.slice(0, 2)) assert.equal(sharedBasis(completed, record.decision.id)?.revision, record.decision.revision);
    for (const [key, value] of Object.entries(older)) assert.equal((await bytes(page))[key], value);
    const content = await download(page), exported = ClarificationHistoryExportSchema.parse(JSON.parse(content));
    await page.reload(); assert.deepEqual(await saved(page), completed);
    await destination.goto(`${url}/impact.html?format=6`); await destination.getByTestId("import-toggle").click();
    await inspect(destination, content); assert.deepEqual(await bytes(destination), {});
    await destination.getByTestId("confirm-import").click();
    await destination.waitForURL((next: URL): boolean => next.searchParams.get("format") === "6" && next.searchParams.get("session") === completed.id);
    assert.deepEqual(await saved(destination), completed); await accessible(destination);
    assert.equal(await destination.evaluate((): string => getComputedStyle(document.documentElement).scrollBehavior), "auto");
    await destination.getByTestId("replacement-old-0").focus();
    await destination.locator("#clarification-history").screenshot({ path: "output/playwright/clarification-mobile.png", animations: "disabled" });
    assert.deepEqual(ClarificationHistoryExportSchema.parse(JSON.parse(await download(destination))).session, completed);
    const destinationBytes = await bytes(destination);
    await destination.getByTestId("import-toggle").click(); await inspect(destination, content); await destination.getByTestId("confirm-import").click();
    await destination.waitForURL((next: URL): boolean => next.searchParams.get("session") === completed.id); assert.deepEqual(await bytes(destination), destinationBytes);
    await destination.getByTestId("import-toggle").click();
    const badStates = [
      { ...completed, replacements: [] },
      { ...completed, replacements: [{ ...replacement, newReviewId: randomUUID() }] },
      { ...completed, replacements: [{ ...replacement, oldReviewId: replacement.newReviewId, newReviewId: replacement.oldReviewId }] },
      { ...completed, replacements: [replacement, { ...replacement, id: randomUUID() }] },
      { ...completed, replacements: [{ ...replacement, actor: "OTHER_REVIEWER" }] },
      { ...completed, replacements: [{ ...replacement, oldEvidenceId: randomUUID() }] },
      { ...completed, replacements: [{ ...replacement, recordedAt: initial.sources[0]?.recordedAt }] },
      { ...completed, outcomes: completed.outcomes.map((item) => item.reviewId === oldReview.id ? { ...item, outcome: "reaffirm", statement: oldReview.basis.statement } : item) },
      { ...completed, outcomes: completed.outcomes.map((item) => item.reviewId === newReview.id ? { ...item, outcome: "reaffirm", acceptedPermissions: null } : item) },
    ];
    for (const session of badStates) {
      await inspect(destination, JSON.stringify({ ...exported, session }));
      await destination.getByTestId("import-error").waitFor({ state: "visible" }); assert.deepEqual(await bytes(destination), destinationBytes);
    }
    await inspect(destination, JSON.stringify({ ...exported, session: { ...completed, outcomes: completed.outcomes.map((item) => item.reviewId === newReview.id ? { ...item, rationale: "A different valid synthetic rationale conflicts with the already stored history." } : item) } }));
    await destination.getByTestId("import-error").waitFor({ state: "visible" });
    assert.ok((await destination.getByTestId("import-error").innerText()).includes("already contains different history")); assert.deepEqual(await bytes(destination), destinationBytes);
    await inspect(destination, oldExport); await destination.getByTestId("confirm-import").click();
    await destination.waitForURL((next: URL): boolean => next.pathname === new URL(`${url}/impact.html`).pathname && !next.searchParams.has("format"));
    assert.equal((await bytes(destination))[clarificationStorageKey(completed.id)], destinationBytes[clarificationStorageKey(completed.id)]);
    const stale = await context.newPage(); await stale.goto(page.url());
    await capture(page, "Unknown"); const newest = await bytes(page); await capture(stale, "Production");
    assert.ok((await stale.getByTestId("shared-error").innerText()).includes("another tab")); assert.deepEqual(await bytes(stale), newest);
    console.log("review_clarification_smoke_passed", { replacement: true, noAutomaticApproval: true, frozenReviews: true, independentOutcomes: true, recovery: true, malformedLinksRejected: badStates.length, v1v2v3v4v5BytesPreserved: true, staleWrites: true, keyboard: true, mobile: true, accessibility: true, practitionerParticipation: false });
  } finally { await context.close(); await mobile.close(); }
}
