import { z } from "zod";
import { ClarificationStateSchema } from "./clarification-model.ts";
import type { ClarificationState } from "./clarification-model.ts";
import { decisionBasisEvents, eventAncestors } from "./basis-events.ts";
import type { BasisEvent } from "./basis-events.ts";
import { sharedBasis, sharedDecision, sharedPendingReview } from "./shared-model.ts";
import type { SharedBasis, SharedDecision, SharedReview } from "./shared-model.ts";

export { decisionBasisEvents } from "./basis-events.ts";
export type { BasisEvent } from "./basis-events.ts";
export type BasisSnapshot = Readonly<{
  record: SharedDecision; basis: SharedBasis | null; support: ClarificationState["sources"][number] | null;
  knownSource: ClarificationState["sources"][number]; reviews: readonly SharedReview[];
  outcomes: readonly ClarificationState["outcomes"][number][];
  replacements: readonly ClarificationState["replacements"][number][]; pendingReview: SharedReview | null;
}>;
export type BasisInspection = Readonly<{
  event: BasisEvent | null; historical: BasisSnapshot; latest: BasisSnapshot;
  includedEventIds: readonly string[]; excludedEventIds: readonly string[];
}>;

/** Derive the selected prefix's preserved basis; produce no recalculated historical impact verdict. */
function snapshot(state: ClarificationState, decisionId: string): BasisSnapshot {
  const basis = sharedBasis(state, decisionId), knownSource = state.sources.at(-1);
  if (knownSource === undefined) throw new ReferenceError("A recorded decision perspective requires its original source capture.");
  const support = basis === null ? null : state.sources.find((event): boolean => event.id === basis.sourceEventId);
  if (support === undefined) throw new ReferenceError("The selected decision basis has no available supporting capture.");
  return { record: sharedDecision(state, decisionId), basis, support, knownSource, reviews: state.reviews.filter((review): boolean => review.decisionId === decisionId), outcomes: state.outcomes.filter((outcome): boolean => outcome.decisionId === decisionId), replacements: state.replacements.filter((event): boolean => event.decisionId === decisionId), pendingReview: sharedPendingReview(state, decisionId) };
}

/** The view is immediately after the event. A same-time incomparable event has no recorded before/after proof. */
export function decisionBasisAt(input: ClarificationState, decisionId: string, eventId: string): BasisInspection {
  const state = ClarificationStateSchema.parse(input), events = decisionBasisEvents(state, decisionId);
  const ancestors = eventAncestors(events);
  const latest = snapshot(state, decisionId);
  if (eventId === "latest") return { event: null, historical: latest, latest, includedEventIds: events.map((event): string => event.id), excludedEventIds: [] };
  const selectedId = z.uuid().parse(eventId);
  const selected = events.find((event): boolean => event.memberIds.includes(selectedId));
  if (selected === undefined) throw new ReferenceError(`Event ${selectedId} does not belong to the selected decision's recorded perspective.`);
  const prior = ancestors.get(selected.id);
  if (prior === undefined) throw new ReferenceError("The selected event requires its validated dependency closure.");
  const time = Date.parse(selected.recordedAt);
  const ambiguous = events.filter((event): boolean => event.id !== selected.id && Date.parse(event.recordedAt) === time && !prior.has(event.id) && !ancestors.get(event.id)?.has(selected.id));
  if (ambiguous.length > 0) throw new RangeError(`Historical order is ambiguous: ${selected.id} and ${ambiguous.map((event): string => event.id).join(", ")} share a recorded time without a causal order. Select another event or Latest recorded state; no order or history was invented.`);
  const included = new Set(events.filter((event): boolean => event.id === selected.id || Date.parse(event.recordedAt) < time || prior.has(event.id)).map((event): string => event.id));
  const prefix: ClarificationState = {
    ...state,
    sources: state.sources.filter((event): boolean => included.has(event.id)),
    reviews: state.reviews.filter((review): boolean => events.some((event): boolean => included.has(event.id) && event.memberIds.includes(review.id))),
    outcomes: state.outcomes.filter((outcome): boolean => included.has(outcome.id)),
    replacements: state.replacements.filter((event): boolean => included.has(event.id)),
  };
  return { event: selected, historical: snapshot(prefix, decisionId), latest, includedEventIds: events.filter((event): boolean => included.has(event.id)).map((event): string => event.id), excludedEventIds: events.filter((event): boolean => !included.has(event.id)).map((event): string => event.id) };
}
