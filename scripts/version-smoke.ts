import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { BrowserContext, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { StateSchema } from "../src/model.ts";
import type { DemoState } from "../src/model.ts";
import { ORIGINAL_DECISION, getEvidence } from "../src/scenario.ts";
import { STORAGE_KEY } from "../src/storage.ts";
import { sessionFromUrl } from "../src/sessions.ts";

const url: string = "http://127.0.0.1:5189";
const sourceNote: string = "A manually entered synthetic manifest snapshot for the Atlas read-access assessment.";
const rationale: string = "The additional requested permission contradicts ASM-001. Declared grants and unobserved activity remain separate evidence categories.";
const statement: string = "Require a separate write-access assessment before expanding the original read-only approval.";
const StoredRecordSchema = z.object({ key: z.string(), value: z.string() });
type StoredRecord = z.infer<typeof StoredRecordSchema>;

async function storedState(page: Page): Promise<DemoState> {
  const session = sessionFromUrl(new URL(page.url()));
  const raw: string | null = await page.evaluate((key: string): string | null => localStorage.getItem(key), session.storageKey);
  assert.notEqual(raw, null, "A version session must have a saved record.");
  return StateSchema.parse(JSON.parse(z.string().parse(raw)));
}

async function storedRaw(page: Page): Promise<string> {
  const session = sessionFromUrl(new URL(page.url()));
  return z.string().parse(await page.evaluate((key: string): string | null => localStorage.getItem(key), session.storageKey));
}

async function originalRecords(page: Page): Promise<readonly StoredRecord[]> {
  return z.array(StoredRecordSchema).parse(await page.evaluate((prefix: string): StoredRecord[] => {
    const records: StoredRecord[] = [];
    for (let index: number = 0; index < localStorage.length; index += 1) {
      const key: string | null = localStorage.key(index);
      if (key === null) throw new ReferenceError("A stored session key disappeared while recording the preservation check.");
      if (!key.startsWith(prefix)) continue;
      const value: string | null = localStorage.getItem(key);
      if (value === null) throw new ReferenceError(`Stored session ${key} disappeared during the preservation check.`);
      records.push({ key, value });
    }
    return records.sort((left: StoredRecord, right: StoredRecord): number => left.key.localeCompare(right.key));
  }, STORAGE_KEY));
}

async function assertAccessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(result.violations.map((violation): string => `${violation.id}: ${violation.nodes.map((node): string => node.target.join(" ")).join(", ")}`), [], "The new evidence entry and review states must pass automated accessibility checks.");
}

async function createVersionSession(page: Page): Promise<void> {
  const previous: string = page.url();
  await page.getByTestId("new-version-session").focus();
  await page.keyboard.press("Enter");
  await page.waitForURL((target: URL): boolean => target.href !== previous && target.searchParams.has("session"));
  const state: DemoState = await storedState(page);
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.customEvidence, null);
  assert.equal(state.selectedEvidenceId, "EV-001");
  assert.equal(state.review, null);
  assert.deepEqual(state.outcomes, []);
  assert.equal(await page.getByTestId("evidence-form").isVisible(), true);
  for (const id of ["request-read", "request-write", "grant-read", "grant-write"]) {
    assert.equal(await page.getByTestId(id).isChecked(), false, "A new manually entered version must not infer permission values.");
  }
}

async function toggleWithKeyboard(page: Page, id: string): Promise<void> {
  await page.getByTestId(id).focus();
  await page.keyboard.press("Space");
  assert.equal(await page.getByTestId(id).isChecked(), true);
}

async function submitWithKeyboard(page: Page): Promise<void> {
  await page.getByTestId("record-evidence").focus();
  await page.keyboard.press("Enter");
}

