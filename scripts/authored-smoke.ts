import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Browser, BrowserContext, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { AuthoredStateSchema } from "../src/authored-model.ts";
import type { AuthoredState } from "../src/authored-model.ts";
import { authoredStorageKey } from "../src/authored-storage.ts";
import { AuthoredHistoryExportSchema } from "../src/recovery.ts";

const url = "http://127.0.0.1:5189";
const baselineTime: string = new Date(Date.now() - 86400000).toISOString().slice(0, 16);
const laterTime: string = new Date(Date.now() - 3600000).toISOString().slice(0, 16);
const rationale = "Synthetic assessment: writing is requested, read access is declared granted, and no runtime execution has been observed.";
const statement = "Retain document summarization within read-only scope pending separate assessment of write access.";

async function snapshot(page: Page): Promise<Record<string, string>> {
  return page.evaluate((): Record<string, string> => Object.fromEntries(Object.entries(localStorage)));
}
async function saved(page: Page): Promise<AuthoredState> {
  const id: string = z.uuid().parse(new URL(page.url()).searchParams.get("session"));
  const content = await page.evaluate((key: string): string | null => localStorage.getItem(key), authoredStorageKey(id));
  return AuthoredStateSchema.parse(JSON.parse(z.string().parse(content)));
}
async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(result.violations.map((violation): string => `${violation.id}: ${violation.nodes.map((node): string => node.target.join(" ")).join(", ")}`), []);
}
export async function fillCreation(page: Page, title: string): Promise<void> {
  await page.locator('html[data-app-ready="true"]').waitFor();
  await page.getByTestId("create-title").fill(title);
  await page.getByTestId("create-actor").fill("REVIEWER_A");
  await page.getByTestId("create-statement").fill("Approve the fictional research assistant for read-only document summarization.");
  await page.getByTestId("create-rationale").fill("The synthetic baseline requests only document reading; this approval relies on that bounded request.");
  await page.getByTestId("create-assumption").fill("This approval depends on the manifest requesting documents:read only, with any writing separately reassessed.");
  await page.getByTestId("create-source").fill("Fictional research manifest");
  await page.getByTestId("create-time").fill(baselineTime);
  await page.getByTestId("create-note").fill("Synthetic baseline: read-only request with separately declared read access. No runtime observed.");
  const acknowledgement = page.getByTestId("create-synthetic");
  await acknowledgement.focus();
  assert.equal(await acknowledgement.evaluate((element): boolean => element === document.activeElement), true);
  if (!await acknowledgement.isChecked()) await page.keyboard.press("Space");
  assert.equal(await acknowledgement.isChecked(), true);
}
async function create(page: Page, title: string): Promise<AuthoredState> {
  await page.goto(`${url}/decisions.html`);
  await fillCreation(page, title);
  await page.getByTestId("authored-create").focus();
  await page.keyboard.press("Enter");
  await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
  await page.getByTestId("authored-title").waitFor({ state: "visible" });
  return saved(page);
}
export async function fillCapture(page: Page): Promise<void> {
  await page.getByTestId("authored-capture-time").fill(laterTime);
  await page.getByTestId("authored-note").fill('Synthetic later capture. <img src=x onerror="window.untrustedAuthored=true"> Requested permissions are separate from grants; runtime is unobserved.');
}
async function outcome(page: Page, value: string): Promise<void> {
  await page.getByTestId("authored-outcome").selectOption(value);
  await page.getByTestId("authored-rationale").fill(rationale);
  await page.getByTestId("authored-statement").fill(statement);
  await page.getByTestId("authored-record-outcome").click();
}
async function inspect(page: Page, content: string): Promise<void> {
  await page.getByTestId("import-file").setInputFiles({ name: "authored-history.json", mimeType: "application/json", buffer: Buffer.from(content) });
  await page.getByTestId("inspect-import").click();
}

