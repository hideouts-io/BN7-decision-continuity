import { eventAncestors, MAX_BASIS_EVENTS } from "./basis-events.ts";
import type { BasisEvent } from "./basis-events.ts";

export type BasisNavigatorEndpoint = Readonly<{
  requestedId: string; canonicalEventId: string | null; status: "available" | "unavailable";
  includedEventIds: readonly string[]; ambiguousWith: readonly string[]; message: string;
}>;
export type BasisNavigatorNode = Readonly<{
  event: BasisEvent; ambiguousWith: readonly string[];
  fromIncluded: boolean; toIncluded: boolean; fromSelected: boolean; toSelected: boolean;
}>;
export type BasisNavigatorGroup = Readonly<{
  recordedAt: string; timestamps: readonly string[]; nodes: readonly BasisNavigatorNode[];
}>;
export type BasisNavigator = Readonly<{
  groups: readonly BasisNavigatorGroup[]; from: BasisNavigatorEndpoint; to: BasisNavigatorEndpoint;
}>;

/** Entry points validate event fields; this projection additionally rejects graph contradictions without repair. */
function validateGraph(events: readonly BasisEvent[]): void {
  if (events.length === 0) throw new RangeError("The historical navigator requires at least one preserved event. No recorded perspective was substituted.");
  if (events.length > MAX_BASIS_EVENTS) throw new RangeError(`The historical navigator supports at most ${MAX_BASIS_EVENTS} combined events; this graph has ${events.length}. No events were truncated or changed.`);
  const ids = events.map((event): string => event.id), members = events.flatMap((event): readonly string[] => event.memberIds);
  if (new Set(ids).size !== ids.length || new Set(members).size !== members.length) throw new ReferenceError("Historical navigator event UUIDs and atomic member aliases must be unique across the graph. No conflicting record was selected.");
  for (const event of events) {
    if (!Number.isFinite(Date.parse(event.recordedAt))) throw new RangeError(`Historical navigator event ${event.id} has an invalid recorded timestamp. Preserve the original record and inspect its validation error.`);
    if (!event.memberIds.includes(event.id)) throw new ReferenceError(`Historical navigator event ${event.id} does not include its canonical UUID among its atomic members.`);
    if (new Set(event.predecessorIds).size !== event.predecessorIds.length) throw new ReferenceError(`Historical navigator event ${event.id} repeats a predecessor UUID. No duplicate dependency was removed silently.`);
    for (const id of event.predecessorIds) {
      const predecessor = events.find((record): boolean => record.id === id);
      if (predecessor === undefined) throw new ReferenceError(`Historical navigator dependency ${id} has no canonical recorded event in this graph.`);
      if (predecessor.id === event.id) throw new RangeError(`Historical navigator dependencies contain a self-cycle through ${event.id}. No event order was invented.`);
      if (Date.parse(predecessor.recordedAt) > Date.parse(event.recordedAt)) throw new RangeError(`Historical navigator order contradicts dependency ${predecessor.id} → ${event.id}. Existing history remains unchanged.`);
    }
  }
}

function ambiguousPeers(events: readonly BasisEvent[], ancestors: ReadonlyMap<string, ReadonlySet<string>>, selected: BasisEvent): readonly string[] {
  const prior = ancestors.get(selected.id);
  if (prior === undefined) throw new ReferenceError(`Historical navigator event ${selected.id} requires its validated dependency closure.`);
  const time = Date.parse(selected.recordedAt);
  return events.filter((event): boolean => event.id !== selected.id && Date.parse(event.recordedAt) === time && !prior.has(event.id) && !ancestors.get(event.id)?.has(selected.id)).map((event): string => event.id);
}

/** Match the inspector's exact cut; an unavailable native selection is retained, never replaced by Latest. */
function endpoint(events: readonly BasisEvent[], ancestors: ReadonlyMap<string, ReadonlySet<string>>, requestedId: string): BasisNavigatorEndpoint {
  if (requestedId === "latest") return { requestedId, canonicalEventId: null, status: "available", includedEventIds: events.map((event): string => event.id), ambiguousWith: [], message: "Latest recorded state · all events in this validated graph. It does not refresh an external source." };
  const selected = events.find((event): boolean => event.memberIds.includes(requestedId));
  if (selected === undefined) return { requestedId, canonicalEventId: null, status: "unavailable", includedEventIds: [], ambiguousWith: [], message: `Requested event ${requestedId} is not present in this decision graph. Its selection was retained; no recorded perspective was substituted.` };
  const ambiguousWith = ambiguousPeers(events, ancestors, selected);
  if (ambiguousWith.length > 0) return { requestedId, canonicalEventId: selected.id, status: "unavailable", includedEventIds: [], ambiguousWith, message: `Historical order is ambiguous: ${selected.id} and ${ambiguousWith.join(", ")} share a recorded time without a causal order. No cut or order was invented.` };
  const prior = ancestors.get(selected.id);
  if (prior === undefined) throw new ReferenceError(`Historical navigator event ${selected.id} requires its validated dependency closure.`);
  const time = Date.parse(selected.recordedAt);
  const includedEventIds = events.filter((event): boolean => event.id === selected.id || Date.parse(event.recordedAt) < time || prior.has(event.id)).map((event): string => event.id);
  return { requestedId, canonicalEventId: selected.id, status: "available", includedEventIds, ambiguousWith: [], message: `Immediately after ${selected.label} · canonical event ${selected.id}. Atomic member aliases identify this same cut.` };
}

/**
 * Project an existing validated causal graph without creating a history or total event order.
 * Timestamp buckets group the same recorded instant while preserving its exact recorded spellings.
 * Nodes inside a bucket retain presentation order only: dependencies and ambiguous peers expose
 * what ordering is established. A reference edge proves a recorded dependency, never approval.
 * Endpoint membership exactly follows earlier recorded times plus the selected event's ancestors.
 */
export function basisNavigator(events: readonly BasisEvent[], fromEventId: string, toEventId: string): BasisNavigator {
  validateGraph(events);
  const ancestors = eventAncestors(events), from = endpoint(events, ancestors, fromEventId), to = endpoint(events, ancestors, toEventId);
  const fromIncluded = new Set(from.includedEventIds), toIncluded = new Set(to.includedEventIds);
  const times = [...new Set(events.map((event): number => Date.parse(event.recordedAt)))].toSorted((left: number, right: number): number => left - right);
  const groups = times.map((time: number): BasisNavigatorGroup => {
    const members = events.filter((event): boolean => Date.parse(event.recordedAt) === time), first = members[0];
    if (first === undefined) throw new ReferenceError("A historical navigator timestamp group requires its preserved event.");
    return {
      recordedAt: first.recordedAt, timestamps: [...new Set(members.map((event): string => event.recordedAt))],
      nodes: members.map((event): BasisNavigatorNode => ({ event, ambiguousWith: ambiguousPeers(events, ancestors, event), fromIncluded: fromIncluded.has(event.id), toIncluded: toIncluded.has(event.id), fromSelected: from.canonicalEventId === event.id, toSelected: to.canonicalEventId === event.id })),
    };
  });
  return { groups, from, to };
}
