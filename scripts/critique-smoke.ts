import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { BrowserContext, Page } from "playwright";
import { z } from "zod";
import { EvidenceInputSchema, FixtureEvidenceSchema } from "../src/scenario.ts";
import { StateSchema } from "../src/model.ts";
import { sessionFromUrl } from "../src/sessions.ts";

const run = promisify(execFile);
const PacketSchema = z.object({
  packetSchemaVersion: z.literal(1), originalEvidence: FixtureEvidenceSchema,
  cases: z.array(z.object({ id: z.enum(["A", "B", "C"]), input: EvidenceInputSchema })).length(3),
});
const ManifestSchema = z.object({
  packetSchemaVersion: z.literal(1), preparedAt: z.iso.datetime(), repository: z.string(),
  sources: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })),
  artifacts: z.array(z.object({ name: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })),
});

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function packetRehearsal(page: Page, packet: z.infer<typeof PacketSchema>): Promise<void> {
  const item = packet.cases.find((candidate): boolean => candidate.id === "B");
  assert.ok(item !== undefined);
  await page.goto("http://127.0.0.1:5189");
  await page.getByTestId("new-version-session").click();
  await page.waitForURL((url: URL): boolean => url.searchParams.has("session"));
  await page.getByTestId("capture-time").fill(item.input.capturedAt.slice(0, 16));
  await page.getByTestId("source-note").fill(item.input.sourceNote);
  for (const permission of item.input.requestedPermissions) await page.getByTestId(permission === "documents:read" ? "request-read" : "request-write").check();
  for (const permission of item.input.grantedPermissions) await page.getByTestId(permission === "documents:read" ? "grant-read" : "grant-write").check();
  await page.getByTestId("record-evidence").click();
  await page.getByTestId("open-review").click();
  await page.getByTestId("outcome").selectOption("defer");
  await page.getByTestId("rationale").fill("Automated synthetic rehearsal: source claims do not establish operational grants or observed activity.");
  await page.getByTestId("decision-text").fill("Defer the fictional outcome pending additional evidence. This is not practitioner feedback.");
  await page.getByTestId("record-outcome").click();
  await page.reload();
  const session = sessionFromUrl(new URL(page.url()));
  const raw: string | null = await page.evaluate((key: string): string | null => localStorage.getItem(key), session.storageKey);
  const state = StateSchema.parse(JSON.parse(z.string().parse(raw)));
  assert.equal(state.schemaVersion, 2);
  assert.ok(state.customEvidence !== null);
  const expectedInput = EvidenceInputSchema.parse({ ...item.input, capturedAt: new Date(item.input.capturedAt).toISOString() });
  assert.deepEqual(EvidenceInputSchema.parse(state.customEvidence.evidence), expectedInput, "The prepared handout fields must reach the app without changing their meaning.");
  assert.equal(state.outcomes.at(-1)?.outcome, "defer");
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-history").click();
  const download = await downloadPromise;
  const downloaded = z.object({ session: StateSchema, originalEvidence: FixtureEvidenceSchema }).parse(JSON.parse(await readFile(z.string().parse(await download.path()), "utf8")));
  assert.deepEqual(downloaded.session, state);
  assert.deepEqual(downloaded.originalEvidence, packet.originalEvidence);
}

/** Exercise actual CLI/filesystem boundaries and a prepared case through the real application. */
export async function checkCritiquePreparation(context: BrowserContext): Promise<void> {
  const repository: string = dirname(dirname(fileURLToPath(import.meta.url)));
  const script: string = join(repository, "scripts/prepare-critique.ts");
  const temporary: string = await mkdtemp(join(tmpdir(), "decision-continuity-critique-"));
  const output: string = join(temporary, "packet");
  try {
    await run(process.execPath, [script, "--output-dir", output], { cwd: repository });
    const manifestRaw: string = await readFile(join(output, "manifest.json"), "utf8");
    const manifest = ManifestSchema.parse(JSON.parse(manifestRaw));
    for (const artifact of manifest.artifacts) {
      const path: string = join(output, artifact.name);
      assert.equal(hash(await readFile(path, "utf8")), artifact.sha256);
      assert.equal((await stat(path)).mode & 0o777, 0o600, "Prepared artifacts must be owner-only.");
    }
    assert.equal((await stat(join(output, "manifest.json"))).mode & 0o777, 0o600);
    assert.equal((await stat(output)).mode & 0o777, 0o700);
    for (const source of manifest.sources) assert.equal(hash(await readFile(join(manifest.repository, source.path), "utf8")), source.sha256);
    await assert.rejects(run(process.execPath, [script, "--output-dir", output], { cwd: repository }), { code: 1 });
    assert.equal(await readFile(join(output, "manifest.json"), "utf8"), manifestRaw, "Rejected duplicate preparation must leave the existing packet intact.");
    for (const artifact of manifest.artifacts) assert.equal(hash(await readFile(join(output, artifact.name), "utf8")), artifact.sha256);
    await assert.rejects(run(process.execPath, [script], { cwd: repository }), { code: 1 });
    await assert.rejects(run(process.execPath, [script, "--output-dir", "relative-packet"], { cwd: repository }), { code: 1 });
    const alias: string = join(temporary, "checkout");
    await symlink(repository, alias);
    const blocked: string = join(alias, "output", "critique-packet");
    await assert.rejects(run(process.execPath, [script, "--output-dir", blocked], { cwd: repository }), { code: 1 });
    await assert.rejects(stat(blocked), { code: "ENOENT" });
    const packet = PacketSchema.parse(JSON.parse(await readFile(join(output, "sources.json"), "utf8")));
    const page: Page = await context.newPage();
    const errors: Error[] = [];
    page.on("pageerror", (error: Error): void => { errors.push(error); });
    try {
      await packetRehearsal(page, packet);
      await page.goto(pathToFileURL(join(output, "source-cards.html")).href);
      await page.setViewportSize({ width: 1440, height: 1000 });
      assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: "output/playwright/critique-cards-desktop.png", fullPage: true });
      await page.setViewportSize({ width: 375, height: 812 });
      assert.equal(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: "output/playwright/critique-cards-mobile.png" });
      await page.getByTestId("source-B").screenshot({ path: "output/playwright/critique-source-mobile.png" });
      await page.emulateMedia({ media: "print" });
      await page.getByTestId("source-B").screenshot({ path: "output/playwright/critique-card-print.png" });
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  } finally {
    await rm(temporary, { recursive: true, force: false });
  }
}
