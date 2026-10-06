import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const ReferenceSchema = z.object({
  referenceSchemaVersion: z.literal(1), repository: z.literal("https://github.com/modelcontextprotocol/servers"),
  commit: z.string().regex(/^[a-f0-9]{40}$/), capturedAt: z.iso.datetime(), url: z.url(),
  attribution: z.string().min(1), license: z.string().min(1),
  artifacts: z.array(z.object({
    name: z.enum(["README.upstream.md", "LICENSE.upstream.txt"]), upstreamPath: z.string(),
    url: z.url(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })).length(2),
  publicFacts: z.array(z.string()), limitations: z.string(),
});
export type PublicReference = z.infer<typeof ReferenceSchema>;
export const REFERENCE_DIRECTORY = "fixtures/public-reference/mcp-filesystem";

/** Validate the pinned local capture without contacting upstream or refreshing its bytes. */
export async function readPublicReference(repository: string): Promise<PublicReference> {
  const directory: string = join(repository, REFERENCE_DIRECTORY);
  const reference: PublicReference = ReferenceSchema.parse(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")));
  if (new Set(reference.artifacts.map((artifact): string => artifact.name)).size !== 2) {
    throw new RangeError("The public reference must preserve distinct documentation and license artifacts.");
  }
  for (const artifact of reference.artifacts) {
    const expectedUrl: string = `https://raw.githubusercontent.com/modelcontextprotocol/servers/${reference.commit}/${artifact.upstreamPath}`;
    if (artifact.url !== expectedUrl) throw new RangeError(`Reference ${artifact.name} is not pinned to commit ${reference.commit}.`);
    const actual: string = createHash("sha256").update(await readFile(join(directory, artifact.name))).digest("hex");
    if (actual !== artifact.sha256) throw new RangeError(`Public reference hash mismatch for ${artifact.name}: expected ${artifact.sha256}, received ${actual}. Preserve the capture and investigate; do not silently refresh it.`);
  }
  return reference;
}