async function checkInvalidEntry(page: Page): Promise<void> {
  const untouched: string = await storedRaw(page);
  await submitWithKeyboard(page);
  assert.equal(await storedRaw(page), untouched, "An incomplete form must not append evidence.");
  await page.getByTestId("source-note").fill("                    ");
  await page.getByTestId("capture-time").fill(new Date(Date.now() - 120_000).toISOString().slice(0, 16));
  await toggleWithKeyboard(page, "request-read");
  await toggleWithKeyboard(page, "grant-write");
  await submitWithKeyboard(page);
  assert.equal(await storedRaw(page), untouched, "Whitespace provenance must not create a version.");
  await page.getByTestId("source-note").fill(sourceNote);
  await page.getByTestId("capture-time").fill("2020-01-01T00:00");
  await submitWithKeyboard(page);
  assert.equal(await storedRaw(page), untouched, "A capture before EV-001 must be rejected.");
  await page.getByTestId("capture-time").fill(new Date(Date.now() + 3_600_000).toISOString().slice(0, 16));
  await submitWithKeyboard(page);
  assert.equal(await storedRaw(page), untouched, "A future capture must be rejected.");
  assert.equal(await page.getByTestId("evidence-form").isVisible(), true, "Invalid entry must leave the form available for correction.");
  assert.equal(await page.getByTestId("error-message").isVisible(), false, "Expected validation must not disable the whole application.");
}

async function checkGrantOnlyVersion(page: Page): Promise<void> {
  await page.getByTestId("capture-time").fill(new Date(Date.now() - 120_000).toISOString().slice(0, 16));
  await submitWithKeyboard(page);
  const state: DemoState = await storedState(page);
  assert.equal(state.schemaVersion, 2);
  assert.ok(state.customEvidence !== null);
  assert.equal(state.selectedEvidenceId, "EV-004");
  assert.deepEqual(state.customEvidence.evidence.requestedPermissions, ["documents:read"]);
  assert.deepEqual(state.customEvidence.evidence.grantedPermissions, ["documents:write"]);
  assert.equal(state.customEvidence.evidence.observedActivity, "Not observed");
  assert.equal(state.customEvidence.evidence.sourceNote, sourceNote);
  const comparison: string = await page.getByTestId("evidence-diff").innerText();
  assert.ok(comparison.includes("does not cover grant changes"), "A grant-only change must explain the request rule's coverage limit.");
  assert.equal(comparison.includes("No relevant change"), false, "A changed grant must not be described as an unchanged comparison.");
  assert.equal(comparison.includes("grant stays read-only"), false, "A write grant must not inherit the read-only preset explanation.");
  assert.equal(await page.getByTestId("open-review").isDisabled(), true, "A grant-only change cannot satisfy a rule about requested write permission.");
  assert.equal(await page.getByTestId("evidence-form").isVisible(), false, "The saved evidence snapshot must not remain editable.");
  assert.equal(state.review, null);
  assert.deepEqual(state.outcomes, []);
  const snapshot: string = JSON.stringify(state.customEvidence);
  await page.getByTestId("load-changed").click();
  await page.getByTestId("load-authored").click();
  const resumed: DemoState = await storedState(page);
  assert.equal(resumed.schemaVersion, 2);
  assert.equal(JSON.stringify(resumed.customEvidence), snapshot, "Re-selecting EV-004 must preserve its original event and evidence snapshot.");
  assert.equal(await page.getByTestId("open-review").isDisabled(), true);
}

