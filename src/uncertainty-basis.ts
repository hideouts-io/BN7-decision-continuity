import { UncertaintyStateSchema } from "./uncertainty-model.ts";
import type { UncertaintyState, UncertaintyJournal, UncertaintyRequirement, UncertaintyResolution } from "./uncertainty-model.ts";
import { decisionBasisEventsFromRecords, MAX_BASIS_EVENTS } from "./basis-events.ts";
import type { BasisEvent } from "./basis-events.ts";
import { decisionBasisAtEvents } from "./decision-basis.ts";
import type { BasisInspection } from "./decision-basis.ts";
import { compareDecisionBasisInspections } from "./basis-comparison.ts";
import type { BasisComparison, BasisChangedFact, BasisReference } from "./basis-comparison.ts";

export type UncertaintyBasisRequirement = Readonly<{
  requirement: UncertaintyRequirement; resolutions: readonly UncertaintyResolution[];
  status: "unresolved" | "insufficient" | "satisfied";
}>;
export type UncertaintyBasisContext = Readonly<{
  continuationId: string; enrolledAt: string; requirements: readonly UncertaintyBasisRequirement[];
}>;
export type UncertaintyBasisInspection = BasisInspection & Readonly<{ clarificationContext: UncertaintyBasisContext }>;

function previousId(ids: readonly string[], index: number): readonly string[] {
  const previous = ids[index - 1];
  return previous === undefined ? [] : [previous];
}

/** References and preserved array appends order journal events; no response implies a later approval. */
export function uncertaintyBasisEventsFromRecords(state: UncertaintyJournal, decisionId: string): readonly BasisEvent[] {
  const history = decisionBasisEventsFromRecords(state.history, decisionId);
  const requirements = state.requirements.filter((item): boolean => item.decisionId === decisionId);
  const requirementIds = new Set(requirements.map((item): string => item.id));
  const resolutions = state.resolutions.filter((item): boolean => requirementIds.has(item.requirementId));
  const events: readonly BasisEvent[] = [
    ...history,
    ...requirements.map((item, index: number): BasisEvent => ({ id: item.id, kind: "requirement", recordedAt: item.recordedAt, label: "Evidence requirement · accountable question", memberIds: [item.id], predecessorIds: [...new Set([item.reviewId, item.deferredOutcomeId, item.sourceEventId, ...previousId(requirements.map((record): string => record.id), index)])] })),
    ...resolutions.map((item, index: number): BasisEvent => {
      const prior = resolutions.slice(0, index).filter((record): boolean => record.requirementId === item.requirementId).at(-1);
      return { id: item.id, kind: "resolution", recordedAt: item.recordedAt, label: `Evidence response · ${item.result}`, memberIds: [item.id], predecessorIds: [...new Set([item.requirementId, item.sourceEventId, ...(prior === undefined ? [] : [prior.id]), ...previousId(resolutions.map((record): string => record.id), index)])] };
    }),
  ];
  if (events.length > MAX_BASIS_EVENTS) throw new RangeError(`Historical inspection supports at most ${MAX_BASIS_EVENTS} combined decision and clarification events; this history has ${events.length}. No history was truncated or changed.`);
  const canonical = events.map((event): BasisEvent => ({ ...event, predecessorIds: event.predecessorIds.map((id): string => {
    const predecessor = events.find((record): boolean => record.memberIds.includes(id));
    if (predecessor === undefined) throw new ReferenceError(`Clarification dependency ${id} has no exact event in this selected decision.`);
    if (predecessor.id === event.id || Date.parse(predecessor.recordedAt) > Date.parse(event.recordedAt)) throw new RangeError(`Clarification order contradicts dependency ${predecessor.id} → ${event.id}. Existing history remains unchanged.`);
    return predecessor.id;
  }) }));
  return canonical.toSorted((left, right): number => Date.parse(left.recordedAt) - Date.parse(right.recordedAt));
}

export function uncertaintyBasisEvents(input: UncertaintyState, decisionId: string): readonly BasisEvent[] {
  return uncertaintyBasisEventsFromRecords(UncertaintyStateSchema.parse(input), decisionId);
}

/** Enrollment is envelope metadata, not an invented event proving the journal existed at an earlier cut. */
function clarificationContext(state: UncertaintyJournal, decisionId: string, inspection: BasisInspection): UncertaintyBasisContext {
  const included = new Set(inspection.includedEventIds);
  const requirements = state.requirements.filter((item): boolean => item.decisionId === decisionId && included.has(item.id)).map((requirement): UncertaintyBasisRequirement => {
    const resolutions = state.resolutions.filter((item): boolean => item.requirementId === requirement.id && included.has(item.id));
    return { requirement, resolutions, status: resolutions.at(-1)?.result ?? "unresolved" };
  });
  return { continuationId: state.id, enrolledAt: state.createdAt, requirements };
}

