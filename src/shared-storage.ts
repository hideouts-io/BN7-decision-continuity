import { z } from "zod";
import { SharedStateSchema } from "./shared-model.ts";
import type { SharedState } from "./shared-model.ts";
import { sharedHistoryExport } from "./shared-export.ts";

export const SHARED_STORAGE_PREFIX = "bn7-decision-continuity-shared-v5:session:";
export function sharedStorageKey(id: string): string { return `${SHARED_STORAGE_PREFIX}${z.uuid().parse(id)}`; }
export function readSharedState(storage: Storage, id: string): SharedState {
  const raw: string | null = storage.getItem(sharedStorageKey(id));
  if (raw === null) throw new ReferenceError(`Shared-source workspace ${id} is absent from this browser profile and origin. Restore its export or create a new rehearsal.`);
  const state = SharedStateSchema.parse(JSON.parse(raw));
  if (state.id !== id) throw new RangeError("Stored shared-source UUID differs from the selected workspace. Existing bytes remain intact.");
  return state;
}
export function persistSharedState(storage: Storage, previous: SharedState | null, next: SharedState): void {
  const validated = SharedStateSchema.parse(next), key: string = sharedStorageKey(validated.id), existing: string | null = storage.getItem(key);
  if (previous === null) {
    if (existing !== null) throw new RangeError("This workspace UUID already exists. Creation cannot replace recorded history.");
  } else {
    if (existing === null || JSON.stringify(readSharedState(storage, validated.id)) !== JSON.stringify(previous)) throw new RangeError("This workspace changed in another tab. Reload before appending; no stale update was saved.");
    if (JSON.stringify([validated.source, validated.originalDecisions]) !== JSON.stringify([previous.source, previous.originalDecisions])
      || JSON.stringify(validated.sources.slice(0, previous.sources.length)) !== JSON.stringify(previous.sources)
      || JSON.stringify(validated.reviews.slice(0, previous.reviews.length)) !== JSON.stringify(previous.reviews)
      || JSON.stringify(validated.outcomes.slice(0, previous.outcomes.length)) !== JSON.stringify(previous.outcomes)) throw new RangeError("Original decisions, assumptions and every recorded capture, review and outcome are immutable. Append new events instead.");
  }
  const times: string[] = [...validated.sources.map((event): string => event.recordedAt), ...validated.reviews.map((review): string => review.openedAt), ...validated.outcomes.map((outcome): string => outcome.recordedAt)];
  const latest: string | undefined = times.sort((left: string, right: string): number => Date.parse(left) - Date.parse(right)).at(-1);
  if (latest === undefined) throw new ReferenceError("Shared history requires a recorded baseline.");
  sharedHistoryExport(validated, latest);
  storage.setItem(key, JSON.stringify(validated));
}
export function listSharedIds(storage: Storage): readonly string[] {
  const ids: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key: string | null = storage.key(index);
    if (key === null) throw new ReferenceError("Browser storage changed while listing shared-source workspaces. Reload before choosing.");
    if (key.startsWith(SHARED_STORAGE_PREFIX)) ids.push(z.uuid().parse(key.slice(SHARED_STORAGE_PREFIX.length)));
  }
  return ids.sort();
}
