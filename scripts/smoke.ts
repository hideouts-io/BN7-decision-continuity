import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { z } from "zod";
import { checkCritiquePreparation } from "./critique-smoke.ts";
import { StateSchema } from "../src/model.ts";
import type { DemoState } from "../src/model.ts";
import { ORIGINAL_DECISION, EvidenceSchema } from "../src/scenario.ts";
import { STORAGE_KEY } from "../src/storage.ts";
import { LEGACY_SESSION_ID, SessionIdSchema, sessionForId, sessionFromUrl } from "../src/sessions.ts";
import { checkEvidenceVersionWorkflow } from "./version-smoke.ts";
import { checkSessionRecovery } from "./recovery-smoke.ts";
import { checkAuthoredDecisionWorkflow } from "./authored-smoke.ts";
import { checkDecisionContinuity } from "./continuity-smoke.ts";
import { checkSharedSource } from "./shared-smoke.ts";
import { checkReviewClarification } from "./clarification-smoke.ts";
import { checkDecisionBasis } from "./basis-smoke.ts";
import { checkBasisComparison } from "./basis-comparison-smoke.ts";
import { checkActionableUncertainty } from "./uncertainty-smoke.ts";
import { checkWorkspaceFoundation } from "./workspace-smoke.ts";

const url: string = "http://127.0.0.1:5189";
const rationale: string = "The changed request contradicts the read-only assumption. Declared grants remain read-only and write activity is not observed.";
const statement: string = "Keep read-only summarization; write access requires a separate assessment and approval.";

async function savedState(page: Page): Promise<DemoState> {
  const session = sessionFromUrl(new URL(page.url()));
  const saved: string | null = await page.evaluate((key: string): string | null => localStorage.getItem(key), session.storageKey);
  assert.notEqual(saved, null, "An action must persist the synthetic session.");
  assert.equal(typeof saved, "string");
  return StateSchema.parse(JSON.parse(saved as string));
}

async function checkSessions(context: BrowserContext, completed: DemoState): Promise<void> {
  const page: Page = await context.newPage();
  await page.goto(url);
  const legacy: string | null = await page.evaluate((key: string): string | null => localStorage.getItem(key), STORAGE_KEY);
  await page.getByTestId("new-session").focus();
  await page.keyboard.press("Enter");
  await page.waitForURL((target: URL): boolean => target.searchParams.has("session"));
  const firstId = SessionIdSchema.parse(new URL(page.url()).searchParams.get("session"));
  assert.notEqual(firstId, LEGACY_SESSION_ID);
  const first: DemoState = await savedState(page);
  assert.deepEqual(first, { schemaVersion: 1, selectedEvidenceId: "EV-001", sources: [], review: null, outcomes: [] });
  assert.equal(await page.getByTestId("journey-next").getAttribute("href"), "#decision");
  assert.equal(await page.evaluate((key: string): string | null => localStorage.getItem(key), STORAGE_KEY), legacy);
  await page.getByTestId("load-control").click();
  const firstStored: DemoState = await savedState(page);
  await page.getByTestId("new-session").click();
  await page.waitForURL((target: URL): boolean => target.searchParams.get("session") !== firstId);
  const secondId = SessionIdSchema.parse(new URL(page.url()).searchParams.get("session"));
  assert.notEqual(secondId, firstId);
  await page.getByTestId("load-changed").click();
  await page.getByTestId("open-review").click();
  await page.getByTestId("outcome").selectOption("revise");
  await page.getByTestId("rationale").fill(rationale);
  await page.getByTestId("decision-text").fill(statement);
  await page.getByTestId("record-outcome").click();
  const secondStored: DemoState = await savedState(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-history").click();
  const download = await downloadPromise;
  assert.ok(download.suggestedFilename().includes(secondId));
  const path: string | null = await download.path();
  assert.notEqual(path, null);
  const exported = z.object({ exportSchemaVersion: z.literal(1), sessionId: SessionIdSchema, exportedAt: z.iso.datetime(), session: StateSchema }).parse(JSON.parse(await readFile(path as string, "utf8")));
  assert.equal(exported.sessionId, secondId);
  assert.deepEqual(exported.session, secondStored);
  await page.getByTestId("session-select").selectOption(firstId);
  await page.waitForURL((target: URL): boolean => target.searchParams.get("session") === firstId);
  assert.deepEqual(await savedState(page), firstStored);
  await page.reload();
  assert.equal(new URL(page.url()).searchParams.get("session"), firstId);
  assert.deepEqual(await savedState(page), firstStored);
  const secondTab: Page = await context.newPage();
  await secondTab.goto(`${url}/?session=${secondId}`);
  await page.getByTestId("load-changed").click();
  assert.deepEqual(await savedState(secondTab), secondStored, "A source selection in another session must not alter this history.");
  assert.equal(await secondTab.getByTestId("decision-status").innerText(), "Revised");
  assert.equal(await secondTab.getByTestId("journey-next").getAttribute("href"), "#decision-history");
  await page.getByTestId("session-select").selectOption(LEGACY_SESSION_ID);
  await page.waitForURL((target: URL): boolean => !target.searchParams.has("session"));
  assert.deepEqual(await savedState(page), completed, "The legacy record must remain exactly preserved.");
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true);
  await assertAccessible(page);
}

