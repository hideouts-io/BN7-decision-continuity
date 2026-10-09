import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Browser, Locator, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import type { BasisReference } from "../src/basis-comparison.ts";
import { clarificationHistoryExport } from "../src/clarification-export.ts";
import { uncertaintyHistoryExport, UncertaintyHistoryExportSchema } from "../src/uncertainty-export.ts";
import { inspectComparisonPacket } from "../src/comparison-packet.ts";
import { basisFixture } from "./basis-smoke.ts";
import { uncertaintyFixture } from "./uncertainty-smoke.ts";

type Side = "from" | "to";
type Explanation = "basis-review-brief" | "basis-differences" | "basis-navigator";
type StorageBytes = Readonly<{ local: Record<string, string>; session: Record<string, string> }>;
type ReadingContext = Readonly<{ top: number; left: number; scrolls: readonly Readonly<{ top: number; left: number }>[]; disclosures: readonly boolean[] }>;

async function bytes(page: Page): Promise<StorageBytes> {
  return page.evaluate((): StorageBytes => ({ local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage)) }));
}
async function ready(page: Page): Promise<void> { await page.locator('html[data-app-ready="true"]').waitFor(); }
async function restore(page: Page, url: string, content: string, format: number): Promise<void> {
  await page.goto(`${url}/impact.html?format=${format}`); await ready(page);
  const before = await bytes(page);
  await page.getByTestId("import-toggle").click();
  await page.getByTestId("import-file").setInputFiles({ name: "synthetic-navigation-history.json", mimeType: "application/json", buffer: Buffer.from(content) });
  await page.getByTestId("inspect-import").click(); await page.getByTestId("import-preview").waitFor({ state: "visible" });
  assert.deepEqual(await bytes(page), before);
  const navigation = page.waitForEvent("domcontentloaded"); await page.getByTestId("confirm-import").click(); await navigation; await ready(page);
}
async function download(page: Page, id: string): Promise<string> {
  const waiting = page.waitForEvent("download"); await page.getByTestId(id).click();
  return readFile(z.string().parse(await (await waiting).path()), "utf8");
}
async function upload(page: Page, url: string, content: string): Promise<void> {
  await page.goto(`${url}/comparison.html`); await ready(page);
  await page.getByTestId("packet-file").setInputFiles({ name: "synthetic-navigation-comparison.json", mimeType: "application/json", buffer: Buffer.from(content) });
  await page.getByTestId("packet-inspect").click(); await page.getByTestId("packet-result").waitFor({ state: "visible" });
}
async function citation(page: Page, explanation: Explanation, side: Side, reference: BasisReference): Promise<Locator> {
  const candidate = page.getByTestId(explanation).locator(`button[data-basis-ref-side="${side}"][data-basis-ref-kind="${reference.kind}"][data-basis-ref-id="${reference.id}"]`).first();
  const testId = z.string().min(1).parse(await candidate.getAttribute("data-testid"));
  const control = page.getByTestId(testId);
  await control.evaluate((element): void => {
    for (let ancestor = element.parentElement; ancestor !== null; ancestor = ancestor.parentElement) if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
  });
  return control;
}
async function readingContext(control: Locator, rootId: string): Promise<ReadingContext> {
  return control.evaluate((element, id: string): ReadingContext => {
    const root = document.getElementById(id);
    if (!(root instanceof HTMLElement)) throw new ReferenceError("The current comparison root must exist.");
    const elements = new Set<HTMLElement>(root.querySelectorAll<HTMLElement>("*"));
    for (let ancestor: HTMLElement | null = root; ancestor !== null; ancestor = ancestor.parentElement) elements.add(ancestor);
    const scrolls = [...elements].filter((item): boolean => item !== document.scrollingElement && (item.scrollHeight > item.clientHeight || item.scrollWidth > item.clientWidth))
      .map((item): Readonly<{ top: number; left: number }> => ({ top: item.scrollTop, left: item.scrollLeft }));
    return { top: element.getBoundingClientRect().top, left: window.scrollX, scrolls, disclosures: [...root.querySelectorAll<HTMLDetailsElement>("details")].map((item): boolean => item.open) };
  }, rootId);
}
async function exactTarget(page: Page, side: Side, reference: BasisReference): Promise<void> {
  assert.deepEqual(await page.evaluate((selected): Readonly<{ kind: string | undefined; id: string | undefined; contained: boolean }> => {
    const target = document.activeElement, column = document.getElementById(selected === "from" ? "basis-historical" : "basis-latest");
    if (!(target instanceof HTMLElement) || !(column instanceof HTMLElement)) throw new ReferenceError("The exact selected endpoint must receive reference focus.");
    return { kind: target.dataset.basisRefKind, id: target.dataset.basisRefId, contained: column.contains(target) };
  }, side), { kind: reference.kind, id: reference.id, contained: true });
  assert.equal(await page.getByTestId("basis-inspection-return").evaluate((bar, selected): boolean => {
    const column = document.getElementById(selected === "from" ? "basis-historical" : "basis-latest");
    return column !== null && column.contains(bar);
  }, side), true);
}
async function focusCitation(control: Locator): Promise<void> {
  await control.evaluate((element): void => {
    if (!(element instanceof HTMLButtonElement)) throw new TypeError("An exact citation must be a native button.");
    element.focus({ preventScroll: true }); element.scrollIntoView({ block: "center", behavior: "instant" });
  });
}
async function roundTrip(page: Page, rootId: string, explanation: Explanation, side: Side, reference: BasisReference): Promise<void> {
  const control = await citation(page, explanation, side, reference), before = await bytes(page);
  await focusCitation(control);
  const context = await readingContext(control, rootId);
  await page.keyboard.press("Enter"); await exactTarget(page, side, reference);
  await page.keyboard.press(reference.kind === "decision" || reference.kind === "assumption" ? "Shift+Tab" : "Tab");
  assert.equal(await page.getByTestId("basis-return").evaluate((element): boolean => element === document.activeElement), true);
  await page.keyboard.press("Space");
  assert.equal(await control.evaluate((element): boolean => element === document.activeElement), true);
  assert.equal(await page.getByTestId("basis-return").count(), 0);
  const returned = await readingContext(control, rootId);
  assert.ok(Math.abs(returned.top - context.top) <= 1, `${explanation} ${side} ${reference.kind}: return must preserve the citation's reading offset: ${returned.top} vs ${context.top}.`);
  assert.equal(returned.left, context.left); assert.deepEqual(returned.disclosures, context.disclosures); assert.deepEqual(returned.scrolls, context.scrolls);
  assert.deepEqual(await bytes(page), before, "Inspection and return preserve exact local/session storage bytes.");
}
async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(result.violations.map((item): string => item.id), []);
  assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true);
}
async function open(page: Page, explanation: Explanation, side: Side, reference: BasisReference): Promise<Locator> {
  const control = await citation(page, explanation, side, reference); await focusCitation(control); await page.keyboard.press("Enter"); await exactTarget(page, side, reference); return control;
}

