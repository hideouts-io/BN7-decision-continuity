import { z } from "zod";
import { ClarificationStateSchema } from "./clarification-model.ts";
import type { ClarificationHistory, ClarificationState } from "./clarification-model.ts";
import { decisionBasisEventsFromRecords } from "./basis-events.ts";
import { compareDecisionBases, compareDecisionBasisRecords } from "./basis-comparison.ts";
import type { BasisComparison } from "./basis-comparison.ts";
import { DEMONSTRATION_NOTICE } from "./history-contract.ts";
import { ComparisonPacketArchiveSchema, ComparisonPacketEndpointSchema, comparisonPacketEndpoint, focusedComparisonArchive, requireComparisonPacketSize, requireMatchingPacketCut, selectedPacketEventId } from "./comparison-packet-contract.ts";
import { UncertaintyComparisonPacketSchema, inspectUncertaintyComparisonPacketRecords } from "./uncertainty-comparison-packet.ts";
import type { UncertaintyComparisonPacket } from "./uncertainty-comparison-packet.ts";
export { MAX_COMPARISON_PACKET_BYTES, COMPARISON_PACKET_NOTICE } from "./comparison-packet-contract.ts";
export type { ComparisonPacketEndpoint } from "./comparison-packet-contract.ts";

const PacketFieldsSchema = z.strictObject({
  packetKind: z.literal("decision-basis-comparison"), packetSchemaVersion: z.literal(1),
  createdAt: z.iso.datetime(), demonstration: z.literal(DEMONSTRATION_NOTICE),
  decisionId: z.uuid(), from: ComparisonPacketEndpointSchema, to: ComparisonPacketEndpointSchema, archive: ComparisonPacketArchiveSchema,
});
export type ComparisonPacket = z.infer<typeof PacketFieldsSchema>;
export type ComparisonPacketInspection = Readonly<{ packet: ComparisonPacket | UncertaintyComparisonPacket; archive: ClarificationHistory; comparison: BasisComparison }>;

function packetComparison(packet: ComparisonPacket): BasisComparison {
  const record = packet.archive.originalDecisions[0];
  if (record === undefined || record.decision.id !== packet.decisionId) throw new ReferenceError("The packet must select its one exact archived decision; cross-decision endpoint references are invalid.");
  const comparison = compareDecisionBasisRecords(packet.archive, packet.decisionId, selectedPacketEventId(packet.from), selectedPacketEventId(packet.to));
  requireMatchingPacketCut(packet.from, comparison.from);
  requireMatchingPacketCut(packet.to, comparison.to);
  const union = new Set([...comparison.from.includedEventIds, ...comparison.to.includedEventIds]);
  const events = decisionBasisEventsFromRecords(packet.archive, packet.decisionId);
  if (events.length !== union.size || events.some((event): boolean => !union.has(event.id))) throw new RangeError("The comparison packet contains records outside its selected endpoint union. Export a focused packet; no unrelated or later records were discarded silently.");
  if (events.some((event): boolean => Date.parse(event.recordedAt) > Date.parse(packet.createdAt))) throw new RangeError("Comparison packet creation cannot predate any included recorded event. Preserve the recorded times and provide a later creation time.");
  return comparison;
}

/** A closed, focused archive contract never changes or relaxes the operational three-decision schemas. */
export const ComparisonPacketSchema = PacketFieldsSchema.superRefine((packet, context): void => {
  if (!ComparisonPacketArchiveSchema.safeParse(packet.archive).success) return;
  try {
    packetComparison(packet);
  } catch (error) {
    if (!(error instanceof ReferenceError || error instanceof RangeError)) throw error;
    context.addIssue({ code: "custom", message: error.message });
  }
});

const AnyComparisonPacketSchema = z.discriminatedUnion("packetSchemaVersion", [ComparisonPacketSchema, UncertaintyComparisonPacketSchema]);

/** Validate the full original comparison before trimming: omitted later records cannot conceal an ambiguous export endpoint. */
export function createComparisonPacket(input: ClarificationState, decisionId: string, fromEventId: string, toEventId: string, createdAt: string): ComparisonPacket {
  const state = ClarificationStateSchema.parse(input);
  const comparison = compareDecisionBases(state, decisionId, fromEventId, toEventId);
  const packet = ComparisonPacketSchema.parse({
    packetKind: "decision-basis-comparison", packetSchemaVersion: 1, createdAt,
    demonstration: DEMONSTRATION_NOTICE, decisionId,
    from: comparisonPacketEndpoint(fromEventId, comparison.from), to: comparisonPacketEndpoint(toEventId, comparison.to),
    archive: focusedComparisonArchive(state, decisionId, comparison, decisionBasisEventsFromRecords(state, decisionId)),
  });
  requireComparisonPacketSize(JSON.stringify(packet, null, 2));
  return packet;
}

/** Inspect a bounded file in memory; derive facts from its preserved records without storage, network access or history restoration. */
export function inspectComparisonPacket(content: string): ComparisonPacketInspection {
  requireComparisonPacketSize(content);
  const packet = AnyComparisonPacketSchema.parse(JSON.parse(content));
  return { packet, archive: packet.archive, comparison: packet.packetSchemaVersion === 1 ? packetComparison(packet) : inspectUncertaintyComparisonPacketRecords(packet) };
}