async function checkVersionReview(page: Page): Promise<DemoState> {
  await page.getByTestId("capture-time").fill(new Date(Date.now() - 120_000).toISOString().slice(0, 16));
  await page.getByTestId("source-note").focus();
  await page.keyboard.type(sourceNote);
  for (const id of ["request-read", "request-write", "grant-read", "grant-write"]) await toggleWithKeyboard(page, id);
  await submitWithKeyboard(page);
  const selected: DemoState = await storedState(page);
  assert.equal(selected.schemaVersion, 2);
  assert.ok(selected.customEvidence !== null);
  assert.deepEqual(selected.customEvidence.evidence.requestedPermissions, ["documents:read", "documents:write"]);
  assert.deepEqual(selected.customEvidence.evidence.grantedPermissions, ["documents:read", "documents:write"]);
  assert.equal(selected.customEvidence.evidence.id, "EV-004");
  assert.equal(selected.review, null, "Recording changed evidence must not automatically open an accountable review.");
  assert.deepEqual(selected.outcomes, [], "Recording changed evidence cannot automatically decide an outcome.");
  assert.ok((await page.getByTestId("source-current").innerText()).includes("EV-004"));
  assert.ok((await page.getByTestId("evidence-diff").innerText()).includes("documents:write"));
  assert.ok((await page.getByTestId("impact-path").innerText()).includes("EV-004"));
  await page.getByTestId("original-summary").click();
  assert.ok((await page.getByTestId("decision-original").innerText()).includes(ORIGINAL_DECISION.statement));
  const immutable: string = JSON.stringify(selected.customEvidence);
  await page.getByTestId("open-review").focus();
  await page.keyboard.press("Enter");
  const opened: DemoState = await storedState(page);
  assert.ok(opened.review !== null);
  assert.deepEqual(opened.review.baseline, getEvidence("EV-001"));
  assert.deepEqual(opened.review.changed, selected.customEvidence.evidence);
  assert.deepEqual(opened.outcomes, []);
  await assertAccessible(page);
  await page.screenshot({ path: "output/playwright/version-review-desktop.png", fullPage: true });
  await page.getByTestId("outcome").focus();
  await page.keyboard.press("d");
  await page.keyboard.press("Tab");
  await page.keyboard.type(rationale);
  await page.keyboard.press("Tab");
  await page.keyboard.type("Defer the final outcome until the synthetic change can be examined against the read-only approval.");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  const deferred: DemoState = await storedState(page);
  assert.equal(deferred.outcomes.length, 1);
  assert.equal(deferred.outcomes[0]?.outcome, "defer");
  assert.deepEqual(deferred.outcomes[0]?.changed, selected.customEvidence.evidence);
  await page.getByTestId("load-changed").click();
  assert.equal(await page.getByTestId("review-form").isVisible(), false, "A review of EV-004 cannot accept an outcome while EV-002 is selected.");
  const alternate: DemoState = await storedState(page);
  assert.deepEqual(alternate.review, deferred.review);
  assert.deepEqual(alternate.outcomes, deferred.outcomes);
  await page.getByTestId("load-authored").click();
  assert.equal(await page.getByTestId("review-form").isVisible(), true);
  await page.getByTestId("outcome").selectOption("revise");
  await page.getByTestId("rationale").fill(rationale);
  await page.getByTestId("decision-text").fill(statement);
  await page.getByTestId("record-outcome").click();
  const completed: DemoState = await storedState(page);
  assert.equal(completed.schemaVersion, 2);
  assert.equal(JSON.stringify(completed.customEvidence), immutable);
  assert.equal(completed.outcomes.length, 2);
  assert.equal(completed.outcomes[1]?.outcome, "revise");
  assert.deepEqual(completed.outcomes[1]?.changed, selected.customEvidence.evidence);
  assert.equal(await page.getByTestId("decision-current").innerText(), statement);
  assert.equal(await page.getByTestId("decision-status").innerText(), "Revised");
  assert.equal(await page.getByTestId("outcome-entry").count(), 2);
  await page.reload();
  assert.deepEqual(await storedState(page), completed, "The authored version and complete review history must survive reload unchanged.");
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-history").click();
  const download = await downloadPromise;
  const downloadPath: string | null = await download.path();
  assert.notEqual(downloadPath, null);
  const exported = z.object({ originalEvidence: z.object({ id: z.literal("EV-001") }), session: StateSchema }).parse(JSON.parse(await readFile(z.string().parse(downloadPath), "utf8")));
  assert.deepEqual(exported.session, completed, "The export must contain the authored evidence and both exact outcome snapshots.");
  assert.ok(download.suggestedFilename().includes(z.string().parse(new URL(page.url()).searchParams.get("session"))));
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true, "The evidence-version history must fit a narrow screen.");
  await assertAccessible(page);
  await page.screenshot({ path: "output/playwright/version-history-mobile.png", fullPage: true });
  return completed;
}

