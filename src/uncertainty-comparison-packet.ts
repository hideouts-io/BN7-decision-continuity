import { z } from "zod";
import { UncertaintyStateSchema, RequirementSchema, ResolutionSchema, validateUncertaintyJournal } from "./uncertainty-model.ts";
import type { UncertaintyState, UncertaintyJournal } from "./uncertainty-model.ts";
import { uncertaintyBasisEventsFromRecords, compareUncertaintyDecisionBases, compareUncertaintyDecisionBasisRecords } from "./uncertainty-basis.ts";
import { ComparisonPacketArchiveSchema, ComparisonPacketEndpointSchema, comparisonPacketEndpoint, focusedComparisonArchive, requireComparisonPacketSize, requireMatchingPacketCut, selectedPacketEventId } from "./comparison-packet-contract.ts";
import { MAX_BASIS_EVENTS } from "./basis-events.ts";
import type { BasisComparison } from "./basis-comparison.ts";
import { DEMONSTRATION_NOTICE } from "./history-contract.ts";

const ClarificationSchema = z.strictObject({
  id: z.uuid(), createdAt: z.iso.datetime(),
  requirements: z.array(RequirementSchema.strict()).max(MAX_BASIS_EVENTS),
  resolutions: z.array(ResolutionSchema.strict()).max(MAX_BASIS_EVENTS),
});
const PacketFieldsSchema = z.strictObject({
  packetKind: z.literal("decision-basis-comparison"), packetSchemaVersion: z.literal(2),
  createdAt: z.iso.datetime(), demonstration: z.literal(DEMONSTRATION_NOTICE), decisionId: z.uuid(),
  from: ComparisonPacketEndpointSchema, to: ComparisonPacketEndpointSchema,
  archive: ComparisonPacketArchiveSchema, clarification: ClarificationSchema,
});
export type UncertaintyComparisonPacket = z.infer<typeof PacketFieldsSchema>;

function packetJournal(packet: UncertaintyComparisonPacket): UncertaintyJournal {
  return { ...packet.clarification, history: packet.archive };
}

/** Reconstruct only the packet's exact declared cuts; focused journal records cannot restore a workspace. */
export function inspectUncertaintyComparisonPacketRecords(packet: UncertaintyComparisonPacket): BasisComparison {
  const record = packet.archive.originalDecisions[0];
  if (record === undefined || record.decision.id !== packet.decisionId) throw new ReferenceError("The clarification packet must select its one exact archived decision; cross-decision endpoint references are invalid.");
  const journal = packetJournal(packet);
  const comparison = compareUncertaintyDecisionBasisRecords(journal, packet.decisionId, selectedPacketEventId(packet.from), selectedPacketEventId(packet.to));
  requireMatchingPacketCut(packet.from, comparison.from);
  requireMatchingPacketCut(packet.to, comparison.to);
  const included = new Set([...comparison.from.includedEventIds, ...comparison.to.includedEventIds]);
  const events = uncertaintyBasisEventsFromRecords(journal, packet.decisionId);
  if (events.length !== included.size || events.some((event): boolean => !included.has(event.id))) throw new RangeError("The clarification packet contains records outside its selected endpoint union. Export a focused packet; no journal or history record was discarded silently.");
  if (packet.clarification.requirements.some((item): boolean => item.decisionId !== packet.decisionId)) throw new RangeError("A clarification packet can include requirements for its one selected decision only.");
  if (Date.parse(packet.clarification.createdAt) > Date.parse(packet.createdAt) || events.some((event): boolean => Date.parse(event.recordedAt) > Date.parse(packet.createdAt))) throw new RangeError("Clarification packet creation cannot predate enrollment or any included recorded event. Preserve the exact times and provide a later creation time.");
  return comparison;
}

/** Packet v2 preserves v7 journal semantics in a separately closed one-decision read-only archive. */
export const UncertaintyComparisonPacketSchema = PacketFieldsSchema.superRefine((packet, context): void => {
  if (!ComparisonPacketArchiveSchema.safeParse(packet.archive).success) return;
  validateUncertaintyJournal(packetJournal(packet), context);
  try {
    inspectUncertaintyComparisonPacketRecords(packet);
  } catch (error) {
    if (!(error instanceof ReferenceError || error instanceof RangeError)) throw error;
    context.addIssue({ code: "custom", message: error.message });
  }
});

/** Validate the full continuation before trimming, preserving ambiguous-cut failures and every operational byte. */
export function createUncertaintyComparisonPacket(input: UncertaintyState, decisionId: string, fromEventId: string, toEventId: string, createdAt: string): UncertaintyComparisonPacket {
  const state = UncertaintyStateSchema.parse(input);
  const comparison = compareUncertaintyDecisionBases(state, decisionId, fromEventId, toEventId);
  const events = uncertaintyBasisEventsFromRecords(state, decisionId);
  const included = new Set([...comparison.from.includedEventIds, ...comparison.to.includedEventIds]);
  const packet = UncertaintyComparisonPacketSchema.parse({
    packetKind: "decision-basis-comparison", packetSchemaVersion: 2, createdAt,
    demonstration: DEMONSTRATION_NOTICE, decisionId,
    from: comparisonPacketEndpoint(fromEventId, comparison.from), to: comparisonPacketEndpoint(toEventId, comparison.to),
    archive: focusedComparisonArchive(state.history, decisionId, comparison, events),
    clarification: { id: state.id, createdAt: state.createdAt, requirements: state.requirements.filter((item): boolean => item.decisionId === decisionId && included.has(item.id)), resolutions: state.resolutions.filter((item): boolean => included.has(item.id)) },
  });
  requireComparisonPacketSize(JSON.stringify(packet, null, 2));
  return packet;
}