async function assertAccessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(result.violations.map((violation): string => `${violation.id}: ${violation.nodes.map((node): string => node.target.join(" ")).join(", ")}`), [], "Automated accessibility checks must pass; these do not replace manual review.");
}

async function checkWorkflow(context: BrowserContext): Promise<DemoState> {
  const page: Page = await context.newPage();
  const errors: Error[] = [];
  page.on("pageerror", (error: Error): void => { errors.push(error); });
  await page.goto(url);
  const untouched: string | null = await page.evaluate((key: string): string | null => localStorage.getItem(key), STORAGE_KEY);
  await page.screenshot({ path: "output/playwright/usability-desktop.png" });
  assert.equal(await page.getByTestId("journey-next").getAttribute("href"), "#decision");
  await page.getByTestId("journey-next").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate((): string => document.activeElement?.id ?? ""), "decision");
  await page.getByTestId("step-evidence").click();
  assert.equal(await page.evaluate((): string => document.activeElement?.id ?? ""), "evidence");
  assert.equal(await page.evaluate((key: string): string | null => localStorage.getItem(key), STORAGE_KEY), untouched, "Inspection navigation must not write a record.");
  await page.getByTestId("original-summary").click();
  const original: string = await page.getByTestId("decision-original").innerText();
  assert.ok(original.includes(ORIGINAL_DECISION.statement));
  await page.getByTestId("load-control").click();
  assert.equal(await page.getByTestId("open-review").isDisabled(), true);
  assert.equal(await page.getByTestId("review-entry").count(), 0);
  assert.ok((await page.getByTestId("evidence-diff").innerText()).includes("No relevant change"));
  assert.equal((await savedState(page)).outcomes.length, 0);
  assert.equal(await page.getByTestId("journey-next").getAttribute("href"), "#evidence");
  assert.equal(await page.getByTestId("step-evidence").getAttribute("aria-current"), "step");

  await page.getByTestId("load-changed").click();
  assert.ok((await page.getByTestId("evidence-diff").innerText()).includes("+ documents:write"));
  const path: string = await page.getByTestId("impact-path").innerText();
  for (const id of ["SRC-001", "EV-002", "ASM-001", "DEC-001.1"]) assert.ok(path.includes(id), `Affected path must include ${id}.`);
  assert.ok((await page.getByTestId("source-current").innerText()).includes("Not observed"));
  assert.equal(await page.getByTestId("journey-next").getAttribute("href"), "#impact");
  assert.equal(await page.getByTestId("step-impact").getAttribute("aria-current"), "step");
  const compared: DemoState = await savedState(page);
  await page.getByTestId("journey-next").click();
  assert.equal(await page.evaluate((): string => document.activeElement?.id ?? ""), "impact");
  await page.getByTestId("trace-assumption-toggle").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.getByTestId("trace-assumption-toggle").evaluate((element): boolean => element.parentElement instanceof HTMLDetailsElement && element.parentElement.open), true);
  await page.getByTestId("step-review").click();
  assert.equal(await page.evaluate((): string => document.activeElement?.id ?? ""), "review");
  assert.deepEqual(await savedState(page), compared, "Exploring the path and review section must not open a review or record an outcome.");
  await page.getByTestId("open-review").click();
  assert.equal(await page.getByTestId("review-form").isVisible(), true);
  assert.equal(await page.getByTestId("open-review").isVisible(), false, "An opened review must not keep offering the completed opening action.");
  assert.equal(await page.getByTestId("reviewer").inputValue(), ORIGINAL_DECISION.actor);
  assert.equal((await savedState(page)).outcomes.length, 0, "Opening a review must not produce an outcome.");
  assert.equal(await page.getByTestId("journey-next").getAttribute("href"), "#review");
  assert.equal(await page.getByTestId("step-review").getAttribute("aria-current"), "step");
  const unselectedExplanation: string = await page.getByTestId("outcome-explanation").innerText();
  await page.getByTestId("outcome").selectOption("revise");
  assert.notEqual(await page.getByTestId("outcome-explanation").innerText(), unselectedExplanation, "Choosing an outcome must explain that specific action.");
  await page.getByTestId("decision-text").fill(statement);
  await page.getByTestId("record-outcome").click();
  assert.equal((await savedState(page)).outcomes.length, 0, "Empty rationale must block recording.");
  await page.getByTestId("rationale").fill("                    ");
  await page.getByTestId("record-outcome").click();
  assert.equal((await savedState(page)).outcomes.length, 0, "Whitespace rationale must block recording.");
  await page.getByTestId("rationale").fill(rationale);
  await assertAccessible(page);
  await page.getByTestId("record-outcome").click();
  assert.equal(await page.getByTestId("history").evaluate((element): boolean => element === document.activeElement), true, "Focus must move to the recorded history.");
  assert.equal(await page.getByTestId("decision-status").innerText(), "Revised");
  assert.equal(await page.getByTestId("decision-current").innerText(), statement);
  assert.equal(await page.getByTestId("decision-original").innerText(), original);
  assert.equal(await page.getByTestId("outcome-entry").count(), 1);
  assert.equal(await page.getByTestId("journey-next").getAttribute("href"), "#decision-history");
  assert.equal(await page.getByTestId("step-history").getAttribute("aria-current"), "step");
  await page.reload();
  assert.equal(await page.getByTestId("outcome-entry").count(), 1, "Outcome must survive reload.");
  const history: string = await page.getByTestId("history").innerText();
  for (const value of ["EV-001", "EV-002", "REV-001", ORIGINAL_DECISION.actor, rationale]) assert.ok(history.includes(value));
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-history").click();
  const download = await downloadPromise;
  const downloadPath: string | null = await download.path();
  assert.notEqual(downloadPath, null);
  const exported = z.object({
    originalDecision: z.object({ statement: z.string(), revision: z.literal("DEC-001.1") }),
    originalEvidence: EvidenceSchema,
    session: StateSchema,
  }).parse(JSON.parse(await readFile(downloadPath as string, "utf8")));
  assert.equal(exported.originalDecision.statement, ORIGINAL_DECISION.statement);
  assert.equal(exported.session.outcomes[0]?.changed.id, "EV-002");
  await page.getByTestId("load-control").click();
  assert.equal(await page.getByTestId("outcome-entry").count(), 1, "Control selection must retain earlier outcome history.");
  assert.equal(await page.getByTestId("open-review").isDisabled(), true);
  assert.equal(await page.getByTestId("journey-next").getAttribute("href"), "#decision-history", "Selecting a control must not imply a recorded human outcome was undone.");
  await assertAccessible(page);
  assert.deepEqual(errors, [], "Core workflow must have no uncaught errors.");
  return savedState(page);
}

