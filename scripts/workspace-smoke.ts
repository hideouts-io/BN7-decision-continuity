import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { ClarificationStateSchema } from "../src/clarification-model.ts";
import type { ClarificationState } from "../src/clarification-model.ts";
import { clarificationStorageKey } from "../src/clarification-storage.ts";
import { ClarificationHistoryExportSchema } from "../src/clarification-export.ts";

async function bytes(page: Page): Promise<Record<string, string>> {
  return page.evaluate((): Record<string, string> => Object.fromEntries(Object.entries(localStorage)));
}
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
  await page.getByTestId("shared-note").fill("Synthetic declaration only; the request changed, read-only grants are declared independently, and runtime behavior is not observed.");
  await page.getByTestId("shared-capture").click();
}

/** Exercise the original shell, read-only attention actions, frozen obligations and native section navigation. */
export async function checkWorkspaceFoundation(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  context.setDefaultTimeout(5000);
  try {
    const page = await context.newPage();
    const errors: Error[] = [];
    page.on("pageerror", (error: Error): void => { errors.push(error); });
    await page.goto(`${url}/impact.html?format=6`);
    await page.locator('html[data-app-ready="true"]').waitFor();
    assert.equal(await page.getByTestId("nav-workspace").getAttribute("aria-current"), "page");
    assert.equal(await page.getByTestId("nav-workspace-overview").getAttribute("aria-disabled"), "true");
    await page.getByTestId("nav-workspace-overview").focus(); await page.keyboard.press("Enter");
    assert.ok((await page.getByTestId("navigation-status").innerText()).includes("Create or restore"));
    assert.deepEqual(await bytes(page), {});
    assert.equal(new URL(page.url()).hash, "");
    await accessible(page);
    await page.getByTestId("nav-single").click();
    await page.locator('html[data-app-ready="true"]').waitFor();
    assert.equal(new URL(page.url()).pathname, `${new URL(`${url}/`).pathname}decisions.html`);
    assert.equal(new URL(page.url()).searchParams.get("format"), "4");
    await accessible(page);
    await page.getByTestId("nav-guided").click();
    await page.locator('html[data-app-ready="true"]').waitFor(); await accessible(page);
    const older = await bytes(page);
    await page.getByTestId("nav-evidence").focus(); await page.keyboard.press("Enter");
    assert.equal(await page.evaluate((): string => document.activeElement?.id ?? ""), "evidence");
    assert.deepEqual(await bytes(page), older);
    await page.goBack();
    await page.waitForFunction((): boolean => document.activeElement?.id === "main");
    assert.equal(await page.getByTestId("nav-evidence").getAttribute("aria-current"), null);
    await page.getByTestId("nav-workspace").click();
    await page.locator('html[data-app-ready="true"]').waitFor();
    await page.getByTestId("shared-actor").fill("SIM_REVIEWER"); await page.getByTestId("shared-synthetic").check(); await page.getByTestId("shared-create").click();
    await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
    await page.getByTestId("workspace-overview").waitFor();
    const baseline = await saved(page), production = baseline.originalDecisions[2], request = baseline.originalDecisions[0], grants = baseline.originalDecisions[1];
    assert.ok(production !== undefined && request !== undefined && grants !== undefined);
    assert.equal(await page.getByTestId("attention-questions").innerText(), "1");
    assert.equal(await page.getByTestId("attention-pending").innerText(), "0");
    assert.equal(await page.getByTestId("nav-workspace-overview").getAttribute("aria-disabled"), null);
    await capture(page, "Unknown");
    assert.equal(await page.getByTestId("attention-questions").innerText(), "2");
    assert.ok((await page.getByTestId(`attention-impact-${grants.decision.id}`).innerText()).includes("No relevant change"));
    const captured = await bytes(page);
    await page.getByTestId(`attention-inspect-${request.decision.id}`).focus(); await page.keyboard.press("Enter");
    assert.equal(await page.locator("#shared-inspector").evaluate((element): boolean => element === document.activeElement), true);
    assert.ok((await page.getByTestId("shared-inspection").innerText()).includes(request.decision.id));
    await page.getByTestId("nav-workspace-overview").click();
    assert.equal(await page.getByTestId("workspace-overview").evaluate((element): boolean => element === document.activeElement), true);
    assert.deepEqual(await bytes(page), captured, "Inspection and section navigation must preserve every stored byte.");
    await page.getByTestId(`attention-review-action-${production.decision.id}`).click();
    assert.equal(await page.getByTestId("shared-review-decision").inputValue(), production.decision.id);
    assert.deepEqual(await bytes(page), captured, "Choosing a review context must not open the review.");
    await page.getByTestId("shared-open-review").click();
    assert.equal(await page.getByTestId("attention-pending").innerText(), "1");
    await page.getByTestId("shared-outcome").selectOption("defer");
    const rationale = "Simulated reviewer response: declared context remains Unknown; defer the frozen question without approving production.";
    await page.getByTestId("shared-rationale").fill(rationale);
    await page.getByTestId("shared-statement").fill("Keep the synthetic production hold while the declared context is clarified.");
    await page.getByTestId(`attention-review-action-${production.decision.id}`).click();
    assert.equal(await page.getByTestId("shared-rationale").inputValue(), rationale, "Read-only navigation to the selected review must preserve its draft.");
    assert.equal(await page.getByTestId("shared-outcome").inputValue(), "defer");
    await page.getByTestId("shared-record-outcome").click();
    const deferred = await saved(page), frozen = deferred.reviews[0]; assert.ok(frozen !== undefined);
    await capture(page, "Production");
    const clarified = await saved(page);
    assert.deepEqual(clarified.reviews, deferred.reviews); assert.deepEqual(clarified.outcomes, deferred.outcomes);
    assert.equal(await page.getByTestId("attention-pending").innerText(), "1");
    const obligation = await page.getByTestId(`attention-review-${production.decision.id}`).innerText();
    assert.ok(obligation.includes("Deferred"));
    await page.getByTestId(`attention-review-${production.decision.id}`).locator("summary").click();
    assert.ok((await page.getByTestId(`attention-review-${production.decision.id}`).innerText()).includes(frozen.evidenceId));
    assert.ok((await page.getByTestId(`attention-impact-${production.decision.id}`).innerText()).includes("reassessment"));
    await accessible(page);
    await page.getByTestId("nav-workspace-overview").click();
    await page.screenshot({ path: "output/playwright/independent-workspace-desktop.png", animations: "disabled" });
    const unchanged = await bytes(page);
    await page.getByTestId("nav-recovery-section").click();
    assert.equal(await page.getByTestId("import-panel").evaluate((element): boolean => element instanceof HTMLDetailsElement && element.open), true);
    assert.deepEqual(await bytes(page), unchanged);
    await page.setViewportSize({ width: 375, height: 812 }); await accessible(page);
    await page.getByTestId("nav-workspace-overview").click();
    await page.getByTestId("workspace-overview").screenshot({ path: "output/playwright/independent-workspace-mobile.png", animations: "disabled" });
    const waiting = page.waitForEvent("download"); await page.getByTestId("shared-export").click();
    const exported = ClarificationHistoryExportSchema.parse(JSON.parse(await readFile(z.string().parse(await (await waiting).path()), "utf8")));
    assert.deepEqual(exported.session, clarified);
    await page.reload(); await page.locator('html[data-app-ready="true"]').waitFor();
    assert.deepEqual(await saved(page), clarified);
    assert.deepEqual(await bytes(page), unchanged);
    await page.evaluate((): void => document.getElementById("shared-capture-section")?.remove());
    await page.getByTestId("nav-shared-capture-section").click();
    assert.ok((await page.getByTestId("navigation-status").innerText()).includes("unavailable"));
    assert.deepEqual(await bytes(page), unchanged, "A missing navigation target must fail without changing history.");
    for (const [key, value] of Object.entries(older)) assert.equal((await bytes(page))[key], value);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}