/** Real workspace exports and frozen packets exercise temporary navigation, failures and byte-preserved reading context. */
export async function checkBasisReferenceNavigation(browser: Browser, url: string): Promise<void> {
  const fixture = uncertaintyFixture(), state = fixture.completed, first = state.resolutions[0], last = state.resolutions[1];
  assert.ok(first !== undefined && last !== undefined);
  const history = JSON.stringify(uncertaintyHistoryExport(state, "2026-10-08T00:00:00.000Z"));
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
  for (const context of [desktop, mobile]) context.setDefaultTimeout(5000);
  try {
    const page = await desktop.newPage(), narrow = await mobile.newPage(), errors: Error[] = [], external: string[] = [];
    for (const reader of [page, narrow]) {
      reader.on("pageerror", (error: Error): void => { errors.push(error); });
      reader.on("request", (request): void => { const target = new URL(request.url()); if (["http:", "https:"].includes(target.protocol) && target.origin !== new URL(url).origin) external.push(target.href); });
    }
    await restore(page, url, history, 7); const preserved = await bytes(page);
    await page.getByTestId("basis-decision").selectOption(fixture.decisionId);
    await page.getByTestId("basis-event").selectOption(first.id); await page.getByTestId("basis-compare-event").selectOption(last.id);
    const from: BasisReference = { kind: "resolution", id: first.id }, to: BasisReference = { kind: "resolution", id: last.id };
    for (const explanation of ["basis-review-brief", "basis-differences"] as const) {
      await roundTrip(page, "basis-panel", explanation, "from", from); await roundTrip(page, "basis-panel", explanation, "to", to);
    }
    for (const side of ["from", "to"] as const) await roundTrip(page, "basis-panel", "basis-review-brief", side, { kind: "requirement", id: fixture.requirementId });
    await roundTrip(page, "basis-panel", "basis-navigator", "to", to);
    // Different controls citing the same record must retain their own origin, including an uninterrupted second inspection.
    await open(page, "basis-review-brief", "to", to);
    await roundTrip(page, "basis-panel", "basis-differences", "to", to);
    await open(page, "basis-review-brief", "to", to); await accessible(page);
    await page.getByTestId("basis-inspection-return").screenshot({ path: "output/playwright/basis-reference-desktop.png", animations: "disabled" });
    await page.evaluate((): void => { window.dispatchEvent(new Event("beforeprint")); });
    await page.emulateMedia({ media: "print" }); assert.equal(await page.getByTestId("basis-return").isVisible(), false);
    await page.emulateMedia({ media: "screen" }); await page.evaluate((): void => { window.dispatchEvent(new Event("afterprint")); });
    await page.getByTestId("basis-return").click();
    const packet2 = await download(page, "basis-export"); assert.equal(inspectComparisonPacket(packet2).packet.packetSchemaVersion, 2);
    assert.deepEqual(UncertaintyHistoryExportSchema.parse(JSON.parse(await download(page, "shared-export"))).session, state);
    const otherDecision = state.history.originalDecisions[0]; assert.ok(otherDecision !== undefined);
    for (const id of ["basis-event", "basis-compare-event", "basis-decision"]) {
      await open(page, "basis-review-brief", "to", to);
      await page.getByTestId(id).selectOption(id === "basis-decision" ? otherDecision.decision.id : "latest");
      assert.equal(await page.getByTestId("basis-return").count(), 0);
      await page.getByTestId("basis-decision").selectOption(fixture.decisionId);
      await page.getByTestId("basis-event").selectOption(first.id); await page.getByTestId("basis-compare-event").selectOption(last.id);
    }
    for (const id of ["source-file-file", "import-file"]) {
      if (id === "import-file") await page.getByTestId("import-toggle").click();
      await open(page, "basis-review-brief", "to", to);
      await page.getByTestId(id).setInputFiles({ name: "synthetic-uninspected.json", mimeType: "application/json", buffer: Buffer.from("{}") });
      assert.equal(await page.getByTestId("basis-return").count(), 0);
    }
    await open(page, "basis-review-brief", "to", to); await page.getByTestId("shared-select").selectOption("");
    assert.equal(await page.getByTestId("basis-panel").isVisible(), false); assert.equal(await page.getByTestId("basis-return").count(), 0);
    assert.deepEqual(await bytes(page), preserved);
    await page.reload(); await ready(page); assert.equal(await page.getByTestId("basis-return").count(), 0);

    await restore(narrow, url, history, 7);
    await narrow.getByTestId("basis-decision").selectOption(fixture.decisionId); await narrow.getByTestId("basis-event").selectOption(first.id); await narrow.getByTestId("basis-compare-event").selectOption(last.id);
    await roundTrip(narrow, "basis-panel", "basis-review-brief", "from", from); await roundTrip(narrow, "basis-panel", "basis-differences", "to", to);
    const navScroll = narrow.getByTestId("basis-nav-scroll");
    await navScroll.evaluate((element): void => { element.scrollTop = 200; });
    await roundTrip(narrow, "basis-panel", "basis-navigator", "to", to);
    assert.equal(await narrow.evaluate((): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
    await upload(narrow, url, packet2);
    for (const explanation of ["basis-review-brief", "basis-differences"] as const) for (const [side, reference] of [["from", from], ["to", to]] as const) await roundTrip(narrow, "packet-result", explanation, side, reference);
    await open(narrow, "basis-review-brief", "to", to); await accessible(narrow);
    await narrow.getByTestId("basis-inspection-return").screenshot({ path: "output/playwright/basis-reference-mobile.png", animations: "disabled" });
    await narrow.screenshot({ path: "output/playwright/basis-reference-mobile-viewport.png", animations: "disabled" });
    await narrow.evaluate((): void => { window.dispatchEvent(new Event("beforeprint")); });
    await narrow.emulateMedia({ media: "print" }); assert.equal(await narrow.getByTestId("basis-return").isVisible(), false);
    await narrow.emulateMedia({ media: "screen" }); await narrow.evaluate((): void => { window.dispatchEvent(new Event("afterprint")); });
    await narrow.getByTestId("basis-return").click();
    const packetBytes = await bytes(narrow);
    await narrow.getByTestId("packet-file").setInputFiles({ name: "synthetic-other-packet.json", mimeType: "application/json", buffer: Buffer.from(packet2) });
    assert.equal(await narrow.getByTestId("basis-return").count(), 0); assert.equal(await narrow.getByTestId("packet-result").isVisible(), false);
    await narrow.getByTestId("packet-inspect").click();
    await open(narrow, "basis-review-brief", "to", to); await narrow.getByTestId("packet-clear").click(); assert.equal(await narrow.getByTestId("basis-return").count(), 0);
    assert.deepEqual(await bytes(narrow), packetBytes);

    // Missing and unsupported references and a removed origin fail visibly; no successful earlier return survives.
    for (const kind of ["unsupported", "resolution"]) {
      await upload(page, url, packet2); const control = await citation(page, "basis-review-brief", "to", to);
      await control.evaluate((element, value: string): void => {
        if (!(element instanceof HTMLButtonElement)) throw new TypeError("An exact citation must be a native button.");
        element.dataset.basisRefKind = value; if (value === "resolution") element.dataset.basisRefId = "00000000-0000-4000-8000-ffffffffffff";
      }, kind);
      await control.click(); assert.match(await page.getByTestId("packet-error").innerText(), /Unsupported|no inspectable/);
      assert.equal(await page.getByTestId("basis-return").count(), 0); assert.equal(await page.getByTestId("packet-result").isVisible(), false);
    }
    await upload(page, url, packet2); const unavailable = await citation(page, "basis-review-brief", "to", to);
    await page.getByTestId("basis-latest").evaluate((element): void => { if (!(element instanceof HTMLElement)) throw new TypeError("The endpoint must be a native element."); element.inert = true; });
    await unavailable.click(); assert.match(await page.getByTestId("packet-error").innerText(), /exact cited endpoint record is hidden or unavailable/);
    assert.equal(await page.getByTestId("basis-return").count(), 0);
    await page.getByTestId("basis-latest").evaluate((element): void => { if (!(element instanceof HTMLElement)) throw new TypeError("The endpoint must be a native element."); element.inert = false; });
    await upload(page, url, packet2); const removed = await open(page, "basis-review-brief", "to", to);
    await removed.evaluate((element): void => { element.remove(); }); await page.getByTestId("basis-return").click();
    assert.match(await page.getByTestId("packet-error").innerText(), /originating explanation changed or was removed/);
    assert.equal(await page.getByTestId("basis-return").count(), 0);
    await restore(page, url, history, 7); await page.getByTestId("basis-decision").selectOption(fixture.decisionId); await page.getByTestId("basis-event").selectOption(first.id); await page.getByTestId("basis-compare-event").selectOption(last.id);
    const hidden = await open(page, "basis-review-brief", "to", to);
    await hidden.evaluate((element): void => { const explanation = element.closest("#basis-review-brief"); if (!(explanation instanceof HTMLElement)) throw new ReferenceError("The origin must belong to the brief."); explanation.hidden = true; });
    await page.getByTestId("basis-return").click(); assert.match(await page.getByTestId("basis-error").innerText(), /originating explanation is hidden/); assert.equal(await page.getByTestId("basis-return").count(), 0);
    assert.deepEqual(await bytes(page), preserved);

    const older = basisFixture(), original = JSON.stringify(clarificationHistoryExport(older.state, "2026-10-08T00:00:00.000Z"));
    await restore(page, url, original, 6); const olderBytes = await bytes(page);
    await page.getByTestId("basis-decision").selectOption(older.decisionId); await page.getByTestId("basis-event").selectOption(older.firstOutcomeId); await page.getByTestId("basis-compare-event").selectOption(older.finalOutcomeId);
    for (const side of ["from", "to"] as const) for (const kind of ["decision", "assumption", "source", "source-event", "evidence", "review", "outcome"] as const) {
      const candidate = page.getByTestId("basis-review-brief").locator(`button[data-basis-ref-side="${side}"][data-basis-ref-kind="${kind}"]`).first();
      await roundTrip(page, "basis-panel", "basis-review-brief", side, { kind, id: z.string().parse(await candidate.getAttribute("data-basis-ref-id")) });
    }
    await roundTrip(page, "basis-panel", "basis-differences", "to", { kind: "replacement", id: older.replacementId });
    assert.deepEqual(await bytes(page), olderBytes);
    const packet1 = await download(page, "basis-export"); assert.equal(inspectComparisonPacket(packet1).packet.packetSchemaVersion, 1);
    await upload(page, url, packet1);
    await roundTrip(page, "packet-result", "basis-review-brief", "from", { kind: "decision", id: older.decisionId });
    await roundTrip(page, "packet-result", "basis-differences", "to", { kind: "outcome", id: older.finalOutcomeId });
    assert.deepEqual(await bytes(page), olderBytes); assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log("basis_reference_navigation_smoke_passed", { exactEndpoints: true, workspaceAndPacketV1V2: true, repeatedOrigins: true, focusAndReadingPosition: true, disclosureAndNestedScrollRestoration: true, staleOriginsInvalidated: true, explicitFailures: true, keyboard: true, mobile: true, reducedMotion: true, accessibility: true, print: true, unchangedStorageAndExports: true, practitionerUsefulness: false });
  } finally { await desktop.close(); await mobile.close(); }
}
