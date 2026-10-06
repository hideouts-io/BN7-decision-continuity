import { z } from "zod";
import { ClarificationStateSchema } from "./clarification-model.ts";
import type { ClarificationState } from "./clarification-model.ts";
import { clarificationHistoryExport } from "./clarification-export.ts";

export const CLARIFICATION_STORAGE_PREFIX = "bn7-decision-continuity-clarification-v6:session:";
export function clarificationStorageKey(id: string): string { return `${CLARIFICATION_STORAGE_PREFIX}${z.uuid().parse(id)}`; }
export function readClarificationState(storage: Storage, id: string): ClarificationState {
  const raw: string | null = storage.getItem(clarificationStorageKey(id));
  if (raw === null) throw new ReferenceError(`Shared-source workspace ${id} is absent from this browser profile and origin. Restore its export or create a new rehearsal.`);
  const state = ClarificationStateSchema.parse(JSON.parse(raw));
  if (state.id !== id) throw new RangeError("Stored shared-source UUID differs from the selected workspace. Existing bytes remain intact.");
  return state;
}
export function persistClarificationState(storage: Storage, previous: ClarificationState | null, next: ClarificationState): void {
  const validated = ClarificationStateSchema.parse(next), key: string = clarificationStorageKey(validated.id), existing: string | null = storage.getItem(key);
  if (previous === null) {
    if (existing !== null) throw new RangeError("This workspace UUID already exists. Creation cannot replace recorded history.");
  } else {
    if (existing === null || JSON.stringify(readClarificationState(storage, validated.id)) !== JSON.stringify(previous)) throw new RangeError("This workspace changed in another tab. Reload before appending; no stale update was saved.");
    if (JSON.stringify([validated.source, validated.originalDecisions]) !== JSON.stringify([previous.source, previous.originalDecisions])
      || JSON.stringify(validated.sources.slice(0, previous.sources.length)) !== JSON.stringify(previous.sources)
      || JSON.stringify(validated.reviews.slice(0, previous.reviews.length)) !== JSON.stringify(previous.reviews)
      || JSON.stringify(validated.outcomes.slice(0, previous.outcomes.length)) !== JSON.stringify(previous.outcomes)
      || JSON.stringify(validated.replacements.slice(0, previous.replacements.length)) !== JSON.stringify(previous.replacements)) throw new RangeError("Original decisions, assumptions and every recorded capture, review, outcome and replacement are immutable. Append new events instead.");
  }
  const times: string[] = [...validated.sources.map((event): string => event.recordedAt), ...validated.reviews.map((review): string => review.openedAt), ...validated.outcomes.map((outcome): string => outcome.recordedAt), ...validated.replacements.map((event): string => event.recordedAt)];
  const latest: string | undefined = times.sort((left: string, right: string): number => Date.parse(left) - Date.parse(right)).at(-1);
  if (latest === undefined) throw new ReferenceError("Shared history requires a recorded baseline.");
  clarificationHistoryExport(validated, latest);
  storage.setItem(key, JSON.stringify(validated));
}
export function listClarificationIds(storage: Storage): readonly string[] {
  const ids: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key: string | null = storage.key(index);
    if (key === null) throw new ReferenceError("Browser storage changed while listing shared-source workspaces. Reload before choosing.");
    if (key.startsWith(CLARIFICATION_STORAGE_PREFIX)) ids.push(z.uuid().parse(key.slice(CLARIFICATION_STORAGE_PREFIX.length)));
  }
  return ids.sort();
}
