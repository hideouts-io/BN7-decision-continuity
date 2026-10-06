import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Browser, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { SharedStateSchema, sharedBasis, sharedPendingReview } from "../src/shared-model.ts";
import type { SharedState } from "../src/shared-model.ts";
import { SharedHistoryExportSchema } from "../src/shared-export.ts";
import { sharedStorageKey } from "../src/shared-storage.ts";
import { fillCreation } from "./authored-smoke.ts";

async function bytes(page: Page): Promise<Record<string, string>> { return page.evaluate((): Record<string, string> => Object.fromEntries(Object.entries(localStorage))); }
async function saved(page: Page): Promise<SharedState> {
  const id: string = z.uuid().parse(new URL(page.url()).searchParams.get("session"));
  return SharedStateSchema.parse(JSON.parse(z.string().parse(await page.evaluate((key: string): string | null => localStorage.getItem(key), sharedStorageKey(id)))));
}
async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(result.violations.map((violation): string => `${violation.id}: ${violation.nodes.map((node): string => node.target.join(" ")).join(", ")}`), []);
}
async function capture(page: Page, requested: readonly string[], grants: readonly string[], environment: string): Promise<void> {
  // HTML normalizes fractional seconds; send its canonical spelling to Chrome's real date input.
  await page.getByTestId("shared-time").fill(new Date().toISOString().slice(0, -1).replace(/0+$/, "").replace(/\.$/, ""));
  for (const suffix of ["read", "write", "delete"]) {
    await page.getByTestId(`shared-request-${suffix}`).setChecked(requested.includes(suffix));
    await page.getByTestId(`shared-grant-${suffix}`).setChecked(grants.includes(suffix));
  }
  await page.getByTestId("shared-environment").selectOption(environment);
  await page.getByTestId("shared-note").fill("Synthetic shared manifest declaration. Runtime is Not observed; requests and declared grants are independent. <img src=x onerror=alert(1)> remains text.");
  await page.getByTestId("shared-capture").click();
}
async function outcome(page: Page, value: string, boundary: readonly string[]): Promise<void> {
  await page.getByTestId("shared-outcome").selectOption(value);
  if (value === "revise") for (const suffix of ["read", "write", "delete"]) await page.getByTestId(`shared-boundary-${suffix}`).setChecked(boundary.includes(suffix));
  await page.getByTestId("shared-rationale").fill("Simulated human entry for technical testing: the exact manifest capture and applicable decision boundary are considered; runtime remains unobserved.");
  await page.getByTestId("shared-statement").fill("Synthetic scope or interim action is recorded for this decision only, with no operational assurance or real reviewer participation.");
  await page.getByTestId("shared-record-outcome").click();
}
async function inspect(page: Page, content: string): Promise<void> {
  await page.getByTestId("import-file").setInputFiles({ name: "shared-history.json", mimeType: "application/json", buffer: Buffer.from(content) });
  await page.getByTestId("inspect-import").click();
}
async function download(page: Page): Promise<string> {
  const waiting = page.waitForEvent("download"); await page.getByTestId("shared-export").click();
  const file = await waiting; return readFile(z.string().parse(await file.path()), "utf8");
}
async function narrow(page: Page): Promise<void> {
  assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= window.innerWidth), true, "Shared trail and UUIDs must wrap on mobile.");
  await accessible(page);
}

