import { z } from "zod";
import { ClarificationFieldsSchema, validateClarificationHistory } from "./clarification-model.ts";
import type { ClarificationHistory } from "./clarification-model.ts";
import { SharedFieldsSchema } from "./shared-model.ts";
import { MAX_BASIS_EVENTS } from "./basis-events.ts";
import type { BasisEvent } from "./basis-events.ts";
import type { BasisComparison } from "./basis-comparison.ts";
import type { BasisInspection } from "./decision-basis.ts";
import { MAX_IMPORT_BYTES } from "./history-contract.ts";

export const MAX_COMPARISON_PACKET_BYTES = MAX_IMPORT_BYTES;
export const COMPARISON_PACKET_NOTICE = "A focused synthetic record archive, not an operational history import. Validation establishes internal references and declared causal cuts only; it cannot authenticate the source, prove completeness of omitted upstream history, establish historical rule versions or demonstrate runtime behavior.";
const fields = SharedFieldsSchema.shape;
const decisionRecord = fields.originalDecisions.element;
const sourceEvent = fields.sources.element;
const review = fields.reviews.element;
export const ComparisonPacketArchiveSchema = z.strictObject({
  id: fields.id,
  source: fields.source.strict(),
  originalDecisions: z.array(decisionRecord.safeExtend({ decision: decisionRecord.shape.decision.strict(), assumption: decisionRecord.shape.assumption.strict() }).strict()).length(1),
  sources: z.array(sourceEvent.safeExtend({ evidence: sourceEvent.shape.evidence.strict() }).strict()).min(1).max(MAX_BASIS_EVENTS),
  reviews: z.array(review.safeExtend({ basis: review.shape.basis.strict() }).strict()).max(MAX_BASIS_EVENTS),
  outcomes: z.array(fields.outcomes.element.strict()).max(MAX_BASIS_EVENTS),
  replacements: z.array(ClarificationFieldsSchema.shape.replacements.element.strict()).max(MAX_BASIS_EVENTS),
}).superRefine((archive, context): void => {
  const record = archive.originalDecisions[0];
  if (record?.assumption.field === "grantedPermissions" && record.assumption.scope === "Production") context.addIssue({ code: "custom", message: "This packet supports only preserved request/Any, grant/Any or request/Production rules from the existing rehearsal." });
  try {
    validateClarificationHistory(archive, context);
  } catch (error) {
    if (!(error instanceof ReferenceError || error instanceof RangeError)) throw error;
    context.addIssue({ code: "custom", message: error.message });
  }
});
const eventIds = z.array(z.uuid()).min(1).max(MAX_BASIS_EVENTS).refine((ids): boolean => new Set(ids).size === ids.length, "An endpoint cannot repeat canonical event UUIDs.");
export const ComparisonPacketEndpointSchema = z.discriminatedUnion("selection", [
  z.strictObject({ selection: z.literal("recorded-event"), eventId: z.uuid(), includedEventIds: eventIds }),
  z.strictObject({ selection: z.literal("frozen-latest"), eventId: z.null(), includedEventIds: eventIds }),
]);
export type ComparisonPacketEndpoint = z.infer<typeof ComparisonPacketEndpointSchema>;

export function selectedPacketEventId(endpoint: ComparisonPacketEndpoint): string {
  return endpoint.selection === "frozen-latest" ? "latest" : endpoint.eventId;
}
export function requireMatchingPacketCut(endpoint: ComparisonPacketEndpoint, inspection: BasisInspection): void {
  if (JSON.stringify(endpoint.includedEventIds) !== JSON.stringify(inspection.includedEventIds)) throw new ReferenceError("The packet endpoint's declared canonical event cut does not match the causal cut reconstructed from its exact preserved selection. No endpoint or order was substituted.");
}
export function comparisonPacketEndpoint(eventId: string, inspection: BasisInspection): ComparisonPacketEndpoint {
  const includedEventIds = [...inspection.includedEventIds];
  return eventId === "latest" ? { selection: "frozen-latest", eventId: null, includedEventIds } : { selection: "recorded-event", eventId, includedEventIds };
}
export function focusedComparisonArchive(state: ClarificationHistory, decisionId: string, comparison: BasisComparison, events: readonly BasisEvent[]): ClarificationHistory {
  const record = state.originalDecisions.find((item): boolean => item.decision.id === decisionId);
  if (record === undefined) throw new ReferenceError("The comparison packet requires its selected original decision.");
  const included = new Set([...comparison.from.includedEventIds, ...comparison.to.includedEventIds]);
  const members = new Set(events.filter((event): boolean => included.has(event.id)).flatMap((event): readonly string[] => event.memberIds));
  return {
    id: state.id, source: state.source, originalDecisions: [record],
    sources: state.sources.filter((event): boolean => included.has(event.id)),
    reviews: state.reviews.filter((item): boolean => item.decisionId === decisionId && members.has(item.id)),
    outcomes: state.outcomes.filter((item): boolean => item.decisionId === decisionId && included.has(item.id)),
    replacements: state.replacements.filter((item): boolean => item.decisionId === decisionId && included.has(item.id)),
  };
}
export function requireComparisonPacketSize(content: string): void {
  if (new TextEncoder().encode(content).byteLength > MAX_COMPARISON_PACKET_BYTES) throw new RangeError("Comparison packet exceeds the 1 MiB inspection limit. Choose an earlier endpoint with fewer required preceding records; no history or packet was truncated or changed.");
}
