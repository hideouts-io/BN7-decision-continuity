/** Exercise built or published application files at an explicit subdirectory URL. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import type { Page } from "playwright";
import { z } from "zod";
import { checkDecisionContinuity } from "./continuity-smoke.ts";
import { checkSharedSource } from "./shared-smoke.ts";
import { checkReviewClarification } from "./clarification-smoke.ts";
import { fillCreation } from "./authored-smoke.ts";

const target = new URL(z.string().parse(process.argv[2]));
if (!target.pathname.endsWith("/bridgenode7/decision-continuity/") || target.search !== "" || target.hash !== "") {
  throw new RangeError("Pass the explicit application directory URL ending /bridgenode7/decision-continuity/, without query or fragment");
}
const url = target.href.slice(0, -1);
async function download(page: Page, id: string): Promise<string> {
  const waiting = page.waitForEvent("download");
  await page.getByTestId(id).click();
  return readFile(z.string().parse(await (await waiting).path()), "utf8");
}
await mkdir("output/playwright", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  const failures: string[] = [];
  page.on("pageerror", (error: Error): void => { failures.push(error.message); });
  page.on("response", (response): void => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  await page.goto(target.href);
  assert.equal(await page.locator("h1").count(), 1);
  const resources: string[] = await page.locator('script[src], link[rel="stylesheet"], link[rel="icon"]').evaluateAll((elements): string[] => elements.map((element): string => new URL(element.getAttribute("src") ?? element.getAttribute("href") ?? "", document.baseURI).href));
  assert.ok(resources.length >= 3);
  for (const resource of resources) assert.ok(resource.startsWith(target.href), `Asset escaped application path: ${resource}`);
  await page.getByTestId("load-control").click();
  const legacy = await download(page, "export-history");
  await page.getByTestId("new-version-session").click();
  await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
  const manual = await download(page, "export-history");
  await page.getByTestId("your-decisions").click();
  assert.equal(new URL(page.url()).pathname, `${target.pathname}decisions.html`);
  await fillCreation(page, "Hosted authored recovery control");
  await page.getByTestId("authored-create").click();
  await page.waitForURL((next: URL): boolean => next.searchParams.has("session"));
  const authored = await download(page, "authored-export");
  for (const [content, expected] of [[legacy, target.pathname], [manual, target.pathname], [authored, `${target.pathname}decisions.html`]] as const) {
    const fresh = await browser.newContext();
    fresh.setDefaultTimeout(10000);
    try {
      const restored = await fresh.newPage();
      await restored.goto(`${url}/impact.html?format=6`);
      await restored.getByTestId("import-toggle").click();
      await restored.getByTestId("import-file").setInputFiles({ name: "synthetic-history.json", mimeType: "application/json", buffer: Buffer.from(content) });
      await restored.getByTestId("inspect-import").click();
      await restored.getByTestId("confirm-import").click();
      await restored.waitForURL((next: URL): boolean => next.pathname === expected && !next.searchParams.has("format"));
    } finally { await fresh.close(); }
  }
  assert.deepEqual(failures, [], "Normal navigation must load all assets without page or HTTP errors");
  await context.close();
  await checkDecisionContinuity(browser, url);
  await checkSharedSource(browser, url);
  await checkReviewClarification(browser, url);
  console.log("decision_continuity_deployment_smoke_passed", { url: target.href, assets: true, allSixFormats: true, recoveryRouting: true, completeReassessment: true, keyboardMobileAccessibility: true, syntheticOnly: true });
} finally { await browser.close(); }
