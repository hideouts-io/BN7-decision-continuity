import { z } from "zod";
import { ContinuityStateSchema } from "./continuity-model.ts";
import type { ContinuityState } from "./continuity-model.ts";
import { continuityHistoryExport } from "./continuity-export.ts";

export const CONTINUITY_STORAGE_PREFIX = "bn7-decision-continuity-authored-v4:session:";
export function continuityStorageKey(id: string): string { return `${CONTINUITY_STORAGE_PREFIX}${z.uuid().parse(id)}`; }
export function readContinuityState(storage: Storage, id: string): ContinuityState {
  const raw: string | null = storage.getItem(continuityStorageKey(id));
  if (raw === null) throw new ReferenceError(`Continuity decision ${id} is absent from this browser profile and origin. Restore its export or create a new decision.`);
  const state = ContinuityStateSchema.parse(JSON.parse(raw));
  if (state.id !== id) throw new RangeError("Stored continuity UUID does not match the selected record. Existing bytes remain intact.");
  return state;
}
export function persistContinuityState(storage: Storage, previous: ContinuityState | null, next: ContinuityState): void {
  const validated = ContinuityStateSchema.parse(next);
  const key: string = continuityStorageKey(validated.id);
  const existing: string | null = storage.getItem(key);
  if (previous === null) {
    if (existing !== null) throw new RangeError("This continuity UUID already exists; a new decision cannot replace it.");
  } else {
    if (existing === null || JSON.stringify(readContinuityState(storage, validated.id)) !== JSON.stringify(previous)) throw new RangeError("This continuity decision changed in another tab. Reload before appending; no stale update was saved.");
    if (JSON.stringify([validated.source, validated.originalDecision, validated.assumption]) !== JSON.stringify([previous.source, previous.originalDecision, previous.assumption])
      || JSON.stringify(validated.sources.slice(0, previous.sources.length)) !== JSON.stringify(previous.sources)
      || JSON.stringify(validated.reviews.slice(0, previous.reviews.length)) !== JSON.stringify(previous.reviews)
      || JSON.stringify(validated.outcomes.slice(0, previous.outcomes.length)) !== JSON.stringify(previous.outcomes)) throw new RangeError("Original entities and all recorded captures, reviews and outcomes are immutable. Only new events can be appended.");
  }
  const times: string[] = [...validated.sources.map((event): string => event.recordedAt), ...validated.reviews.map((review): string => review.openedAt), ...validated.outcomes.map((outcome): string => outcome.recordedAt)];
  const latest: string | undefined = times.sort((left: string, right: string): number => Date.parse(left) - Date.parse(right)).at(-1);
  if (latest === undefined) throw new ReferenceError("Continuity history requires a recorded baseline.");
  // Validate the full export size before saving; limits never silently truncate history.
  continuityHistoryExport(validated, latest);
  storage.setItem(key, JSON.stringify(validated));
}
export function listContinuityIds(storage: Storage): readonly string[] {
  const ids: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null) throw new ReferenceError("Browser storage changed while listing continuity decisions. Reload before choosing.");
    if (key.startsWith(CONTINUITY_STORAGE_PREFIX)) ids.push(z.uuid().parse(key.slice(CONTINUITY_STORAGE_PREFIX.length)));
  }
  return ids.sort();
}
