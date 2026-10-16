import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { ClarificationStateSchema } from "../src/clarification-model.ts";
import type { ClarificationState } from "../src/clarification-model.ts";
import { clarificationStorageKey } from "../src/clarification-storage.ts";
import { ClarificationHistoryExportSchema } from "../src/clarification-export.ts";

type StorageBytes = Readonly<{ local: Record<string, string>; session: Record<string, string> }>;
type StoryReference = Readonly<{ testId: string; kind: string; id: string; facts: Readonly<Record<string, string>> }>;
const sourceNote: string = "Synthetic permission declaration for a long-form review rehearsal. Requested permissions and independently declared grants describe separate facts. Deployment remains Unknown and runtime activity is Not observed. ".repeat(4).trim();

async function ready(page: Page): Promise<void> { await page.locator('html[data-app-ready="true"]').waitFor(); }
async function bytes(page: Page): Promise<StorageBytes> {
  return page.evaluate((): StorageBytes => ({ local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage)) }));
}
async function saved(page: Page): Promise<ClarificationState> {
  const id = z.uuid().parse(new URL(page.url()).searchParams.get("session"));
  const content = await page.evaluate((key: string): string | null => localStorage.getItem(key), clarificationStorageKey(id));
  return ClarificationStateSchema.parse(JSON.parse(z.string().parse(content)));
}
async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(result.violations.map((item): string => `${item.id}: ${item.nodes.map((node): string => node.target.join(" ")).join(", ")}`), []);
  assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true, "Decision story must reflow without page overflow.");
}
async function capture(page: Page, requests: readonly string[], note: string): Promise<void> {
  await page.getByTestId("shared-time").fill(new Date().toISOString().slice(0, -1).replace(/0+$/, "").replace(/\.$/, ""));
  for (const permission of ["read", "write", "delete"]) {
    await page.getByTestId(`shared-request-${permission}`).setChecked(requests.includes(permission));
    await page.getByTestId(`shared-grant-${permission}`).setChecked(permission === "read");
  }
  await page.getByTestId("shared-environment").selectOption("Unknown");
  await page.getByTestId("shared-note").fill(note);
  await page.getByTestId("shared-capture").click();
  assert.equal(await page.getByTestId("shared-error").isVisible(), false, z.string().parse(await page.getByTestId("shared-error").textContent()));
}
async function inspectAndReturn(page: Page, reference: StoryReference): Promise<void> {
  const control = page.getByTestId(reference.testId), preserved = await bytes(page);
  assert.equal(await control.getAttribute("data-story-kind"), reference.kind);
  assert.equal(await control.getAttribute("data-story-id"), reference.id);
  await control.evaluate((element): void => {
    if (!(element instanceof HTMLButtonElement)) throw new TypeError("A story reference requires a native button.");
    element.focus({ preventScroll: true }); element.scrollIntoView({ block: "center", behavior: "instant" });
  });
  const before = await page.evaluate((): Readonly<{ x: number; y: number }> => ({ x: scrollX, y: scrollY }));
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#shared-inspector").evaluate((element): boolean => element === document.activeElement), true);
  const facts = await page.getByTestId("shared-inspection").evaluate((element): Record<string, string> => Object.fromEntries([...element.querySelectorAll("dt")].map((term): [string, string] => {
    if (!(term.nextElementSibling instanceof HTMLElement)) throw new TypeError("An inspected fact requires its preserved value.");
    return [term.textContent ?? "", term.nextElementSibling.textContent ?? ""];
  })));
  for (const [label, value] of Object.entries(reference.facts)) assert.equal(facts[label], value, `${reference.testId} must inspect its exact ${label}.`);
  await page.getByTestId("story-return").focus(); await page.keyboard.press("Enter");
  assert.equal(await control.evaluate((element): boolean => element === document.activeElement), true);
  assert.equal(await page.getByTestId("story-return").isVisible(), false);
  const after = await page.evaluate((): Readonly<{ x: number; y: number }> => ({ x: scrollX, y: scrollY }));
  assert.ok(Math.abs(after.x - before.x) <= 1 && Math.abs(after.y - before.y) <= 1, "Returning restores the story's reading position.");
  assert.deepEqual(await bytes(page), preserved, "Story inspection and return preserve all local/session storage bytes.");
}
async function compare(page: Page, decisionId: string, sourceEventId: string): Promise<void> {
  const preserved = await bytes(page);
  await page.getByTestId("story-compare").focus(); await page.keyboard.press("Enter");
  assert.equal(await page.getByTestId("basis-decision").inputValue(), decisionId);
  assert.equal(await page.getByTestId("basis-event").inputValue(), sourceEventId);
  assert.equal(await page.getByTestId("basis-compare-event").inputValue(), "latest");
  assert.equal(await page.getByTestId("basis-panel").evaluate((element): boolean => element === document.activeElement), true);
  assert.equal(await page.getByTestId("basis-error").isVisible(), false);
  assert.deepEqual(await bytes(page), preserved, "Opening recorded-state comparison only changes reading context.");
}