async function checkKeyboardAndMobile(context: BrowserContext): Promise<void> {
  const page: Page = await context.newPage();
  await page.goto(url);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate((): string => document.activeElement?.getAttribute("href") ?? ""), "#main");
  await page.keyboard.press("Enter");
  const changed = page.getByTestId("load-changed");
  await changed.focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("open-review").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.getByTestId("outcome").evaluate((element): boolean => element === document.activeElement), true);
  await page.keyboard.press("d");
  await page.keyboard.press("Tab");
  await page.keyboard.type(rationale);
  await page.keyboard.press("Tab");
  await page.keyboard.type("Defer a final decision until the requested grant and deployment scope can be independently checked.");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  assert.equal((await savedState(page)).outcomes.at(-1)?.outcome, "defer");
  assert.equal(await page.getByTestId("review-form").isVisible(), true, "Deferral leaves review open.");
  const deferred: DemoState = await savedState(page);
  await page.getByTestId("load-control").click();
  assert.equal(await page.getByTestId("review-form").isVisible(), false);
  assert.equal(await page.getByTestId("journey-next").getAttribute("href"), "#evidence");
  await page.getByTestId("review-next").click();
  assert.equal(await page.evaluate((): string => document.activeElement?.id ?? ""), "evidence");
  assert.deepEqual((await savedState(page)).review, deferred.review, "An unchanged comparison must preserve the open review.");
  assert.deepEqual((await savedState(page)).outcomes, deferred.outcomes);
  await page.getByTestId("load-changed").click();
  assert.equal(await page.getByTestId("review-form").isVisible(), true);
  assert.equal(await page.getByTestId("journey-next").getAttribute("href"), "#review");
  await page.getByTestId("outcome").selectOption("revise");
  await page.getByTestId("rationale").fill(rationale);
  await page.getByTestId("decision-text").fill(statement);
  await page.getByTestId("record-outcome").click();
  assert.equal((await savedState(page)).outcomes.length, 2, "A later outcome appends to the deferral.");
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true, "Narrow screen must not scroll horizontally.");
  await assertAccessible(page);
  await page.screenshot({ path: "output/playwright/mobile.png", fullPage: true });
}

