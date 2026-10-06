import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Browser, BrowserContext, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { LegacyHistoryExportSchema, MAX_IMPORT_BYTES } from "../src/recovery.ts";
import type { LegacyHistoryExport } from "../src/recovery.ts";
import { sessionForId } from "../src/sessions.ts";
import { STORAGE_KEY } from "../src/storage.ts";

const url = "http://127.0.0.1:5189";

async function storageSnapshot(page: Page): Promise<Record<string, string>> {
  return page.evaluate((): Record<string, string> => Object.fromEntries(Object.entries(localStorage)));
}

async function downloadHistory(page: Page): Promise<string> {
  const waiting = page.waitForEvent("download");
  await page.getByTestId("export-history").click();
  const download = await waiting;
  return readFile(z.string().parse(await download.path()), "utf8");
}

async function inspectFile(page: Page, content: string): Promise<void> {
  await page.getByTestId("import-file").setInputFiles({ name: "synthetic-history.json", mimeType: "application/json", buffer: Buffer.from(content) });
  await page.getByTestId("inspect-import").click();
}

async function openRecovery(page: Page): Promise<void> {
  await page.getByTestId("import-toggle").click();
}

async function recordOutcome(page: Page, outcome: string): Promise<void> {
  await page.getByTestId("outcome").selectOption(outcome);
  await page.getByTestId("rationale").fill("Synthetic recovery rehearsal: requested writing needs further assessment; grants and runtime remain distinct.");
  await page.getByTestId("decision-text").fill("Retain the original read-only scope until a separate assessment supports any additional access.");
  await page.getByTestId("record-outcome").click();
}

async function rejectedFile(page: Page, content: string): Promise<void> {
  const before: Record<string, string> = await storageSnapshot(page);
  await inspectFile(page, content);
  await page.getByTestId("import-error").waitFor({ state: "visible" });
  assert.equal(await page.getByTestId("confirm-import").isDisabled(), true);
  assert.equal(await page.getByTestId("load-changed").isDisabled(), false, "Import errors must not disable an otherwise valid session.");
  assert.deepEqual(await storageSnapshot(page), before, "Rejected imports must preserve all stored bytes.");
}

async function roundTrip(page: Page, content: string): Promise<LegacyHistoryExport> {
  const record: LegacyHistoryExport = LegacyHistoryExportSchema.parse(JSON.parse(content));
  const before: Record<string, string> = await storageSnapshot(page);
  await openRecovery(page);
  await inspectFile(page, content);
  await page.getByTestId("import-preview").waitFor({ state: "visible" });
  assert.deepEqual(await storageSnapshot(page), before, "Preview cannot write any record.");
  await page.getByTestId("confirm-import").focus();
  await page.keyboard.press("Enter");
  await page.waitForURL((next: URL): boolean => record.sessionId === "existing-demo" ? !next.searchParams.has("session") : next.searchParams.get("session") === record.sessionId);
  await page.getByTestId("import-panel").waitFor({ state: "attached" });
  // Waiting for the restored history distinguishes a same-URL legacy navigation from its prior page.
  await page.getByTestId("outcome-entry").first().waitFor({ state: "visible" });
  await page.reload();
  const after: LegacyHistoryExport = LegacyHistoryExportSchema.parse(JSON.parse(await downloadHistory(page)));
  assert.equal(after.sessionId, record.sessionId);
  assert.deepEqual(after.originalDecision, record.originalDecision);
  assert.deepEqual(after.originalEvidence, record.originalEvidence);
  assert.deepEqual(after.session, record.session, "Reload/re-export must preserve every event, reference, snapshot and outcome.");
  return record;
}

