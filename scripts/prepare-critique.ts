import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { EvidenceInputSchema, ORIGINAL_DECISION, getEvidence } from "../src/scenario.ts";
import type { FixtureEvidence } from "../src/scenario.ts";
import { REFERENCE_DIRECTORY, readPublicReference } from "./public-reference.ts";
import type { PublicReference } from "./public-reference.ts";

const CritiqueCaseSchema = z.object({ id: z.enum(["A", "B", "C"]), input: EvidenceInputSchema });
type CritiqueCase = z.infer<typeof CritiqueCaseSchema>;
type Artifact = Readonly<{ name: string; content: string }>;

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Resolve the real parent before creating a new, external packet directory. */
async function outputDirectory(args: string[], repository: string): Promise<string> {
  const { values } = parseArgs({ args, options: { "output-dir": { type: "string" } }, strict: true, allowPositionals: false });
  const requested: string | undefined = values["output-dir"];
  if (requested === undefined || !isAbsolute(requested)) {
    throw new TypeError("Provide --output-dir with an absolute new directory outside the public checkout. Create its parent first. Usage: npm run prepare:critique -- --output-dir /absolute/private-parent/new-packet");
  }
  const output: string = join(await realpath(dirname(requested)), basename(requested));
  const distance: string = relative(repository, output);
  if (distance === "" || (distance !== ".." && !distance.startsWith(`..${sep}`) && !isAbsolute(distance))) {
    throw new RangeError(`Critique observations must stay outside the public checkout. Refusing destination ${output}.`);
  }
  return output;
}

/** Reuse preset fields without putting interpretation or a suggested outcome on the handout. */
function fixtureCase(id: "A" | "B", evidence: FixtureEvidence): CritiqueCase {
  return CritiqueCaseSchema.parse({ id, input: {
    capturedAt: evidence.capturedAt, requestedPermissions: evidence.requestedPermissions,
    grantedPermissions: evidence.grantedPermissions,
    sourceNote: "Fictional Atlas manifest inspired by the pinned MCP filesystem documentation in fixtures/public-reference/mcp-filesystem/manifest.json. Scenario dates and permission claims are invented; no operational activity has been observed.",
  } });
}

function critiqueCases(): readonly CritiqueCase[] {
  return [
    fixtureCase("A", getEvidence("EV-003")),
    fixtureCase("B", getEvidence("EV-002")),
    CritiqueCaseSchema.parse({ id: "C", input: {
      capturedAt: getEvidence("EV-002").capturedAt,
      requestedPermissions: ["documents:read"], grantedPermissions: ["documents:read", "documents:write"],
      sourceNote: "Fictional Atlas grant-only scenario inspired by the pinned MCP filesystem documentation in fixtures/public-reference/mcp-filesystem/manifest.json. Its permission claims and dates are invented; no runtime activity has been observed.",
    } }),
  ];
}

function sourceCard(item: CritiqueCase): string {
  return `<article id="source-${item.id}" class="panel" data-testid="source-${item.id}"><h2>Source ${item.id}</h2><dl>
    <div><dt>Source</dt><dd>SRC-001 · Atlas assistant manifest</dd></div>
    <div><dt>Capture · UTC</dt><dd><code>${escapeHtml(item.input.capturedAt)}</code></dd></div>
    <div><dt>Requested permissions</dt><dd><code>${escapeHtml(item.input.requestedPermissions.join(", "))}</code></dd></div>
    <div><dt>Declared granted permissions</dt><dd><code>${escapeHtml(item.input.grantedPermissions.join(", "))}</code></dd></div>
    <div><dt>Runtime activity</dt><dd>Not observed</dd></div>
    <div><dt>Synthetic source note</dt><dd>${escapeHtml(item.input.sourceNote)}</dd></div>
    </dl></article>`;
}

