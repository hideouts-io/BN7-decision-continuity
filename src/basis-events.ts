import { z } from "zod";
import { ClarificationStateSchema } from "./clarification-model.ts";
import type { ClarificationState } from "./clarification-model.ts";
import { sharedDecision } from "./shared-model.ts";

export type BasisEvent = Readonly<{
  id: string; kind: "original" | "capture" | "review" | "outcome" | "replacement";
  recordedAt: string; label: string; memberIds: readonly string[]; predecessorIds: readonly string[];
}>;
type Link = readonly [string, string];
export const MAX_BASIS_EVENTS = 256;

function appendLinks(ids: readonly string[]): readonly Link[] {
  return ids.slice(1).map((id, index: number): Link => {
    const previous = ids[index];
    if (previous === undefined) throw new ReferenceError("Append ordering requires its previous event.");
    return [previous, id];
  });
}
function reviewEventId(state: ClarificationState, id: string): string {
  return state.replacements.find((event): boolean => event.newReviewId === id)?.id ?? id;
}
function requireEvent(events: readonly BasisEvent[], id: string): BasisEvent {
  const event = events.find((item): boolean => item.id === id);
  if (event === undefined) throw new ReferenceError(`Historical dependency ${id} has no recorded event for this decision.`);
  return event;
}

/** References establish causal order; array position orders only members of that same recorded array. */
export function decisionBasisEvents(input: ClarificationState, decisionId: string): readonly BasisEvent[] {
  const state = ClarificationStateSchema.parse(input), record = sharedDecision(state, z.uuid().parse(decisionId));
  const baseline = state.sources[0];
  if (baseline === undefined) throw new ReferenceError("Historical inspection requires the recorded baseline.");
  const reviews = state.reviews.filter((review): boolean => review.decisionId === decisionId);
  const outcomes = state.outcomes.filter((outcome): boolean => outcome.decisionId === decisionId);
  const replacements = state.replacements.filter((event): boolean => event.decisionId === decisionId);
  const events: readonly BasisEvent[] = [
    ...state.sources.map((event, index: number): BasisEvent => ({ id: event.id, kind: index === 0 ? "original" : "capture", recordedAt: event.recordedAt, label: index === 0 ? "Original scope + baseline" : `Capture ${index + 1} · ${event.evidence.environment}`, memberIds: index === 0 ? [event.id, record.decision.id] : [event.id], predecessorIds: [] })),
    ...reviews.filter((review): boolean => !replacements.some((event): boolean => event.newReviewId === review.id)).map((review): BasisEvent => ({ id: review.id, kind: "review", recordedAt: review.openedAt, label: `Review opened · ${review.trigger}`, memberIds: [review.id], predecessorIds: [] })),
    ...outcomes.map((outcome): BasisEvent => ({ id: outcome.id, kind: "outcome", recordedAt: outcome.recordedAt, label: `Outcome · ${outcome.outcome}`, memberIds: [outcome.id], predecessorIds: [] })),
    ...replacements.map((event): BasisEvent => ({ id: event.id, kind: "replacement", recordedAt: event.recordedAt, label: "Replacement + new review · atomic", memberIds: [event.id, event.newReviewId], predecessorIds: [] })),
  ];
  if (events.length > MAX_BASIS_EVENTS) throw new RangeError(`Historical inspection supports at most ${MAX_BASIS_EVENTS} decision-related events; this history has ${events.length}. No history was truncated or changed.`);
  const links: readonly Link[] = [
    ...appendLinks(state.sources.map((event): string => event.id)),
    ...appendLinks(reviews.map((review): string => reviewEventId(state, review.id))),
    ...appendLinks(outcomes.map((outcome): string => outcome.id)),
    ...appendLinks(replacements.map((event): string => event.id)),
    ...reviews.flatMap((review): readonly Link[] => {
      const id = reviewEventId(state, review.id), targetIndex = state.sources.findIndex((event): boolean => event.id === review.sourceEventId);
      const nextCapture = state.sources[targetIndex + 1];
      const basisOutcome = outcomes.find((outcome): boolean => outcome.revision === review.basis.revision && outcome.outcome !== "defer");
      if (review.basis.revision !== record.decision.revision && basisOutcome === undefined) throw new ReferenceError(`Frozen review ${review.id} has no recorded basis-producing outcome.`);
      return [[review.sourceEventId, id], [review.basis.sourceEventId, id], [basisOutcome?.id ?? baseline.id, id], ...(nextCapture === undefined ? [] : [[id, nextCapture.id] as const])];
    }),
    ...outcomes.map((outcome): Link => [reviewEventId(state, outcome.reviewId), outcome.id]),
    ...replacements.flatMap((event): readonly Link[] => [[reviewEventId(state, event.oldReviewId), event.id], [event.deferredOutcomeId, event.id], [event.newSourceEventId, event.id]]),
  ];
  for (const [parentId, childId] of links) {
    const parent = requireEvent(events, parentId), child = requireEvent(events, childId);
    if (parentId === childId || Date.parse(parent.recordedAt) > Date.parse(child.recordedAt)) throw new RangeError(`Historical order contradicts dependency ${parentId} → ${childId}. Existing history remains unchanged.`);
  }
  return events.map((event): BasisEvent => ({ ...event, predecessorIds: [...new Set(links.filter(([, child]): boolean => child === event.id).map(([parent]): string => parent))] })).toSorted((left, right): number => Date.parse(left.recordedAt) - Date.parse(right.recordedAt));
}

/** Compute dependency closure without imposing a kind-based tie-break on unrelated same-time events. */
export function eventAncestors(events: readonly BasisEvent[]): ReadonlyMap<string, ReadonlySet<string>> {
  const result = new Map<string, ReadonlySet<string>>();
  function visit(id: string, path: ReadonlySet<string>): ReadonlySet<string> {
    if (path.has(id)) throw new RangeError(`Historical event dependencies contain a cycle through ${id}. This view cannot establish recorded order.`);
    const cached = result.get(id);
    if (cached !== undefined) return cached;
    const event = requireEvent(events, id), next = new Set([...path, id]);
    const parents = new Set(event.predecessorIds.flatMap((parent): string[] => [parent, ...visit(parent, next)]));
    result.set(id, parents);
    return parents;
  }
  for (const event of events) visit(event.id, new Set<string>());
  return result;
}