/** Exercise actual files, fresh browser storage and both session formats through the UI. */
export async function checkSessionRecovery(browser: Browser): Promise<void> {
  const contexts: BrowserContext[] = [];
  async function pageInFreshContext(): Promise<Page> {
    const context: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(5000);
    contexts.push(context);
    const page: Page = await context.newPage();
    await page.goto(url);
    return page;
  }
  try {
    const source: Page = await pageInFreshContext();
    await source.getByTestId("load-changed").click();
    await source.getByTestId("open-review").click();
    await recordOutcome(source, "defer");
    const legacyDeferred: string = await downloadHistory(source);
    const destination: Page = await pageInFreshContext();
    await roundTrip(destination, legacyDeferred);
    await recordOutcome(destination, "revise");
    const terminal: LegacyHistoryExport = LegacyHistoryExportSchema.parse(JSON.parse(await downloadHistory(destination)));
    assert.deepEqual(terminal.session.outcomes.map((entry): string => entry.outcome), ["defer", "revise"]);
    const finalDestination: Page = await pageInFreshContext();
    await roundTrip(finalDestination, JSON.stringify(terminal));
    assert.equal(await finalDestination.getByTestId("review-form").isHidden(), true);

    await source.getByTestId("new-version-session").click();
    await source.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    await source.getByTestId("capture-time").fill("2026-10-02T15:00");
    await source.getByTestId("source-note").fill('Fictional permissions inspired by pinned MCP documentation. <img src=x onerror="window.untrustedImport=true"> No runtime was observed.');
    await source.getByTestId("request-read").check();
    await source.getByTestId("request-write").check();
    await source.getByTestId("grant-read").check();
    await source.getByTestId("record-evidence").click();
    await source.getByTestId("open-review").click();
    await recordOutcome(source, "defer");
    const authored: string = await downloadHistory(source);
    const namedDestination: Page = await pageInFreshContext();
    // Preserve a real legacy history alongside the imported named session.
    await roundTrip(namedDestination, JSON.stringify(terminal));
    const legacyBytes: string | null = await namedDestination.evaluate((key: string): string | null => localStorage.getItem(key), STORAGE_KEY);
    const record: LegacyHistoryExport = await roundTrip(namedDestination, authored);
    assert.equal(await namedDestination.evaluate((key: string): string | null => localStorage.getItem(key), STORAGE_KEY), legacyBytes);
    assert.equal(await namedDestination.getByTestId("source-current").locator("img").count(), 0, "Imported source notes must remain text.");
    assert.ok((await namedDestination.getByTestId("source-current").innerText()).includes("<img src=x"));
    assert.equal(record.session.schemaVersion, 2);
    if (record.session.schemaVersion !== 2 || record.session.review === null) throw new TypeError("Authored recovery fixture requires a v2 review.");

    await openRecovery(namedDestination);
    await rejectedFile(namedDestination, "{broken JSON");
    await rejectedFile(namedDestination, JSON.stringify({ ...record, exportSchemaVersion: 99 }));
    await rejectedFile(namedDestination, JSON.stringify({ exportSchemaVersion: 1, sessionId: record.sessionId }));
    await rejectedFile(namedDestination, JSON.stringify({ ...record, session: { ...record.session, schemaVersion: 99 } }));
    await rejectedFile(namedDestination, JSON.stringify({ ...record, originalDecision: { ...record.originalDecision, actor: "Invented replacement" } }));
    await rejectedFile(namedDestination, JSON.stringify({ ...record, originalEvidence: { ...record.originalEvidence, grantedPermissions: ["documents:write"] } }));
    assert.ok(record.session.customEvidence !== null);
    await rejectedFile(namedDestination, JSON.stringify({ ...record, session: { ...record.session, customEvidence: { ...record.session.customEvidence, evidence: { ...record.session.customEvidence.evidence, sourceNote: ` ${record.session.customEvidence.evidence.sourceNote} ` } } } }));
    assert.ok((await namedDestination.getByTestId("import-error").innerText()).includes("will not silently trim"));
    await rejectedFile(namedDestination, JSON.stringify({ ...record, session: { ...record.session, review: { ...record.session.review, sourceEventId: "00000000-0000-4000-8000-000000000000" } } }));
    await rejectedFile(namedDestination, " ".repeat(MAX_IMPORT_BYTES + 1));
    await rejectedFile(namedDestination, legacyDeferred);

    const key: string = sessionForId(record.sessionId).storageKey;
    const originalBytes: string = JSON.stringify(record.session, null, 2);
    await namedDestination.evaluate(({ key, raw }: { key: string; raw: string }): void => localStorage.setItem(key, raw), { key, raw: originalBytes });
    await inspectFile(namedDestination, authored);
    await namedDestination.getByTestId("confirm-import").waitFor({ state: "visible" });
    assert.equal(await namedDestination.getByTestId("confirm-import").isEnabled(), true);
    await namedDestination.getByTestId("confirm-import").click();
    await namedDestination.reload();
    assert.equal(await namedDestination.evaluate((key: string): string | null => localStorage.getItem(key), key), originalBytes, "An identical import opens existing bytes without rewriting them.");

    const race: Page = await pageInFreshContext();
    await openRecovery(race);
    await inspectFile(race, authored);
    await race.getByTestId("import-preview").waitFor({ state: "visible" });
    const conflicting: string = JSON.stringify({ ...record.session, outcomes: [] });
    await race.evaluate(({ key, raw }: { key: string; raw: string }): void => localStorage.setItem(key, raw), { key, raw: conflicting });
    const raceBytes: Record<string, string> = await storageSnapshot(race);
    await race.getByTestId("confirm-import").click();
    await race.getByTestId("import-error").waitFor({ state: "visible" });
    assert.deepEqual(await storageSnapshot(race), raceBytes, "Confirmation must recheck records created after preview.");

    const quota: Page = await pageInFreshContext();
    await openRecovery(quota);
    await inspectFile(quota, authored);
    await quota.getByTestId("import-preview").waitFor({ state: "visible" });
    // Fill actual isolated Chrome storage, rather than mocking a persistence failure.
    await quota.evaluate((): void => {
      let index = 0;
      for (const size of [512 * 1024, 8 * 1024, 256]) {
        for (;;) {
          try {
            localStorage.setItem(`quota-padding-${index}`, "x".repeat(size));
            index += 1;
            if (index > 1000) throw new RangeError("Chrome did not enforce the expected local-storage quota.");
          } catch (error) {
            if (!(error instanceof DOMException) || error.name !== "QuotaExceededError") throw error;
            break;
          }
        }
      }
    });
    const quotaBytes: Record<string, string> = await storageSnapshot(quota);
    await quota.getByTestId("confirm-import").click();
    await quota.getByTestId("import-error").waitFor({ state: "visible" });
    assert.ok((await quota.getByTestId("import-error").innerText()).includes("QuotaExceededError"));
    assert.deepEqual(await storageSnapshot(quota), quotaBytes, "A real quota failure must not partially write or replace history.");
    assert.equal(await quota.evaluate((key: string): string | null => localStorage.getItem(key), key), null);

    const missing: Page = await pageInFreshContext();
    await missing.goto(`${url}/?session=${record.sessionId}`);
    await missing.getByTestId("error-message").waitFor({ state: "visible" });
    await roundTrip(missing, authored);

    await openRecovery(namedDestination);
    await inspectFile(namedDestination, authored);
    await namedDestination.getByTestId("import-preview").waitFor({ state: "visible" });
    await namedDestination.getByTestId("import-panel").screenshot({ path: "output/playwright/recovery-desktop.png" });
    await namedDestination.setViewportSize({ width: 375, height: 812 });
    assert.equal(await namedDestination.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true);
    await namedDestination.getByTestId("import-panel").screenshot({ path: "output/playwright/recovery-mobile.png" });
    const accessibility = await new AxeBuilder({ page: namedDestination }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    assert.deepEqual(accessibility.violations.map((violation): string => violation.id), []);
  } finally {
    for (const context of contexts) await context.close();
  }
}
