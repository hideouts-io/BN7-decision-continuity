import { z } from "zod";
import { UncertaintyStateSchema, requireUncertaintyPrefix, uncertaintyRecordTimes } from "./uncertainty-model.ts";
import type { UncertaintyState } from "./uncertainty-model.ts";
import { uncertaintyHistoryExport } from "./uncertainty-export.ts";

export const UNCERTAINTY_STORAGE_PREFIX = "decision-continuity-uncertainty-v7:session:";
export function uncertaintyStorageKey(id: string): string { return `${UNCERTAINTY_STORAGE_PREFIX}${z.uuid().parse(id)}`; }
export function readUncertaintyState(storage: Storage, id: string): UncertaintyState {
  const raw: string | null = storage.getItem(uncertaintyStorageKey(id));
  if (raw === null) throw new ReferenceError(`Uncertainty continuation ${id} is absent from this browser profile and origin. Restore its complete export or explicitly enroll a v6 rehearsal.`);
  const state = UncertaintyStateSchema.parse(JSON.parse(raw));
  if (state.id !== id) throw new RangeError("Stored continuation UUID differs from the selected workspace. Existing bytes remain intact.");
  return state;
}
export function persistUncertaintyState(storage: Storage, previous: UncertaintyState | null, next: UncertaintyState): void {
  const validated = UncertaintyStateSchema.parse(next), key: string = uncertaintyStorageKey(validated.id), existing: string | null = storage.getItem(key);
  if (previous === null) {
    if (existing !== null) throw new RangeError("This continuation UUID already exists. Creation cannot replace recorded history.");
  } else {
    if (existing === null || JSON.stringify(readUncertaintyState(storage, validated.id)) !== JSON.stringify(previous)) throw new RangeError("This continuation changed in another tab. Reload before appending; no stale update was saved.");
    requireUncertaintyPrefix(previous, validated);
  }
  const latest: string | undefined = [...uncertaintyRecordTimes(validated)].sort((left: string, right: string): number => Date.parse(left) - Date.parse(right)).at(-1);
  if (latest === undefined) throw new ReferenceError("An uncertainty continuation requires its recorded enrollment and baseline.");
  uncertaintyHistoryExport(validated, latest);
  storage.setItem(key, JSON.stringify(validated));
}
export function listUncertaintySessionIds(storage: Storage): readonly string[] {
  const ids: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key: string | null = storage.key(index);
    if (key === null) throw new ReferenceError("Browser storage changed while listing uncertainty continuations. Reload before choosing.");
    if (key.startsWith(UNCERTAINTY_STORAGE_PREFIX)) ids.push(z.uuid().parse(key.slice(UNCERTAINTY_STORAGE_PREFIX.length)));
  }
  return ids.sort();
}
