import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { fillCreation, fillCapture } from "./authored-smoke.ts";
import { ContinuityStateSchema, applicableBasis, pendingReview, appendContinuityOutcome } from "../src/continuity-model.ts";
import type { ContinuityState, ContinuityPermission } from "../src/continuity-model.ts";
import { ContinuityHistoryExportSchema, continuityHistoryExport } from "../src/continuity-export.ts";
import { continuityStorageKey } from "../src/continuity-storage.ts";

async function snapshot(page: Page): Promise<Record<string, string>> {
  return page.evaluate((): Record<string, string> => Object.fromEntries(Object.entries(localStorage)));
}
async function saved(page: Page): Promise<ContinuityState> {
  const id: string = z.uuid().parse(new URL(page.url()).searchParams.get("session"));
  const raw = await page.evaluate((key: string): string | null => localStorage.getItem(key), continuityStorageKey(id));
  return ContinuityStateSchema.parse(JSON.parse(z.string().parse(raw)));
}
async function create(page: Page, title: string, url: string): Promise<ContinuityState> {
  await page.goto(`${url}/decisions.html?format=4`);
  await fillCreation(page, title);
  await page.getByTestId("authored-create").focus();
  await page.keyboard.press("Enter");
  await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
  await page.getByTestId("authored-title").waitFor({ state: "visible" });
  return saved(page);
}
async function capture(page: Page, requested: readonly ContinuityPermission[], granted: readonly ContinuityPermission[], note: string): Promise<void> {
  await fillCapture(page);
  await page.getByTestId("authored-note").fill(note);
  for (const [suffix, permission] of [["read", "documents:read"], ["write", "documents:write"], ["delete", "documents:delete"]] as const) {
    for (const [kind, permissions] of [["request", requested], ["grant", granted]] as const) {
      const control = page.getByTestId(`authored-${kind}-${suffix}`), selected = permissions.includes(permission);
      if (await control.isChecked() !== selected) { await control.focus(); await page.keyboard.press("Space"); }
      assert.equal(await control.isChecked(), selected);
    }
  }
  await page.getByTestId("authored-capture").focus();
  await page.keyboard.press("Enter");
}
async function outcome(page: Page, value: string, statement: string): Promise<void> {
  await page.getByTestId("authored-outcome").selectOption(value);
  await page.getByTestId("authored-rationale").fill("Synthetic reassessment: the captured requests, declared grants and unobserved runtime remain distinct. Scope and uncertainty are recorded explicitly.");
  await page.getByTestId("authored-statement").fill(statement);
  await page.getByTestId("authored-record-outcome").focus();
  await page.keyboard.press("Enter");
}
async function openReview(page: Page): Promise<void> {
  const control = page.getByTestId("authored-open-review");
  await control.focus();
  assert.equal(await control.evaluate((element): boolean => element === document.activeElement), true);
  await page.keyboard.press("Enter");
  await page.getByTestId("authored-review-form").waitFor({ state: "visible" });
  assert.equal(await page.getByTestId("authored-outcome").evaluate((element): boolean => element === document.activeElement), true);
}
async function download(page: Page, testId: string): Promise<string> {
  const downloading = page.waitForEvent("download");
  await page.getByTestId(testId).click();
  const file = await downloading;
  return readFile(z.string().parse(await file.path()), "utf8");
}
async function inspect(page: Page, content: string): Promise<void> {
  await page.getByTestId("import-file").setInputFiles({ name: "continuity.json", mimeType: "application/json", buffer: Buffer.from(content) });
  await page.getByTestId("inspect-import").click();
}
async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(result.violations.map((violation): string => `${violation.id}: ${violation.nodes.map((node): string => node.target.join(" ")).join(", ")}`), []);
}