function sourceCards(cases: readonly CritiqueCase[], brand: string, reference: PublicReference): string {
  const original: FixtureEvidence = getEvidence("EV-001");
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <title>Decision Continuity · Synthetic source cards</title><style>${brand}
    body{line-height:1.65}.shell{max-width:900px;padding-top:40px;padding-bottom:40px}h1{font-size:32px;line-height:1.2;color:var(--gold2)}
    p{color:var(--muted)}.panel{padding:24px;margin-top:24px;border-radius:16px;break-inside:avoid}h2{font-size:20px;color:var(--gold2)}
    dl{margin:0}dl>div{display:grid;grid-template-columns:220px minmax(0,1fr);gap:16px;padding:12px 0;border-bottom:1px solid var(--line)}
    dt{color:var(--muted);font-size:13px}dd{margin:0;overflow-wrap:anywhere}code{font-size:13px}.scope{border-left:3px solid var(--gold);padding-left:16px}
    @media(max-width:600px){.shell{padding:24px 18px}h1{font-size:27px}.panel{padding:18px}dl>div{grid-template-columns:1fr;gap:5px}}
    @media print{@page{margin:16mm}body,html{background:white;color:black}.shell{padding:0;max-width:none}.panel{background:white;border:1px solid #666;box-shadow:none}h1,h2,p,dt{color:black}.panel:not(:last-child){break-after:page}.scope{border-color:#666}}
    </style></head><body><main class="shell"><p>Bridge Node 7 / Decision Continuity</p><h1>Synthetic source records</h1>
    <p class="scope">Fictional material for a guided critique. No operational observations, authenticated identities, or client information.</p>
    <p>Public inspiration: <a href="${escapeHtml(reference.url)}">MCP filesystem documentation</a>, commit <code>${reference.commit}</code>; ${escapeHtml(reference.attribution)}. ${escapeHtml(reference.license)} Captured ${reference.capturedAt}. Documentation distinguishes tool capabilities; Atlas permission requests, grants, actors, outcomes and dates are invented. Nothing was installed or executed.</p>
    <section class="panel" aria-labelledby="basis-title"><h2 id="basis-title">Original approval basis</h2><p>${escapeHtml(ORIGINAL_DECISION.statement)}</p><dl>
    <div><dt>Decision revision</dt><dd>${ORIGINAL_DECISION.revision}</dd></div><div><dt>Original evidence</dt><dd>${original.id} · ${original.sourceId}</dd></div>
    <div><dt>Capture · UTC</dt><dd><code>${original.capturedAt}</code></dd></div><div><dt>Requested permissions</dt><dd><code>${original.requestedPermissions.join(", ")}</code></dd></div>
    <div><dt>Declared granted permissions</dt><dd><code>${original.grantedPermissions.join(", ")}</code></dd></div><div><dt>Runtime activity</dt><dd>Not observed</dd></div></dl></section>
    ${cases.map(sourceCard).join("")}<p>Use synthetic material only. These source fields do not establish that any real permission was granted or used.</p></main></body></html>`;
}

/** A blank observation artifact references the sole protocol; it is not a product task register. */
function observationWorksheet(repository: string): string {
  return `# Private critique observations — unassigned

No practitioner session has been recorded. Leave fields blank until a real session occurs. This file is outside the public repository; do not copy identities, confidential examples, or raw notes into GitHub or Linear.

Protocol: [reviewer kit](${join(repository, "docs/reviewer-kit.md")}). Run directions: [README](${join(repository, "README.md")}). The protocol owns tasks, neutral questions, scoring definitions and the continuation gate.

Participant code:
Date/time and time zone:
Role category and relevant assessment experience:
Permission for anonymized notes (unconfirmed / granted / declined):
Separate recording consent, if applicable:
Current reassessment trigger, frequency, tools, accountable owner and capture/link-maintenance burden:

| Task/source | Browser session UUID | Start/end | Observed actions or errors | Assistance used | Participant words | Facilitator interpretation |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
| Optional capture | | | | | | |

Do not treat facilitator interpretation or automated rehearsal as participant evidence.

| Dimension from the protocol | Score (leave blank until observed) | Evidence and assistance |
| --- | --- | --- |
| Permissions | | |
| Decision trace | | |
| Control comprehension | | |
| Accountability/history | | |
| Maintenance fit | | |

Synthetic export filename(s) and matching session UUID(s):
Recurring problem described in actual work:
What current tools already handle:
Expected capture/link burden and a way to measure it:
Contradictions, missing context and uncertainty:
Agreed bounded next step, if any:
Proposed interpretation of the protocol gate (not a market conclusion):

The packet manifest hashes the blank preparation snapshot. Filling this worksheet changes its hash normally; hashes are consistency metadata, not consent or tamper-proof auditing.
`;
}

/** Write a new owner-only packet; an existing directory or file fails without replacement. */
async function preparePacket(repository: string, output: string): Promise<void> {
  const cases: readonly CritiqueCase[] = critiqueCases();
  const reference: PublicReference = await readPublicReference(repository);
  const sourceFiles: readonly string[] = ["src/scenario.ts", "scripts/prepare-critique.ts", "scripts/public-reference.ts", "design/brand.css", "docs/reviewer-kit.md", `${REFERENCE_DIRECTORY}/manifest.json`, ...reference.artifacts.map((artifact): string => `${REFERENCE_DIRECTORY}/${artifact.name}`)];
  const sources = await Promise.all(sourceFiles.map(async (path: string): Promise<{ path: string; sha256: string }> => ({ path, sha256: hash(await readFile(join(repository, path), "utf8")) })));
  const artifacts: readonly Artifact[] = [
    { name: "source-cards.html", content: sourceCards(cases, await readFile(join(repository, "design/brand.css"), "utf8"), reference) },
    { name: "observations.md", content: observationWorksheet(repository) },
    { name: "sources.json", content: JSON.stringify({ packetSchemaVersion: 1, publicReference: reference, originalDecision: ORIGINAL_DECISION, originalEvidence: getEvidence("EV-001"), cases }, null, 2) + "\n" },
  ];
  await mkdir(output, { mode: 0o700 });
  for (const artifact of artifacts) await writeFile(join(output, artifact.name), artifact.content, { flag: "wx", mode: 0o600 });
  const manifest = {
    packetSchemaVersion: 1, preparedAt: new Date().toISOString(), status: "Prepared; no practitioner session recorded",
    repository, sources, artifacts: artifacts.map((artifact: Artifact): { name: string; sha256: string } => ({ name: artifact.name, sha256: hash(artifact.content) })),
    limitations: "Synthetic guided critique; hashes record preparation consistency, not authentication, consent, secure auditing or product validation.",
  };
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log("decision_continuity_critique_prepared", { outputDirectory: output, files: [...artifacts.map((artifact: Artifact): string => artifact.name), "manifest.json"], practitionerValidation: "Not performed" });
}

const repository: string = await realpath(dirname(dirname(fileURLToPath(import.meta.url))));
await preparePacket(repository, await outputDirectory(process.argv.slice(2), repository));