/** Real Chrome, isolated storage and files: create, reassess, preserve, restore and reject inconsistent history. */
export async function checkAuthoredDecisionWorkflow(browser: Browser): Promise<void> {
  const context: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const fresh: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(5000);
  fresh.setDefaultTimeout(5000);
  try {
    const page: Page = await context.newPage();
    const errors: Error[] = [];
    page.on("pageerror", (error: Error): void => { errors.push(error); });
    await page.goto(url);
    await page.getByTestId("load-control").click();
    await page.getByTestId("new-version-session").click();
    await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    const oldRecords: Record<string, string> = await snapshot(page);
    assert.equal(Object.keys(oldRecords).length, 2, "Seed real v1 and v2 records before checking compatibility.");
    await page.getByTestId("your-decisions").click();
    await fillCreation(page, "Research assistant rehearsal");
    await page.screenshot({ path: "output/playwright/authored-create-desktop.png", fullPage: true });
    await accessible(page);
    await page.getByTestId("create-rationale").fill("                    ");
    await page.getByTestId("authored-create").click();
    await page.getByTestId("authored-error").waitFor({ state: "visible" });
    assert.deepEqual(await snapshot(page), oldRecords, "Invalid creation writes nothing.");
    await fillCreation(page, "Research assistant rehearsal");
    await page.getByTestId("authored-create").click();
    await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    const original: AuthoredState = await saved(page);
    const selectedUrl: string = page.url();
    assert.equal(original.sources.length, 1);
    assert.equal(original.review, null);
    assert.deepEqual(original.outcomes, []);
    assert.equal(await page.getByTestId("authored-open-review").isDisabled(), true);
    await fillCapture(page);
    await page.getByTestId("authored-capture-time").fill(new Date(Date.now() - 172800000).toISOString().slice(0, 16));
    const originalBytes: Record<string, string> = await snapshot(page);
    await page.getByTestId("authored-capture").click();
    await page.getByTestId("authored-error").waitFor({ state: "visible" });
    assert.deepEqual(await snapshot(page), originalBytes, "Reversed capture chronology preserves existing bytes.");
    await fillCapture(page);
    await page.getByTestId("authored-request-read").uncheck();
    await page.getByTestId("authored-capture").click();
    assert.deepEqual(await snapshot(page), originalBytes, "Empty permission declarations must fail explicitly.");
    await page.getByTestId("authored-request-read").check();
    await page.getByTestId("authored-request-write").check();
    await page.getByTestId("authored-capture").click();
    const compared: AuthoredState = await saved(page);
    assert.equal(compared.sources.length, 2);
    assert.equal(compared.review, null, "A changed source never automatically opens a review.");
    assert.equal(await page.locator("#authored-changed img").count(), 0, "Untrusted prose must render as text.");
    for (const id of [original.source.id, compared.sources[1]?.evidence.id, original.assumption.id, original.originalDecision.revision]) assert.ok((await page.getByTestId("authored-path").innerText()).includes(z.string().parse(id)));
    assert.deepEqual(compared.sources[1]?.evidence.grantedPermissions, ["documents:read"]);
    assert.equal(compared.sources[1]?.evidence.observedActivity, "Not observed");
    await page.getByTestId("authored-open-review").focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.getByTestId("authored-outcome").evaluate((element): boolean => element === document.activeElement), true);
    assert.equal((await saved(page)).outcomes.length, 0);
    await page.getByTestId("authored-outcome").selectOption("defer");
    await page.getByTestId("authored-rationale").fill("                    ");
    await page.getByTestId("authored-statement").fill(statement);
    const beforeInvalid = await snapshot(page);
    await page.getByTestId("authored-record-outcome").click();
    assert.deepEqual(await snapshot(page), beforeInvalid);
    await page.getByTestId("authored-reviewer").evaluate((element): void => { if (!(element instanceof HTMLInputElement)) throw new TypeError("Expected reviewer input."); element.value = "REVIEWER_B"; });
    await outcome(page, "defer");
    assert.deepEqual(await snapshot(page), beforeInvalid, "A different reviewer code cannot change assigned responsibility.");
    await page.getByTestId("authored-reviewer").evaluate((element): void => { if (!(element instanceof HTMLInputElement)) throw new TypeError("Expected reviewer input."); element.value = "REVIEWER_A"; });
    await accessible(page);
    await outcome(page, "defer");
    assert.equal(await page.getByTestId("authored-review-form").isVisible(), true);
    assert.equal(await page.locator("#authored-history-section").evaluate((element): boolean => element === document.activeElement), true);
    await outcome(page, "revise");
    const completed: AuthoredState = await saved(page);
    assert.deepEqual(completed.outcomes.map((record): string => record.outcome), ["defer", "revise"]);
    assert.deepEqual(completed.originalDecision, original.originalDecision);
    assert.deepEqual(completed.sources[0], original.sources[0]);
    assert.equal(await page.getByTestId("authored-review-form").isHidden(), true);
    await page.reload();
    assert.deepEqual(await saved(page), completed);
    const downloading = page.waitForEvent("download");
    await page.getByTestId("authored-export").click();
    const download = await downloading;
    const content: string = await readFile(z.string().parse(await download.path()), "utf8");
    const exported = AuthoredHistoryExportSchema.parse(JSON.parse(content));
    assert.deepEqual(exported.session, completed);
    await page.screenshot({ path: "output/playwright/authored-complete-desktop.png", fullPage: true });
    const control: AuthoredState = await create(page, "Unchanged request control");
    await fillCapture(page);
    await page.getByTestId("authored-capture").click();
    assert.equal(await page.getByTestId("authored-open-review").isDisabled(), true);
    assert.equal((await saved(page)).review, null);
    const grants: AuthoredState = await create(page, "Grant-only change control");
    await fillCapture(page);
    await page.getByTestId("authored-grant-write").check();
    await page.getByTestId("authored-capture").click();
    assert.equal(await page.getByTestId("authored-open-review").isDisabled(), true);
    assert.ok((await page.getByTestId("authored-impact").innerText()).includes("grant-only"));
    assert.notEqual(grants.id, control.id);
    await page.getByTestId("authored-select").selectOption(completed.id);
    await page.waitForURL(selectedUrl);
    assert.deepEqual(await saved(page), completed, "Creating controls cannot change earlier histories.");
    for (const [key, value] of Object.entries(oldRecords)) assert.equal((await snapshot(page))[key], value, "Every v1/v2 byte remains unchanged.");

    const restored: Page = await fresh.newPage();
    await restored.goto(url);
    await restored.getByTestId("import-toggle").click();
    const empty = await snapshot(restored);
    await inspect(restored, content);
    await restored.getByTestId("import-preview").waitFor({ state: "visible" });
    assert.deepEqual(await snapshot(restored), empty, "A v3 preview is read-only.");
    await restored.getByTestId("confirm-import").click();
    await restored.waitForURL((next: URL): boolean => next.pathname === "/decisions.html" && next.searchParams.get("session") === completed.id);
    await restored.getByTestId("authored-title").waitFor({ state: "visible" });
    await restored.reload();
    assert.deepEqual(await saved(restored), completed);
    await restored.getByTestId("import-toggle").click();
    const restoredBytes = await snapshot(restored);
    const review = completed.review;
    assert.ok(review !== null);
    const invalidRecords = [
      { ...exported, originalDecision: { ...exported.originalDecision, rationale: "Different original rationale invalidates the exact export basis." } },
      { ...exported, session: { ...completed, assumption: { ...completed.assumption, sourceId: crypto.randomUUID() } } },
      { ...exported, session: { ...completed, review: { ...review, sourceEventId: crypto.randomUUID() } } },
      { ...exported, session: { ...completed, outcomes: [...completed.outcomes, { ...completed.outcomes[1], id: crypto.randomUUID(), revision: `${completed.originalDecision.id}.4` }] } },
      { ...exported, session: { ...completed, outcomes: completed.outcomes.map((record) => ({ ...record, recordedAt: "2020-01-01T00:00:00Z" })) } },
      { ...exported, session: { ...completed, source: { ...completed.source, name: " Different historical name " } } },
    ];
    for (const invalid of invalidRecords) {
      await inspect(restored, JSON.stringify(invalid));
      await restored.getByTestId("import-error").waitFor({ state: "visible" });
      assert.equal(await restored.getByTestId("confirm-import").isDisabled(), true);
      assert.deepEqual(await snapshot(restored), restoredBytes);
    }
    // A consistent but different history still cannot replace the existing session.
    await inspect(restored, JSON.stringify({ ...exported, session: { ...completed, outcomes: [] } }));
    await restored.getByTestId("import-error").waitFor({ state: "visible" });
    assert.ok((await restored.getByTestId("import-error").innerText()).includes("different history"));
    await inspect(restored, content);
    await restored.getByTestId("import-preview").waitFor({ state: "visible" });
    await restored.getByTestId("confirm-import").click();
    await restored.reload();
    assert.deepEqual(await snapshot(restored), restoredBytes, "Identical recovery does not rewrite existing bytes.");
    await restored.setViewportSize({ width: 375, height: 812 });
    assert.equal(await restored.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true);
    await accessible(restored);
    await restored.screenshot({ path: "output/playwright/authored-complete-mobile.png", fullPage: true });
    await restored.goto(`${url}/decisions.html`);
    await restored.keyboard.press("Tab");
    assert.equal(await restored.evaluate((): string => document.activeElement?.getAttribute("href") ?? ""), "#main");
    await accessible(restored);
    await restored.screenshot({ path: "output/playwright/authored-create-mobile.png", fullPage: true });

    const concurrent: AuthoredState = await create(page, "Concurrent tab control");
    const stale: Page = await context.newPage();
    await stale.goto(page.url());
    await fillCapture(page);
    await page.getByTestId("authored-capture").click();
    const beforeStale = await snapshot(page);
    await fillCapture(stale);
    await stale.getByTestId("authored-request-write").check();
    await stale.getByTestId("authored-capture").click();
    await stale.getByTestId("authored-error").waitFor({ state: "visible" });
    assert.ok((await stale.getByTestId("authored-error").innerText()).includes("another tab"));
    assert.deepEqual(await snapshot(stale), beforeStale);
    assert.equal((await saved(page)).id, concurrent.id);
    const malformed = JSON.stringify({ ...completed, assumption: { ...completed.assumption, decisionId: crypto.randomUUID() } });
    await restored.evaluate(({ key, value }: { key: string; value: string }): void => localStorage.setItem(key, value), { key: authoredStorageKey(completed.id), value: malformed });
    await restored.goto(selectedUrl);
    await restored.getByTestId("authored-error").waitFor({ state: "visible" });
    assert.equal(await restored.locator("#authored-workspace").isHidden(), true);
    assert.equal((await snapshot(restored))[authoredStorageKey(completed.id)], malformed);
    const missing: string = crypto.randomUUID();
    await restored.goto(`${url}/decisions.html?session=${missing}`);
    await restored.getByTestId("authored-error").waitFor({ state: "visible" });
    assert.equal((await snapshot(restored))[authoredStorageKey(missing)], undefined, "Missing UUIDs never fabricate a decision.");
    assert.deepEqual(errors, [], "The authored workflow must have no uncaught page errors.");
  } finally {
    await context.close();
    await fresh.close();
  }
}