async function checkInvalidStorage(context: BrowserContext, completed: DemoState): Promise<void> {
  const page: Page = await context.newPage();
  await page.goto(url);
  const invalid: string = '{"schemaVersion":1,"selectedEvidenceId":"missing"}';
  await page.evaluate(({ key, value }: { key: string; value: string }): void => localStorage.setItem(key, value), { key: STORAGE_KEY, value: invalid });
  const errorPromise = page.waitForEvent("pageerror");
  await page.reload();
  const error: Error = await errorPromise;
  assert.equal(error.name, "ZodError");
  assert.equal(await page.getByTestId("error-message").isVisible(), true);
  assert.equal(await page.getByTestId("load-changed").isDisabled(), true);
  assert.equal(await page.getByTestId("journey-next").isVisible(), false, "Invalid records must not advertise a successful next step.");
  assert.equal(await page.evaluate((key: string): string | null => localStorage.getItem(key), STORAGE_KEY), invalid, "Invalid history must not be silently reset.");
  const final = completed.outcomes.at(-1);
  assert.ok(final !== undefined);
  const inconsistent: string = JSON.stringify({
    ...completed,
    outcomes: [...completed.outcomes, { ...final, id: randomUUID(), revision: "DEC-001.3", outcome: "defer" }],
  });
  await page.evaluate(({ key, value }: { key: string; value: string }): void => localStorage.setItem(key, value), { key: STORAGE_KEY, value: inconsistent });
  await page.close();
  const sequencePage: Page = await context.newPage();
  const sequenceErrorPromise = sequencePage.waitForEvent("pageerror");
  await sequencePage.goto(url);
  const sequenceError: Error = await sequenceErrorPromise;
  assert.equal(sequenceError.name, "ZodError");
  assert.ok((await sequencePage.getByTestId("error-message").innerText()).includes("A terminal outcome cannot be followed"));
  assert.equal(await sequencePage.evaluate((key: string): string | null => localStorage.getItem(key), STORAGE_KEY), inconsistent);
  assert.equal(await sequencePage.getByTestId("load-changed").isDisabled(), true);
  const reversed: string = JSON.stringify({ ...completed, outcomes: completed.outcomes.map((outcome) => ({ ...outcome, recordedAt: "2020-01-01T00:00:00Z" })) });
  await sequencePage.evaluate(({ key, value }: { key: string; value: string }): void => localStorage.setItem(key, value), { key: STORAGE_KEY, value: reversed });
  const chronologyPage: Page = await context.newPage();
  const chronologyErrorPromise = chronologyPage.waitForEvent("pageerror");
  await chronologyPage.goto(url);
  assert.equal((await chronologyErrorPromise).name, "ZodError");
  assert.ok((await chronologyPage.getByTestId("error-message").innerText()).includes("predates its review"));
  assert.equal(await chronologyPage.evaluate((key: string): string | null => localStorage.getItem(key), STORAGE_KEY), reversed);
  const missingId: string = randomUUID();
  const missingPage: Page = await context.newPage();
  const missingErrorPromise = missingPage.waitForEvent("pageerror");
  await missingPage.goto(`${url}/?session=${missingId}`);
  assert.equal((await missingErrorPromise).name, "ReferenceError");
  assert.ok((await missingPage.getByTestId("error-message").innerText()).includes("absent from this browser"));
  assert.equal(await missingPage.evaluate((key: string): string | null => localStorage.getItem(key), sessionForId(missingId).storageKey), null, "A missing local-session URL must not fabricate a record.");
}