async function assertRejectedStoredVersion(context: BrowserContext, sessionUrl: string, raw: string): Promise<void> {
  const page: Page = await context.newPage();
  await page.goto(sessionUrl);
  const session = sessionFromUrl(new URL(page.url()));
  await page.evaluate(({ key, value }: StoredRecord): void => localStorage.setItem(key, value), { key: session.storageKey, value: raw });
  const errorPromise = page.waitForEvent("pageerror");
  await page.reload();
  assert.equal((await errorPromise).name, "ZodError");
  assert.equal(await page.getByTestId("error-message").isVisible(), true);
  assert.equal(await page.getByTestId("load-changed").isDisabled(), true);
  assert.equal(await storedRaw(page), raw, "An invalid authored snapshot must remain available for inspection, without silent replacement.");
  await page.close();
}

/** Exercise manually authored evidence through the real local persistence, review, and export boundaries. */
export async function checkEvidenceVersionWorkflow(context: BrowserContext): Promise<void> {
  const page: Page = await context.newPage();
  const errors: Error[] = [];
  page.on("pageerror", (error: Error): void => { errors.push(error); });
  await page.goto(url);
  const originals: readonly StoredRecord[] = await originalRecords(page);
  await createVersionSession(page);
  await page.screenshot({ path: "output/playwright/version-entry-desktop.png", fullPage: true });
  await assertAccessible(page);
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true, "The evidence form must fit a narrow screen.");
  await assertAccessible(page);
  await page.screenshot({ path: "output/playwright/version-entry-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await checkInvalidEntry(page);
  await checkGrantOnlyVersion(page);
  const grantOnlyUrl: string = page.url();
  const grantOnlyRaw: string = await storedRaw(page);
  await createVersionSession(page);
  const completed: DemoState = await checkVersionReview(page);
  const completedUrl: string = page.url();
  const completedRaw: string = await storedRaw(page);
  await page.goto(grantOnlyUrl);
  assert.equal(await storedRaw(page), grantOnlyRaw, "Working in a second authored session must preserve the first session exactly.");
  assert.equal(await page.getByTestId("open-review").isDisabled(), true);
  const originalKeys: ReadonlySet<string> = new Set(originals.map((record: StoredRecord): string => record.key));
  assert.deepEqual((await originalRecords(page)).filter((record: StoredRecord): boolean => originalKeys.has(record.key)), originals, "All existing v1 session bytes must remain exactly unchanged.");
  assert.deepEqual(errors, [], "Corrected input and the complete authored evidence workflow must have no uncaught errors.");
  assert.equal(completed.schemaVersion, 2);
  assert.ok(completed.customEvidence !== null);
  const inconsistent: string = JSON.stringify({ ...completed, sources: completed.sources.map((source, index) => index === 0 ? { ...source, evidence: { ...source.evidence, sourceNote: "A different synthetic source note that contradicts the preserved capture." } } : source) });
  await assertRejectedStoredVersion(context, completedUrl, inconsistent);
  const session = sessionFromUrl(new URL(completedUrl));
  await page.evaluate(({ key, value }: StoredRecord): void => localStorage.setItem(key, value), { key: session.storageKey, value: completedRaw });
  const alternateSource = completed.sources.find((source): boolean => source.evidence.id === "EV-002");
  assert.ok(alternateSource !== undefined && completed.review !== null);
  const mismatchedReference: string = JSON.stringify({ ...completed, review: { ...completed.review, sourceEventId: alternateSource.id } });
  await assertRejectedStoredVersion(context, completedUrl, mismatchedReference);
  await page.evaluate(({ key, value }: StoredRecord): void => localStorage.setItem(key, value), { key: session.storageKey, value: completedRaw });
  const reversed: string = JSON.stringify({ ...completed, customEvidence: { ...completed.customEvidence, recordedAt: "2020-01-01T00:00:00Z" } });
  await assertRejectedStoredVersion(context, completedUrl, reversed);
  await page.evaluate(({ key, value }: StoredRecord): void => localStorage.setItem(key, value), { key: session.storageKey, value: completedRaw });
  await page.close();
}
