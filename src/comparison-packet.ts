import { z } from "zod";
import { ClarificationFieldsSchema, ClarificationStateSchema, validateClarificationHistory } from "./clarification-model.ts";
import type { ClarificationHistory, ClarificationState } from "./clarification-model.ts";
import { SharedFieldsSchema } from "./shared-model.ts";
import { decisionBasisEventsFromRecords, MAX_BASIS_EVENTS } from "./basis-events.ts";
import { compareDecisionBases, compareDecisionBasisRecords } from "./basis-comparison.ts";
import type { BasisComparison } from "./basis-comparison.ts";
import type { BasisInspection } from "./decision-basis.ts";
import { DEMONSTRATION_NOTICE, MAX_IMPORT_BYTES } from "./history-contract.ts";

export const MAX_COMPARISON_PACKET_BYTES = MAX_IMPORT_BYTES;
export const COMPARISON_PACKET_NOTICE = "A focused synthetic record archive, not an operational history import. Validation establishes internal references and declared causal cuts only; it cannot authenticate the source, prove completeness of omitted upstream history, establish historical rule versions or demonstrate runtime behavior.";
const fields = SharedFieldsSchema.shape;
const decisionRecord = fields.originalDecisions.element;
const sourceEvent = fields.sources.element;
const review = fields.reviews.element;
const ArchiveSchema = z.strictObject({
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
const EndpointSchema = z.discriminatedUnion("selection", [
  z.strictObject({ selection: z.literal("recorded-event"), eventId: z.uuid(), includedEventIds: eventIds }),
  z.strictObject({ selection: z.literal("frozen-latest"), eventId: z.null(), includedEventIds: eventIds }),
]);
const PacketFieldsSchema = z.strictObject({
  packetKind: z.literal("decision-basis-comparison"), packetSchemaVersion: z.literal(1),
  createdAt: z.iso.datetime(), demonstration: z.literal(DEMONSTRATION_NOTICE),
  decisionId: z.uuid(), from: EndpointSchema, to: EndpointSchema, archive: ArchiveSchema,
});
export type ComparisonPacket = z.infer<typeof PacketFieldsSchema>;
export type ComparisonPacketEndpoint = z.infer<typeof EndpointSchema>;
export type ComparisonPacketInspection = Readonly<{ packet: ComparisonPacket; archive: ClarificationHistory; comparison: BasisComparison }>;

function selectedId(endpoint: ComparisonPacketEndpoint): string {
  return endpoint.selection === "frozen-latest" ? "latest" : endpoint.eventId;
}
function requireMatchingCut(endpoint: ComparisonPacketEndpoint, inspection: BasisInspection): void {
  if (JSON.stringify(endpoint.includedEventIds) !== JSON.stringify(inspection.includedEventIds)) throw new ReferenceError("The packet endpoint's declared canonical event cut does not match the causal cut reconstructed from its exact preserved selection. No endpoint or order was substituted.");
}
function packetComparison(packet: ComparisonPacket): BasisComparison {
  const record = packet.archive.originalDecisions[0];
  if (record === undefined || record.decision.id !== packet.decisionId) throw new ReferenceError("The packet must select its one exact archived decision; cross-decision endpoint references are invalid.");
  const comparison = compareDecisionBasisRecords(packet.archive, packet.decisionId, selectedId(packet.from), selectedId(packet.to));
  requireMatchingCut(packet.from, comparison.from);
  requireMatchingCut(packet.to, comparison.to);
  const union = new Set([...comparison.from.includedEventIds, ...comparison.to.includedEventIds]);
  const events = decisionBasisEventsFromRecords(packet.archive, packet.decisionId);
  if (events.length !== union.size || events.some((event): boolean => !union.has(event.id))) throw new RangeError("The comparison packet contains records outside its selected endpoint union. Export a focused packet; no unrelated or later records were discarded silently.");
  if (events.some((event): boolean => Date.parse(event.recordedAt) > Date.parse(packet.createdAt))) throw new RangeError("Comparison packet creation cannot predate any included recorded event. Preserve the recorded times and provide a later creation time.");
  return comparison;
}

/** A closed, focused archive contract never changes or relaxes the operational three-decision schemas. */
export const ComparisonPacketSchema = PacketFieldsSchema.superRefine((packet, context): void => {
  if (!ArchiveSchema.safeParse(packet.archive).success) return;
  try {
    packetComparison(packet);
  } catch (error) {
    if (!(error instanceof ReferenceError || error instanceof RangeError)) throw error;
    context.addIssue({ code: "custom", message: error.message });
  }
});

function endpoint(eventId: string, inspection: BasisInspection): ComparisonPacketEndpoint {
  const includedEventIds = [...inspection.includedEventIds];
  return eventId === "latest" ? { selection: "frozen-latest", eventId: null, includedEventIds } : { selection: "recorded-event", eventId, includedEventIds };
}
function focusedArchive(state: ClarificationState, decisionId: string, comparison: BasisComparison): ClarificationHistory {
  const record = state.originalDecisions.find((item): boolean => item.decision.id === decisionId);
  if (record === undefined) throw new ReferenceError("The comparison packet requires its selected original decision.");
  const included = new Set([...comparison.from.includedEventIds, ...comparison.to.includedEventIds]);
  const events = decisionBasisEventsFromRecords(state, decisionId);
  const members = new Set(events.filter((event): boolean => included.has(event.id)).flatMap((event): readonly string[] => event.memberIds));
  return {
    id: state.id, source: state.source, originalDecisions: [record],
    sources: state.sources.filter((event): boolean => included.has(event.id)),
    reviews: state.reviews.filter((item): boolean => item.decisionId === decisionId && members.has(item.id)),
    outcomes: state.outcomes.filter((item): boolean => item.decisionId === decisionId && included.has(item.id)),
    replacements: state.replacements.filter((item): boolean => item.decisionId === decisionId && included.has(item.id)),
  };
}
function requirePacketSize(content: string): void {
  if (new TextEncoder().encode(content).byteLength > MAX_COMPARISON_PACKET_BYTES) throw new RangeError("Comparison packet exceeds the 1 MiB inspection limit. Choose an earlier endpoint with fewer required preceding records; no history or packet was truncated or changed.");
}

/** Validate the full original comparison before trimming: omitted later records cannot conceal an ambiguous export endpoint. */
export function createComparisonPacket(input: ClarificationState, decisionId: string, fromEventId: string, toEventId: string, createdAt: string): ComparisonPacket {
  const state = ClarificationStateSchema.parse(input);
  const comparison = compareDecisionBases(state, decisionId, fromEventId, toEventId);
  const packet = ComparisonPacketSchema.parse({
    packetKind: "decision-basis-comparison", packetSchemaVersion: 1, createdAt,
    demonstration: DEMONSTRATION_NOTICE, decisionId,
    from: endpoint(fromEventId, comparison.from), to: endpoint(toEventId, comparison.to),
    archive: focusedArchive(state, decisionId, comparison),
  });
  requirePacketSize(JSON.stringify(packet, null, 2));
  return packet;
}

/** Inspect a bounded file in memory; derive facts from its preserved records without storage, network access or history restoration. */
export function inspectComparisonPacket(content: string): ComparisonPacketInspection {
  requirePacketSize(content);
  const packet = ComparisonPacketSchema.parse(JSON.parse(content));
  return { packet, archive: packet.archive, comparison: packetComparison(packet) };
}