/** Rehearse the complete visual explanation using real browser-created records and exact inspection round trips. */
export async function checkDecisionStory(browser: Browser, url: string): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const fresh = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  for (const item of [context, fresh]) item.setDefaultTimeout(5000);
  try {
    const page = await context.newPage(), restored = await fresh.newPage(), errors: Error[] = [], consoleErrors: string[] = [], external: string[] = [];
    for (const reader of [page, restored]) {
      reader.on("pageerror", (error: Error): void => { errors.push(error); });
      reader.on("console", (message): void => { if (message.type() === "error") consoleErrors.push(message.text()); });
      reader.on("request", (request): void => { const target = new URL(request.url()); if (["http:", "https:"].includes(target.protocol) && target.origin !== new URL(url).origin) external.push(target.href); });
    }
    await page.goto(`${url}/impact.html?format=6`); await ready(page);
    assert.deepEqual(await bytes(page), { local: {}, session: {} });
    await page.getByTestId("shared-actor").fill("SIM_STORY_REVIEWER");
    await page.getByTestId("shared-synthetic").check(); await page.getByTestId("shared-create").click();
    await page.waitForURL((next: URL): boolean => next.searchParams.has("session")); await ready(page);
    const baseline = await saved(page), a = baseline.sources[0], request = baseline.originalDecisions[0], grant = baseline.originalDecisions[1], production = baseline.originalDecisions[2];
    assert.ok(a !== undefined && request !== undefined && grant !== undefined && production !== undefined);
    assert.equal(await page.getByTestId("story-decision").inputValue(), request.decision.id);
    assert.equal(await page.getByTestId("story-support").getAttribute("data-story-id"), a.evidence.id);
    assert.equal(await page.getByTestId("story-status").innerText(), "No relevant change");
    assert.equal(await page.getByTestId("story-outcome-label").innerText(), "No outcome recorded");
    await capture(page, ["read"], "Synthetic unchanged control: requested read, independently declared read granted, context Unknown and runtime Not observed.");
    const control = await saved(page);
    assert.equal(control.sources.length, 2); assert.deepEqual(control.reviews, []); assert.deepEqual(control.outcomes, []);
    assert.equal(await page.getByTestId("story-status").innerText(), "No relevant change");
    const controlBytes = await bytes(page);
    await page.getByTestId("story-next-review").click();
    assert.equal(await page.getByTestId("shared-open-review").isDisabled(), true);
    assert.deepEqual(await bytes(page), controlBytes);
    await capture(page, ["read", "write"], sourceNote);
    const changed = await saved(page), b = changed.sources.at(-1); assert.ok(b !== undefined);
    assert.equal(changed.sources.length, 3); assert.deepEqual(changed.reviews, []); assert.deepEqual(changed.outcomes, []);
    assert.equal(await page.getByTestId("story-status").innerText(), "Review needed");
    assert.ok((await page.getByTestId("story-delta").innerText()).includes("Added write"));
    assert.ok((await page.getByTestId("story-reason").innerText()).includes("Requested access"));
    assert.equal(await page.getByTestId("story-outcome-label").innerText(), "No outcome recorded");
    await page.getByTestId("story-next-review").focus(); await page.keyboard.press("Enter");
    assert.equal(await page.getByTestId("shared-review-decision").inputValue(), request.decision.id);
    assert.equal(await page.locator("#shared-review-section").evaluate((element): boolean => element === document.activeElement), true);
    assert.deepEqual(await saved(page), changed, "The story's next action selects review context without opening a review.");
    await page.getByTestId("shared-open-review").click();
    const opened = await saved(page), review = opened.reviews[0]; assert.ok(review !== undefined);
    assert.equal(review.evidenceId, b.evidence.id); assert.equal(review.basis.evidenceId, a.evidence.id);
    assert.deepEqual(opened.outcomes, []);
    const deferredRationale = "Synthetic accountable deferral: preserve the read-only basis while the changed request and Unknown deployment are independently assessed.";
    await page.getByTestId("shared-outcome").selectOption("defer");
    await page.getByTestId("shared-rationale").fill(deferredRationale);
    await page.getByTestId("shared-statement").fill("Keep the earlier synthetic read-only boundary pending a separate accountable reassessment of this exact capture.");
    await page.getByTestId("shared-record-outcome").click();
    const deferred = await saved(page), deferral = deferred.outcomes[0]; assert.ok(deferral !== undefined);
    assert.equal(deferral.outcome, "defer"); assert.equal(deferral.evidenceId, b.evidence.id);
    assert.equal(await page.getByTestId("story-outcome-label").innerText(), "Deferred — more evidence needed");
    await capture(page, ["read", "write", "delete"], "Synthetic later capture C adds a delete request; declared grants remain read-only, deployment is Unknown, and runtime is Not observed.");
    const later = await saved(page), c = later.sources.at(-1); assert.ok(c !== undefined);
    assert.deepEqual(later.reviews, deferred.reviews); assert.deepEqual(later.outcomes, deferred.outcomes);
    assert.equal(await page.getByTestId("story-support").getAttribute("data-story-id"), a.evidence.id);
    assert.equal(await page.getByTestId("story-target").getAttribute("data-story-id"), b.evidence.id);
    assert.equal(await page.getByTestId("story-latest").getAttribute("data-story-id"), c.evidence.id);
    assert.notEqual(b.evidence.id, c.evidence.id);
    assert.ok((await page.getByTestId("story-frozen").innerText()).includes("later capture"));
    const references: readonly StoryReference[] = [
      { testId: "story-support", kind: "evidence", id: a.evidence.id, facts: { "Evidence UUID": a.evidence.id, Requested: "documents:read", "Declared granted": "documents:read", "Deployment declaration": "Unknown", Runtime: "Not observed" } },
      { testId: "story-latest", kind: "evidence", id: c.evidence.id, facts: { "Evidence UUID": c.evidence.id, Requested: "documents:read, documents:write, documents:delete", "Declared granted": "documents:read", "Deployment declaration": "Unknown" } },
      { testId: "story-target", kind: "evidence", id: b.evidence.id, facts: { "Evidence UUID": b.evidence.id, Requested: "documents:read, documents:write", "Source note": sourceNote.trim() } },
      { testId: "story-review", kind: "review", id: review.id, facts: { "Review UUID": review.id, "Basis evidence": a.evidence.id, "Target evidence": b.evidence.id, "Target source event": b.id, "Assigned code": "SIM_STORY_REVIEWER" } },
      { testId: "story-rule", kind: "assumption", id: request.assumption.id, facts: { "Assumption UUID": request.assumption.id, "Decision UUID": request.decision.id, "Monitored field": "Requested permissions" } },
      { testId: "story-basis", kind: "decision", id: request.decision.id, facts: { "Applicable revision": request.decision.revision, "Basis source event": a.id, "Compared source event": c.id, "Accountable rationale": request.decision.rationale } },
      { testId: "story-outcome", kind: "outcome", id: deferral.id, facts: { "Outcome UUID": deferral.id, "Review UUID": review.id, "Exact evidence": b.evidence.id, "Responsible code": "SIM_STORY_REVIEWER", Rationale: deferredRationale } },
    ];
    for (const reference of references) await inspectAndReturn(page, reference);
    await compare(page, request.decision.id, a.id);
    const preserved = await bytes(page);
    await page.getByTestId("story-decision").selectOption(grant.decision.id);
    assert.equal(await page.getByTestId("story-status").innerText(), "No relevant change");
    assert.ok((await page.getByTestId("story-delta").innerText()).includes("No change to the monitored permissions"));
    assert.equal(await page.getByTestId("story-target").count(), 0);
    await page.getByTestId("story-decision").selectOption(production.decision.id);
    assert.equal(await page.getByTestId("story-status").innerText(), "Context unresolved");
    assert.ok((await page.getByTestId("story-reason").innerText()).includes("Deployment context is Unknown"));
    await page.getByTestId("story-decision").selectOption(request.decision.id);
    assert.deepEqual(await bytes(page), preserved, "Changing the explanation's decision never records evidence, reviews or outcomes.");
    const invalidTime = new Date(Date.parse(a.recordedAt) - 60000).toISOString().slice(0, -1).replace(/0+$/, "").replace(/\.$/, "");
    await page.getByTestId("shared-time").fill(invalidTime);
    await page.getByTestId("shared-note").fill(sourceNote); await page.getByTestId("shared-capture").click();
    assert.equal(await page.getByTestId("shared-error").isVisible(), true);
    assert.ok((await page.getByTestId("shared-error").innerText()).includes("chronology"));
    assert.deepEqual(await bytes(page), preserved, "An invalid capture cannot mutate preserved history.");
    await accessible(page);
    assert.equal(consoleErrors.length, 1, "Only the deliberately invalid chronology may emit a diagnostic.");
    assert.ok(consoleErrors[0]?.startsWith("decision_continuity_shared_error"));
    await page.getByTestId("story-next-review").click();
    await page.getByTestId("shared-outcome").selectOption("revise");
    await page.getByTestId("shared-boundary-read").check(); await page.getByTestId("shared-boundary-write").check(); await page.getByTestId("shared-boundary-delete").uncheck();
    await page.getByTestId("shared-rationale").fill("Synthetic accountable revision accepts the read and write request of frozen capture B only. Later delete requests and actual runtime require separate assessment.");
    await page.getByTestId("shared-statement").fill("Accept this synthetic read and write request boundary for capture B; keep declared grants independent and make no production or runtime approval claim.");
    await page.getByTestId("shared-record-outcome").click();
    const completed = await saved(page), outcome = completed.outcomes.at(-1); assert.ok(outcome !== undefined);
    assert.equal(completed.outcomes.length, 2); assert.equal(completed.reviews.length, 1);
    assert.equal(outcome.outcome, "revise"); assert.equal(outcome.evidenceId, b.evidence.id); assert.equal(outcome.reviewId, review.id);
    assert.deepEqual(completed.originalDecisions, baseline.originalDecisions); assert.deepEqual(completed.sources, later.sources);
    assert.equal(await page.getByTestId("story-outcome-label").innerText(), "Revised");
    assert.equal(await page.getByTestId("story-support").getAttribute("data-story-id"), b.evidence.id);
    assert.equal(await page.getByTestId("story-latest").getAttribute("data-story-id"), c.evidence.id);
    assert.equal(await page.getByTestId("story-target").count(), 0);
    assert.equal(await page.getByTestId("story-status").innerText(), "Review needed", "Later capture C is still assessed separately after the human outcome for B.");
    await compare(page, request.decision.id, outcome.id);
    const completedBytes = await bytes(page);
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 375, height: 812 }]) {
      await page.setViewportSize(viewport);
      await page.getByTestId("nav-workspace-overview").click();
      await accessible(page);
      await inspectAndReturn(page, { testId: "story-support", kind: "evidence", id: b.evidence.id, facts: { "Evidence UUID": b.evidence.id, "Source note": sourceNote.trim() } });
      await inspectAndReturn(page, { testId: "story-outcome", kind: "outcome", id: outcome.id, facts: { "Outcome UUID": outcome.id, "Exact evidence": b.evidence.id, Rationale: outcome.rationale } });
      if (viewport.width === 1440 || viewport.width === 375) await page.getByTestId("workspace-overview").screenshot({ path: `output/playwright/decision-story-${viewport.width === 1440 ? "desktop" : "mobile"}.png`, animations: "disabled" });
      assert.deepEqual(await bytes(page), completedBytes);
    }
    assert.equal(await page.evaluate((): string => getComputedStyle(document.documentElement).scrollBehavior), "auto");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate((): void => { document.documentElement.style.zoom = "2"; });
    await page.getByTestId("nav-workspace-overview").click(); await accessible(page);
    await inspectAndReturn(page, { testId: "story-latest", kind: "evidence", id: c.evidence.id, facts: { "Evidence UUID": c.evidence.id } });
    await page.screenshot({ path: "output/playwright/decision-story-css-zoom-200.png", animations: "disabled" });
    await page.evaluate((): void => { document.documentElement.style.removeProperty("zoom"); });
    assert.deepEqual(await bytes(page), completedBytes);
    const waiting = page.waitForEvent("download"); await page.getByTestId("shared-export").click();
    const exported = await readFile(z.string().parse(await (await waiting).path()), "utf8");
    assert.deepEqual(ClarificationHistoryExportSchema.parse(JSON.parse(exported)).session, completed);
    await page.reload(); await ready(page); assert.deepEqual(await saved(page), completed); assert.deepEqual(await bytes(page), completedBytes);
    await restored.goto(`${url}/impact.html?format=6`); await ready(restored);
    await restored.getByTestId("import-toggle").click();
    await restored.getByTestId("import-file").setInputFiles({ name: "synthetic-story-history.json", mimeType: "application/json", buffer: Buffer.from(exported) });
    await restored.getByTestId("inspect-import").click(); await restored.getByTestId("import-preview").waitFor({ state: "visible" });
    assert.deepEqual(await bytes(restored), { local: {}, session: {} });
    await restored.getByTestId("confirm-import").click(); await restored.waitForURL((next: URL): boolean => next.searchParams.get("session") === completed.id); await ready(restored);
    assert.deepEqual(await saved(restored), completed);
    assert.equal(await restored.getByTestId("story-support").getAttribute("data-story-id"), b.evidence.id);
    assert.equal(await restored.getByTestId("story-latest").getAttribute("data-story-id"), c.evidence.id);
    assert.equal(await restored.getByTestId("story-outcome-label").innerText(), "Revised");
    await restored.getByTestId("story-next-review").click(); await restored.getByTestId("shared-open-review").click();
    await restored.getByTestId("shared-outcome").selectOption("withdraw");
    await restored.getByTestId("shared-rationale").fill("Synthetic accountable withdrawal: the later delete request is outside the revised boundary and this rehearsal decision will no longer supply an active basis.");
    await restored.getByTestId("shared-statement").fill("Withdraw the synthetic request decision while preserving its earlier read-only basis, frozen review, and recorded read/write revision.");
    await restored.getByTestId("shared-record-outcome").click();
    const withdrawn = await saved(restored), withdrawnBytes = await bytes(restored);
    assert.equal(withdrawn.outcomes.at(-1)?.outcome, "withdraw");
    assert.equal(await restored.getByTestId("story-status").innerText(), "Decision withdrawn");
    assert.equal(await restored.getByTestId("story-support").count(), 0);
    assert.equal(await restored.getByTestId("story-compare").isVisible(), false);
    await restored.getByTestId("story-decision").selectOption(grant.decision.id);
    assert.equal(await restored.getByTestId("story-compare").isVisible(), true);
    await restored.getByTestId("story-decision").selectOption(request.decision.id);
    assert.equal(await restored.getByTestId("story-compare").isVisible(), false);
    assert.equal(await restored.getByTestId("story-status").innerText(), "Decision withdrawn");
    assert.deepEqual(await bytes(restored), withdrawnBytes);
    await accessible(restored);
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.equal(consoleErrors.length, 1);
    console.log("decision_story_smoke_passed", { realBrowserCreation: true, unchangedControl: true, activeBasisAndFrozenTargetSeparate: true, exactReferences: true, focusScrollAndStoragePreserved: true, comparisonSynchronized: true, requestGrantAndUnknownSeparate: true, validationFailurePreserved: true, longSourceNote: true, explicitDeferralAndRevision: true, withdrawnDecisionReselection: true, desktopTabletMobile: true, reducedMotion: true, cssZoom200ReflowApproximation: true, exportReloadFreshImport: true, accessibility: true, syntheticOnly: true, practitionerParticipation: false });
  } finally { await context.close(); await fresh.close(); }
}
