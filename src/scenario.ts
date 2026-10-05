import { z } from "zod";

export const FixtureEvidenceIdSchema = z.enum(["EV-001", "EV-002", "EV-003"]);
export const EvidenceIdSchema = z.enum(["EV-001", "EV-002", "EV-003", "EV-004"]);
export const PermissionSchema = z.enum(["documents:read", "documents:write"]);
export const OutcomeSchema = z.enum(["reaffirm", "revise", "withdraw", "defer"]);

export const FixtureEvidenceSchema = z.object({
  id: FixtureEvidenceIdSchema,
  sourceId: z.literal("SRC-001"),
  sourceName: z.literal("Atlas assistant manifest"),
  provenance: z.literal("Synthetic fixture; no operational observations"),
  capturedAt: z.iso.datetime(),
  requestedPermissions: z.array(PermissionSchema).min(1),
  grantedPermissions: z.array(PermissionSchema).min(1),
  observedActivity: z.literal("Not observed"),
});

const AuthoredPermissionsSchema = z.array(PermissionSchema).min(1).refine(
  (permissions): boolean => new Set(permissions).size === permissions.length,
  "Permission entries must be unique.",
);

export const EvidenceInputSchema = z.object({
  sourceNote: z.string().trim().min(16, "Describe the synthetic source in at least 16 characters.").max(1000),
  capturedAt: z.iso.datetime(),
  requestedPermissions: AuthoredPermissionsSchema,
  grantedPermissions: AuthoredPermissionsSchema,
});

export const AuthoredEvidenceSchema = EvidenceInputSchema.extend({
  id: z.literal("EV-004"),
  sourceId: z.literal("SRC-001"),
  sourceName: z.literal("Atlas assistant manifest"),
  provenance: z.literal("Manually authored synthetic version; no operational observations"),
  observedActivity: z.literal("Not observed"),
});

export const EvidenceSchema = z.union([FixtureEvidenceSchema, AuthoredEvidenceSchema]);
export type FixtureEvidenceId = z.infer<typeof FixtureEvidenceIdSchema>;
export type FixtureEvidence = z.infer<typeof FixtureEvidenceSchema>;
export type Permission = z.infer<typeof PermissionSchema>;
export type EvidenceId = z.infer<typeof EvidenceIdSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type EvidenceInput = z.infer<typeof EvidenceInputSchema>;
export type AuthoredEvidence = z.infer<typeof AuthoredEvidenceSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;

export const ORIGINAL_DECISION = Object.freeze({
  id: "DEC-001",
  revision: "DEC-001.1",
  statement: "Approve Atlas to summarize synthetic project documents with read-only access.",
  rationale: "The documented request and declared grant are limited to documents:read. Approval covers summarization only; no write activity has been observed or authorized by this decision.",
  assumptionId: "ASM-001",
  assumption: "The assistant requests only read access to documents.",
  evidenceId: "EV-001" as const,
  decidedAt: "2026-09-28T16:00:00Z",
  actor: "Morgan Lee — synthetic reviewer",
});

const evidenceVersions: readonly FixtureEvidence[] = z.array(FixtureEvidenceSchema).parse([
  {
    id: "EV-001", sourceId: "SRC-001", sourceName: "Atlas assistant manifest",
    provenance: "Synthetic fixture; no operational observations",
    capturedAt: "2026-09-28T15:00:00Z", requestedPermissions: ["documents:read"],
    grantedPermissions: ["documents:read"], observedActivity: "Not observed",
  },
  {
    id: "EV-002", sourceId: "SRC-001", sourceName: "Atlas assistant manifest",
    provenance: "Synthetic fixture; no operational observations",
    capturedAt: "2026-10-02T15:00:00Z", requestedPermissions: ["documents:read", "documents:write"],
    grantedPermissions: ["documents:read"], observedActivity: "Not observed",
  },
  {
    id: "EV-003", sourceId: "SRC-001", sourceName: "Atlas assistant manifest",
    provenance: "Synthetic fixture; no operational observations",
    capturedAt: "2026-10-02T15:00:00Z", requestedPermissions: ["documents:read"],
    grantedPermissions: ["documents:read"], observedActivity: "Not observed",
  },
]);

/** Return a versioned synthetic source; callers must not mutate the returned fixture. */
export function getEvidence(id: FixtureEvidenceId): FixtureEvidence {
  const evidence: FixtureEvidence | undefined = evidenceVersions.find((version: FixtureEvidence): boolean => version.id === id);
  if (evidence === undefined) throw new RangeError(`Evidence version ${id} is absent from the synthetic fixture set.`);
  return FixtureEvidenceSchema.parse(evidence);
}

/** Flag only a contradiction of the explicit read-request assumption, not a grant or runtime claim. */
export function requiresReview(evidence: Evidence): boolean {
  return evidence.requestedPermissions.includes("documents:write");
}