export function uncertaintyBasisAtRecords(state: UncertaintyJournal, decisionId: string, eventId: string): UncertaintyBasisInspection {
  const inspection = decisionBasisAtEvents(state.history, decisionId, eventId, uncertaintyBasisEventsFromRecords(state, decisionId));
  return { ...inspection, clarificationContext: clarificationContext(state, decisionId, inspection) };
}

export function uncertaintyBasisAt(input: UncertaintyState, decisionId: string, eventId: string): UncertaintyBasisInspection {
  return uncertaintyBasisAtRecords(UncertaintyStateSchema.parse(input), decisionId, eventId);
}

function requirementReferences(context: UncertaintyBasisRequirement): readonly BasisReference[] {
  const item = context.requirement;
  return [{ kind: "requirement", id: item.id }, { kind: "decision", id: item.decisionId }, { kind: "assumption", id: item.assumptionId }, { kind: "review", id: item.reviewId }, { kind: "outcome", id: item.deferredOutcomeId }, { kind: "source-event", id: item.sourceEventId }, { kind: "evidence", id: item.evidenceId }];
}
function responseReferences(item: UncertaintyResolution): readonly BasisReference[] {
  return [{ kind: "resolution", id: item.id }, { kind: "requirement", id: item.requirementId }, { kind: "source-event", id: item.sourceEventId }, { kind: "evidence", id: item.evidenceId }];
}
function currentStatusReferences(context: UncertaintyBasisRequirement): readonly BasisReference[] {
  const response = context.resolutions.at(-1);
  const references = [...requirementReferences(context), ...(response === undefined ? [] : responseReferences(response))];
  return references.filter((item, index: number): boolean => references.findIndex((candidate): boolean => candidate.kind === item.kind && candidate.id === item.id) === index);
}
function contextChanges(from: UncertaintyBasisContext, to: UncertaintyBasisContext): readonly BasisChangedFact[] {
  const ids = [...new Set([...from.requirements.map((item): string => item.requirement.id), ...to.requirements.map((item): string => item.requirement.id)])];
  return ids.flatMap((id): readonly BasisChangedFact[] => {
    const before = from.requirements.find((item): boolean => item.requirement.id === id), after = to.requirements.find((item): boolean => item.requirement.id === id);
    const fromReferences = before === undefined ? [] : currentStatusReferences(before), toReferences = after === undefined ? [] : currentStatusReferences(after);
    const stateChange: readonly BasisChangedFact[] = before?.status === after?.status ? [] : [{ key: `clarification-${id}-status`, label: "Recorded evidence requirement state · independent of approval", fromValue: before?.status ?? "Requirement not recorded in this perspective", toValue: after?.status ?? "Requirement not recorded in this perspective", fromReferences, toReferences }];
    const previous = before?.resolutions ?? [], next = after?.resolutions ?? [];
    if (JSON.stringify(previous.map((item): string => item.id)) === JSON.stringify(next.map((item): string => item.id))) return stateChange;
    return [...stateChange, { key: `clarification-${id}-responses`, label: "Recorded accountable evidence responses", fromValue: previous.map((item): string => `${item.id} · ${item.result}`).join("; ") || "No response recorded", toValue: next.map((item): string => `${item.id} · ${item.result}`).join("; ") || "No response recorded", fromReferences: previous.flatMap(responseReferences), toReferences: next.flatMap(responseReferences) }];
  });
}

/** Compare journal cuts and preserved decision bases; satisfaction never changes a decision or closes a review. */
export function compareUncertaintyDecisionBasisRecords(state: UncertaintyJournal, decisionId: string, fromEventId: string, toEventId: string): BasisComparison {
  const from = uncertaintyBasisAtRecords(state, decisionId, fromEventId), to = uncertaintyBasisAtRecords(state, decisionId, toEventId);
  const comparison = compareDecisionBasisInspections(state.history, from, to);
  const clarificationContexts = { from: from.clarificationContext, to: to.clarificationContext };
  return { ...comparison, clarificationContexts, clarificationChanges: contextChanges(clarificationContexts.from, clarificationContexts.to) };
}

export function compareUncertaintyDecisionBases(input: UncertaintyState, decisionId: string, fromEventId: string, toEventId: string): BasisComparison {
  return compareUncertaintyDecisionBasisRecords(UncertaintyStateSchema.parse(input), decisionId, fromEventId, toEventId);
}