/** Repeated reassessment benchmark in real Chrome; timings measure automation, not practitioner setup burden. */
export async function checkDecisionContinuity(browser: Browser, url: string): Promise<void> {
  const started: number = performance.now();
  const context: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const recovery: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const deferredRecovery: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  for (const item of [context, recovery, deferredRecovery]) item.setDefaultTimeout(5000);
  try {
    const page: Page = await context.newPage();
    const errors: Error[] = [];
    page.on("pageerror", (error: Error): void => { errors.push(error); });
    // Seed all older formats through their actual UI; preservation is checked at the end.
    await page.goto(url);
    await page.getByTestId("load-control").click();
    await page.getByTestId("new-version-session").click();
    await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    await page.getByTestId("your-decisions").click();
    await fillCreation(page, "Preserved v3 approval");
    await page.getByTestId("authored-create").click();
    await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    const v3Url: string = page.url();
    const oldExport: string = await download(page, "authored-export");
    const olderRecords = await snapshot(page);
    assert.equal(Object.keys(olderRecords).length, 3);
    await page.getByTestId("new-continuity").click();
    await fillCreation(page, "Continuity benchmark approval");
    await accessible(page);
    await page.evaluate((): void => window.scrollTo(0, 0));
    await page.screenshot({ path: "output/playwright/continuity-create-desktop.png" });
    await page.getByTestId("authored-create").focus();
    await page.keyboard.press("Enter");
    await page.waitForURL((next: URL): boolean => next.searchParams.has("session") && next.searchParams.get("format") === "4");
    const original = await saved(page);
    assert.deepEqual(applicableBasis(original)?.approvedRequestedPermissions, ["documents:read"]);
    assert.equal(original.reviews.length, 0);

    await capture(page, ["documents:read", "documents:write"], ["documents:read"], "Version B: synthetic manifest adds a write request. Declared grant remains read-only; runtime unobserved.");
    const versionB = await saved(page);
    assert.equal(versionB.reviews.length, 0, "A changed source must never automatically open a review.");
    assert.equal(await page.getByTestId("authored-open-review").isEnabled(), true);
    assert.ok((await page.getByTestId("continuity-change").innerText()).includes("+ documents:write"));
    await openReview(page);
    const openBytes = await snapshot(page);
    await page.locator("#authored-capture-form").dispatchEvent("submit");
    await page.getByTestId("authored-error").waitFor({ state: "visible" });
    assert.deepEqual(await snapshot(page), openBytes, "An open review blocks additional captures even if its hidden form is submitted.");
    await outcome(page, "defer", "Keep the original read-only approval while obtaining evidence needed for a later synthetic reassessment.");
    const deferred = await saved(page);
    assert.equal(pendingReview(deferred)?.id, deferred.reviews[0]?.id);
    assert.equal(applicableBasis(deferred)?.revision, original.originalDecision.revision, "Deferral never becomes an approval basis.");
    assert.equal(await page.locator("#capture-panel").isHidden(), true);
    const deferredExport: string = await download(page, "authored-export");
    const resumed: Page = await deferredRecovery.newPage();
    await resumed.goto(url);
    await resumed.getByTestId("import-toggle").click();
    await inspect(resumed, deferredExport);
    await resumed.getByTestId("import-preview").waitFor({ state: "visible" });
    await resumed.getByTestId("confirm-import").click();
    await resumed.waitForURL((next: URL): boolean => next.searchParams.get("format") === "4");
    await resumed.getByTestId("authored-review-form").waitFor({ state: "visible" });
    assert.deepEqual(await saved(resumed), deferred);
    assert.equal(await resumed.locator("#capture-panel").isHidden(), true);
    await resumed.close();

    await page.getByTestId("authored-outcome").selectOption("revise");
    await page.getByTestId("boundary-read").uncheck();
    await outcome(page, "revise", "Approve reading and writing within a synthetic request boundary; actual access and execution remain unestablished.");
    await page.getByTestId("authored-error").waitFor({ state: "visible" });
    assert.deepEqual(await saved(page), deferred, "A revision cannot omit its explicit next boundary.");
    await page.getByTestId("boundary-read").check();
    await page.getByTestId("boundary-write").check();
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true);
    await accessible(page);
    await page.locator("#continuity-boundary").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "output/playwright/continuity-boundary-mobile.png" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await outcome(page, "revise", "Approve reading and writing within a synthetic request boundary; actual access and execution remain unestablished.");
    const revised = await saved(page);
    const revisedBasis = applicableBasis(revised);
    assert.ok(revisedBasis !== null);
    assert.deepEqual(revisedBasis.approvedRequestedPermissions, ["documents:read", "documents:write"]);
    assert.equal(revisedBasis.evidence.id, versionB.sources[1]?.evidence.id);
    assert.deepEqual(revised.outcomes.map((record): string => record.outcome), ["defer", "revise"]);
    assert.equal(await page.locator("#capture-panel").isVisible(), true);
    assert.equal(await page.getByTestId("authored-review-form").isHidden(), true);

    await capture(page, ["documents:read", "documents:write", "documents:delete"], ["documents:read"], 'Version C: synthetic delete request added. <img src=x onerror="window.untrustedContinuity=true"> No actual grant or execution established.');
    assert.equal(await page.locator("#authored-changed img").count(), 0);
    assert.ok((await page.getByTestId("continuity-change").innerText()).includes("+ documents:delete"));
    assert.ok(!(await page.getByTestId("continuity-change").innerText()).includes("+ documents:write"), "Writing was already part of the applicable evidence; comparison must not reuse original A.");
    assert.ok((await page.getByTestId("continuity-why").innerText()).includes("revision 3"));
    await openReview(page);
    const secondOpen = await saved(page);
    assert.deepEqual(secondOpen.reviews[1]?.basis, revisedBasis, "The second review binds to the exact revised decision, evidence and rule boundary.");
    assert.deepEqual(secondOpen.outcomes, revised.outcomes);
    assert.deepEqual(secondOpen.reviews[0], revised.reviews[0]);
    assert.equal(secondOpen.reviews[1]?.sourceEventId, secondOpen.sources[2]?.id);
    await accessible(page);
    await page.screenshot({ path: "output/playwright/continuity-review-desktop.png", fullPage: true });
    await outcome(page, "reaffirm", "Retain the synthetic read/write approval; deletion remains outside the accepted request boundary and needs separate authorization.");
    const completedReview = await saved(page);
    assert.equal(completedReview.reviews.length, 2);
    assert.equal(completedReview.outcomes.length, 3);
    assert.deepEqual(applicableBasis(completedReview)?.approvedRequestedPermissions, revisedBasis.approvedRequestedPermissions);
    assert.deepEqual(completedReview.originalDecision, original.originalDecision);

    await capture(page, ["documents:read", "documents:write", "documents:delete"], ["documents:read"], "Version D unchanged control: same requests and declared grants as the reviewed C snapshot, at a later capture.");
    assert.equal(await page.getByTestId("authored-open-review").isDisabled(), true);
    assert.ok((await page.getByTestId("continuity-why").innerText()).includes("still exceeds"), "Unchanged reviewed requests must not falsely establish that the boundary is satisfied.");
    await capture(page, ["documents:read", "documents:write", "documents:delete"], ["documents:read", "documents:write"], "Version E grant-only control: request unchanged, declared write grant added; actual grants and runtime unestablished.");
    const completed = await saved(page);
    assert.equal(completed.reviews.length, 2, "Unchanged and grant-only controls cannot create unnecessary reviews under the recorded request rule.");
    assert.equal(await page.getByTestId("authored-open-review").isDisabled(), true);
    assert.ok((await page.getByTestId("continuity-change").innerText()).includes("Declared grants: + documents:write"));
    assert.equal(completed.sources.length, 5);
    await page.reload();
    assert.deepEqual(await saved(page), completed);
    const exportContent: string = await download(page, "authored-export");
    const record = ContinuityHistoryExportSchema.parse(JSON.parse(exportContent));
    assert.deepEqual(record.session, completed);
    for (const [key, value] of Object.entries(olderRecords)) assert.equal((await snapshot(page))[key], value);
    await page.getByTestId("authored-select").selectOption(z.uuid().parse(new URL(v3Url).searchParams.get("session")));
    await page.waitForURL((next: URL): boolean => !next.searchParams.has("format"));
    await page.getByTestId("authored-select").selectOption(`4:${completed.id}`);
    await page.waitForURL((next: URL): boolean => next.searchParams.get("format") === "4");
    assert.deepEqual(await saved(page), completed);

    const restored: Page = await recovery.newPage();
    await restored.goto(url);
    await restored.getByTestId("import-toggle").click();
    const before = await snapshot(restored);
    await inspect(restored, exportContent);
    await restored.getByTestId("import-preview").waitFor({ state: "visible" });
    assert.deepEqual(await snapshot(restored), before);
    assert.ok((await restored.getByTestId("import-summary").innerText()).includes("2 reviews"));
    await restored.getByTestId("confirm-import").focus();
    await restored.keyboard.press("Enter");
    await restored.waitForURL((next: URL): boolean => next.pathname === new URL(`${url}/decisions.html`).pathname && next.searchParams.get("format") === "4");
    await restored.getByTestId("authored-title").waitFor({ state: "visible" });
    await restored.reload();
    assert.deepEqual(await saved(restored), completed);
    assert.equal(await restored.getByTestId("continuity-capture-entry").count(), 5);
    assert.equal(await restored.getByTestId("continuity-review-entry").count(), 2);
    assert.equal(await restored.getByTestId("continuity-outcome-entry").count(), 3);
    const afterExport = ContinuityHistoryExportSchema.parse(JSON.parse(await download(restored, "authored-export")));
    assert.deepEqual(afterExport.session, completed);
    await restored.getByTestId("import-toggle").click();
    const restoredBytes = await snapshot(restored);
    const first = completed.reviews[0];
    const second = completed.reviews[1];
    const lastOutcome = completed.outcomes.at(-1);
    assert.ok(first !== undefined && second !== undefined && lastOutcome !== undefined);
    const badRecords = [
      { ...record, session: { ...completed, reviews: [first, { ...second, basis: first.basis }] } },
      { ...record, session: { ...completed, reviews: [first, { ...second, changed: { ...second.changed, grantedPermissions: ["documents:delete"] } }] } },
      { ...record, session: { ...completed, outcomes: completed.outcomes.filter((item): boolean => item.outcome !== "revise") } },
      { ...record, session: { ...completed, outcomes: [...completed.outcomes, { ...lastOutcome, id: randomUUID(), revision: `${completed.originalDecision.id}.5` }] } },
      { ...record, session: { ...completed, reviews: [first, { ...second, openedAt: "2020-01-01T00:00:00Z" }] } },
      { ...record, session: { ...completed, outcomes: completed.outcomes.map((item) => ({ ...item, actor: "REVIEWER_OTHER" })) } },
      { ...record, session: { ...completed, outcomes: completed.outcomes.map((item) => item.outcome === "revise" ? { ...item, approvedRequestedPermissions: null } : item) } },
    ];
    for (const bad of badRecords) {
      await inspect(restored, JSON.stringify(bad));
      await restored.getByTestId("import-error").waitFor({ state: "visible" });
      assert.equal(await restored.getByTestId("confirm-import").isDisabled(), true);
      assert.deepEqual(await snapshot(restored), restoredBytes);
    }
    await inspect(restored, JSON.stringify({ ...record, session: { ...completed, sources: completed.sources.slice(0, 3) } }));
    await restored.getByTestId("import-error").waitFor({ state: "visible" });
    assert.ok((await restored.getByTestId("import-error").innerText()).includes("different history"));
    await inspect(restored, exportContent);
    await restored.getByTestId("confirm-import").click();
    await restored.reload();
    assert.deepEqual(await snapshot(restored), restoredBytes);
    await restored.setViewportSize({ width: 375, height: 812 });
    assert.equal(await restored.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true);
    await accessible(restored);
    await restored.screenshot({ path: "output/playwright/continuity-complete-mobile.png", fullPage: true });
    await restored.locator("#continuity-summary").scrollIntoViewIfNeeded();
    await restored.screenshot({ path: "output/playwright/continuity-summary-mobile.png" });
    // An older export imported from the v4 route must return to its older namespace.
    await restored.getByTestId("import-toggle").click();
    await inspect(restored, oldExport);
    await restored.getByTestId("confirm-import").click();
    await restored.waitForURL((next: URL): boolean => !next.searchParams.has("format"));
    assert.equal(page.url().includes("format=4"), true);
    assert.equal((await snapshot(restored))[continuityStorageKey(completed.id)], restoredBytes[continuityStorageKey(completed.id)]);

    const concurrent = await create(page, "Concurrent continuity control", url);
    const stale: Page = await context.newPage();
    await stale.goto(page.url());
    await capture(page, ["documents:read"], ["documents:read"], "Later unchanged synthetic capture for a stale-tab consistency check.");
    const concurrentBytes = await snapshot(page);
    await capture(stale, ["documents:read", "documents:write"], ["documents:read"], "A stale synthetic capture must not replace another tab's newer source history.");
    await stale.getByTestId("authored-error").waitFor({ state: "visible" });
    assert.deepEqual(await snapshot(stale), concurrentBytes);
    assert.equal((await saved(page)).id, concurrent.id);
    // Seed a valid large synthetic history, then exercise the real UI/storage append boundary.
    await create(page, "Recoverable-size boundary control", url);
    await capture(page, ["documents:read", "documents:write"], ["documents:read"], "Synthetic write request used for a large-history persistence boundary test.");
    await openReview(page);
    let nearLimit: ContinuityState = await saved(page);
    const largeRationale: string = "🧪".repeat(1000);
    const largeStatement: string = "🧪".repeat(500);
    const time: string = new Date().toISOString();
    let boundaryFound = false;
    for (let index = 0; index < 512; index += 1) {
      const candidate = appendContinuityOutcome(nearLimit, { actor: "REVIEWER_A", outcome: "defer", rationale: largeRationale, statement: largeStatement, approvedRequestedPermissions: null }, randomUUID(), time);
      try { continuityHistoryExport(candidate, time); }
      catch (error) {
        if (!(error instanceof RangeError) || !error.message.includes("1 MiB")) throw error;
        boundaryFound = true;
        break;
      }
      nearLimit = candidate;
    }
    assert.equal(boundaryFound, true, "The recovery size bound must be reached by this valid Unicode fixture.");
    await page.evaluate(({ key, raw }: { key: string; raw: string }): void => localStorage.setItem(key, raw), { key: continuityStorageKey(nearLimit.id), raw: JSON.stringify(nearLimit) });
    await page.reload();
    await page.getByTestId("authored-outcome").selectOption("defer");
    await page.getByTestId("authored-rationale").fill(largeRationale);
    await page.getByTestId("authored-statement").fill(largeStatement);
    const nearLimitBytes = await snapshot(page);
    await page.getByTestId("authored-record-outcome").focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("authored-error").waitFor({ state: "visible" });
    assert.ok((await page.getByTestId("authored-error").innerText()).includes("1 MiB"));
    assert.deepEqual(await snapshot(page), nearLimitBytes, "Oversized appends must never truncate or rewrite the saved history.");
    await create(page, "Withdrawn approval control", url);
    await capture(page, ["documents:read", "documents:write"], ["documents:read"], "Synthetic changed request preceding withdrawal; no actual grant or execution observed.");
    await openReview(page);
    await outcome(page, "withdraw", "Withdraw this synthetic approval; a new approval requires a new decision and preserved independent basis.");
    const withdrawn = await saved(page);
    assert.equal(applicableBasis(withdrawn), null);
    assert.equal(await page.locator("#capture-panel").isHidden(), true);
    await page.locator("#authored-capture-form").dispatchEvent("submit");
    assert.deepEqual(await saved(page), withdrawn);
    const malformed = JSON.stringify({ ...completed, reviews: [first, { ...second, basis: first.basis }] });
    await restored.evaluate(({ key, raw }: { key: string; raw: string }): void => localStorage.setItem(key, raw), { key: continuityStorageKey(completed.id), raw: malformed });
    await restored.goto(`${url}/decisions.html?format=4&session=${completed.id}`);
    await restored.getByTestId("authored-error").waitFor({ state: "visible" });
    assert.equal((await snapshot(restored))[continuityStorageKey(completed.id)], malformed);
    assert.equal(await restored.locator("#authored-workspace").isHidden(), true);
    assert.deepEqual(errors, []);
    console.log("decision_continuity_benchmark_passed", { relevantTargets: "2/2", noReviewControls: "2/2", reconstructedCaptures: 5, reconstructedReviews: 2, reconstructedOutcomes: 3, olderFormatsPreserved: true, automatedElapsedMs: Math.round(performance.now() - started), practitionerSetupBurden: "unmeasured" });
  } finally {
    for (const item of [context, recovery, deferredRecovery]) await item.close();
  }
}