/** One canonical capture drives different explicit rules; real browser recovery and older-format byte preservation. */
export async function checkSharedSource(browser: Browser, url: string): Promise<void> {
  const started = performance.now();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const recovery = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
  for (const item of [context, recovery]) item.setDefaultTimeout(5000);
  try {
    const page = await context.newPage(), destination = await recovery.newPage(), errors: Error[] = [];
    page.on("pageerror", (error: Error): void => { errors.push(error); });
    await page.goto(url); await page.getByTestId("load-control").click();
    await page.getByTestId("new-version-session").click(); await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    await page.getByTestId("your-decisions").click(); await fillCreation(page, "Older v3 shared-trail guard");
    await page.getByTestId("authored-create").click(); await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    await page.getByTestId("new-continuity").click(); await fillCreation(page, "Older v4 shared-trail guard");
    await page.getByTestId("authored-create").click(); await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    const older = await bytes(page); assert.equal(Object.keys(older).length, 4);
    await page.getByTestId("shared-impact").click();
    assert.deepEqual(await bytes(page), older, "Opening v5 cannot fabricate a rehearsal or migrate earlier records.");
    await page.locator('html[data-app-ready="true"]').waitFor();
    await page.getByTestId("shared-actor").fill("SIM_REVIEWER"); await page.getByTestId("shared-synthetic").check();
    await accessible(page); await page.getByTestId("shared-create").focus(); await page.keyboard.press("Enter");
    await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    const initial = await saved(page), [requestDecision, grantDecision, productionDecision] = initial.originalDecisions;
    assert.ok(requestDecision !== undefined && grantDecision !== undefined && productionDecision !== undefined);
    assert.equal(initial.sources.length, 1); assert.equal(initial.outcomes.length, 0);
    await capture(page, ["read", "write"], ["read"], "Unknown");
    for (const [index, status] of ["affected", "unchanged", "unresolved"].entries()) assert.equal(await page.getByTestId(`shared-status-${index}`).getAttribute("data-status"), status);
    assert.equal((await saved(page)).reviews.length, 0, "Capture must not create reviews or outcomes.");
    const navigationBytes = await bytes(page);
    for (const id of ["trail-source", "trail-evidence", "trail-assumption-0", "trail-decision-0", "trail-assumption-1", "trail-decision-2"]) {
      await page.getByTestId(id).focus(); await page.keyboard.press("Enter");
      assert.equal(await page.locator("#shared-inspector").evaluate((element): boolean => element === document.activeElement), true);
    }
    assert.deepEqual(await bytes(page), navigationBytes, "Inspecting graph nodes is read-only.");
    await page.getByTestId("shared-review-decision").selectOption(grantDecision.decision.id);
    assert.equal(await page.getByTestId("shared-open-review").isDisabled(), true);
    await page.getByTestId("shared-review-decision").selectOption(requestDecision.decision.id);
    await page.getByTestId("shared-open-review").click();
    const reviewed = await saved(page), frozen = reviewed.reviews[0]; assert.ok(frozen !== undefined);
    await accessible(page);
    await page.getByTestId("trail-source").focus();
    await page.locator("#shared-trail-section").screenshot({ path: "output/playwright/shared-impact-desktop.png", animations: "disabled" });
    await capture(page, ["read", "write", "delete"], ["read"], "Unknown");
    assert.deepEqual((await saved(page)).reviews[0], frozen, "Another shared capture cannot retarget an existing review.");
    await outcome(page, "revise", ["read", "write"]);
    const firstResolution = await saved(page);
    assert.equal(sharedBasis(firstResolution, requestDecision.decision.id)?.evidenceId, frozen.evidenceId);
    assert.equal(sharedBasis(firstResolution, grantDecision.decision.id)?.revision, grantDecision.decision.revision);
    assert.equal(sharedBasis(firstResolution, productionDecision.decision.id)?.revision, productionDecision.decision.revision);
    assert.equal(await page.getByTestId("shared-status-0").getAttribute("data-status"), "affected", "The frozen B outcome cannot approve later C's delete request.");
    await page.getByTestId("shared-open-review").click(); await outcome(page, "revise", ["read", "write", "delete"]);
    assert.equal(await page.getByTestId("shared-status-0").getAttribute("data-status"), "unchanged");
    await page.getByTestId("shared-review-decision").selectOption(productionDecision.decision.id);
    await page.getByTestId("shared-open-review").click();
    assert.equal(await page.locator('#shared-outcome option[value="reaffirm"]').isDisabled(), true);
    assert.equal(await page.locator('#shared-outcome option[value="revise"]').isDisabled(), true);
    await outcome(page, "defer", []);
    assert.ok(sharedPendingReview(await saved(page), productionDecision.decision.id) !== null);
    await accessible(page); assert.equal(await page.locator("#shared-history img").count(), 0);
    const completed = await saved(page), originalBytes = await bytes(page), content = await download(page);
    const exported = SharedHistoryExportSchema.parse(JSON.parse(content));
    assert.deepEqual(exported.session, completed);
    await page.reload(); assert.deepEqual(await saved(page), completed); assert.deepEqual(await bytes(page), originalBytes);
    await destination.goto(`${url}/impact.html`); await destination.getByTestId("import-toggle").click();
    await inspect(destination, content); await destination.getByTestId("confirm-import").waitFor({ state: "visible" });
    assert.deepEqual(await bytes(destination), {}, "Recovery inspection writes nothing.");
    await narrow(destination); await destination.getByTestId("confirm-import").click();
    await destination.waitForURL((next: URL): boolean => next.pathname === new URL(`${url}/impact.html`).pathname && next.searchParams.get("session") === completed.id);
    assert.deepEqual(await saved(destination), completed); await narrow(destination);
    await destination.getByTestId("trail-review-2").focus(); await destination.keyboard.press("Enter");
    assert.ok((await destination.getByTestId("shared-inspection").innerText()).includes("unresolved"));
    await destination.getByTestId("trail-source").focus();
    await destination.locator("#shared-trail-section").screenshot({ path: "output/playwright/shared-impact-mobile.png", animations: "disabled" });
    assert.equal(await destination.evaluate((): string => getComputedStyle(document.documentElement).scrollBehavior), "auto");
    const restoredContent = SharedHistoryExportSchema.parse(JSON.parse(await download(destination)));
    assert.deepEqual(restoredContent.session, completed);
    // Unsupported approval, broken references and normalized narrative substitutions must fail before writing.
    await destination.getByTestId("import-toggle").click();
    const deferral = completed.outcomes.at(-1); assert.ok(deferral !== undefined);
    const malformed = [
      { ...exported, session: { ...completed, outcomes: [...completed.outcomes.slice(0, -1), { ...deferral, outcome: "reaffirm" }] } },
      { ...exported, session: { ...completed, reviews: completed.reviews.map((review) => ({ ...review, evidenceId: randomUUID() })) } },
      { ...exported, session: { ...completed, sources: completed.sources.map((event) => ({ ...event, evidence: { ...event.evidence, sourceNote: ` ${event.evidence.sourceNote}` } })) } },
    ];
    for (const record of malformed) {
      const before = await bytes(destination); await inspect(destination, JSON.stringify(record));
      await destination.getByTestId("import-error").waitFor({ state: "visible" });
      assert.equal(await destination.getByTestId("confirm-import").isDisabled(), true); assert.deepEqual(await bytes(destination), before);
    }
    await inspect(destination, content); await destination.getByTestId("confirm-import").click();
    await destination.getByTestId("shared-trail").waitFor({ state: "visible" });
    assert.deepEqual(await saved(destination), completed, "Identical recovery opens without rewriting history.");
    const stale = await context.newPage(); await stale.goto(page.url());
    await capture(page, ["read"], ["read", "write"], "Production");
    assert.equal(await page.getByTestId("shared-status-2").getAttribute("data-status"), "affected", "Newly declared production applicability requires reassessment rather than a silent approval.");
    const beforeStale = await bytes(page);
    await capture(stale, ["read", "write"], ["read"], "Unknown");
    await stale.getByTestId("shared-error").waitFor({ state: "visible" });
    assert.ok((await stale.getByTestId("shared-error").innerText()).includes("changed in another tab"));
    assert.deepEqual(await bytes(page), beforeStale);
    await stale.close();
    // New context declaration cannot turn the earlier Unknown review into an approval.
    await page.getByTestId("shared-review-decision").selectOption(productionDecision.decision.id);
    assert.equal(await page.locator('#shared-outcome option[value="revise"]').isDisabled(), true);
    await outcome(page, "withdraw", []);
    await page.getByTestId("shared-review-decision").selectOption(grantDecision.decision.id);
    await page.getByTestId("shared-open-review").click(); await outcome(page, "withdraw", []);
    const final = await saved(page);
    assert.equal(sharedBasis(final, grantDecision.decision.id), null); assert.equal(sharedBasis(final, productionDecision.decision.id), null);
    assert.ok(sharedBasis(final, requestDecision.decision.id) !== null);
    for (const [key, value] of Object.entries(older)) assert.equal((await bytes(page))[key], value, "Every older-format byte must be preserved.");
    await accessible(page); assert.deepEqual(errors, []);
    await page.getByTestId("shared-new").click();
    await page.locator('html[data-app-ready="true"]').waitFor();
    await page.getByTestId("shared-actor").fill("CONTROL_REVIEWER"); await page.getByTestId("shared-synthetic").check();
    await page.getByTestId("shared-create").click(); await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    await capture(page, ["read", "write"], ["read"], "Unknown");
    await page.getByTestId("shared-open-review").click(); await outcome(page, "reaffirm", []);
    assert.equal(await page.getByTestId("shared-status-0").getAttribute("data-status"), "affected", "Reaffirming the read boundary cannot make the write request safe.");
    assert.equal(await page.getByTestId("shared-open-review").isDisabled(), true, "A terminal capture cannot receive a duplicate review.");
    assert.ok((await page.getByTestId("shared-review-context").innerText()).includes("record a later capture"));
    await capture(page, ["read", "write"], ["read"], "Unknown");
    assert.equal(await page.getByTestId("shared-open-review").isDisabled(), false, "A later capture can be independently reassessed even if the boundary mismatch persists.");
    console.log("shared_source_smoke_passed", { affected: true, unchanged: true, unresolved: true, frozenReviewTargets: true, independentOutcomes: true, appendOnly: true, recovery: true, v1v2v3v4BytesPreserved: true, keyboard: true, mobile: true, reducedMotion: true, accessibility: true, automatedMilliseconds: Math.round(performance.now() - started), practitionerParticipation: false });
  } finally { await context.close(); await recovery.close(); }
}