await mkdir("output/playwright", { recursive: true });
const server: ViteDevServer = await createServer({ server: { host: "127.0.0.1", port: 5189, strictPort: true } });
await server.listen();
try {
  const browser: Browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const contexts: BrowserContext[] = await Promise.all([
      browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    ]);
    const [workflow, keyboard, invalid] = contexts;
    assert.ok(workflow !== undefined && keyboard !== undefined && invalid !== undefined);
    for (const context of contexts) context.setDefaultTimeout(5000);
    const completed: DemoState = await checkWorkflow(workflow);
    await checkSessions(workflow, completed);
    await checkEvidenceVersionWorkflow(workflow);
    await checkCritiquePreparation(workflow);
    await checkSessionRecovery(browser);
    await checkAuthoredDecisionWorkflow(browser);
    await checkDecisionContinuity(browser, url);
    await checkSharedSource(browser, url);
    await checkReviewClarification(browser, url);
    await checkDecisionBasis(browser, url);
    await checkBasisComparison(browser, url);
    await checkActionableUncertainty(browser, url);
    await checkWorkspaceFoundation(browser, url);
    await checkKeyboardAndMobile(keyboard);
    await checkInvalidStorage(invalid, completed);
    console.log("decision_continuity_smoke_passed", { workflow: true, guidance: true, readOnlyNavigation: true, outcomeExplanations: true, sessions: true, legacyPreserved: true, keyboard: true, narrowScreen: true, accessibility: true, persistence: true, invalidStorage: true, critiquePreparation: true, sessionRecovery: true, authoredDecisions: true, repeatedReassessment: true, recordedDecisionBasis: true });
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
