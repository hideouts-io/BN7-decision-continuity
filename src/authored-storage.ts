import { z } from "zod";
import { AuthoredStateSchema } from "./authored-model.ts";
import type { AuthoredState } from "./authored-model.ts";

export const AUTHORED_STORAGE_PREFIX = "bn7-decision-continuity-authored-v3:session:";
export function authoredStorageKey(id: string): string { return `${AUTHORED_STORAGE_PREFIX}${z.uuid().parse(id)}`; }

export function readAuthoredState(storage: Storage, id: string): AuthoredState {
  const content: string | null = storage.getItem(authoredStorageKey(id));
  if (content === null) throw new ReferenceError(`Decision ${id} is absent from this browser profile and origin. Restore its export or create a new synthetic decision.`);
  const state: AuthoredState = AuthoredStateSchema.parse(JSON.parse(content));
  if (state.id !== id) throw new RangeError("The stored decision does not match the selected session UUID. Existing bytes were preserved.");
  return state;
}

/** Preserve original entities and event prefixes, and reject stale tabs before a write. */
export function persistAuthoredState(storage: Storage, previous: AuthoredState | null, next: AuthoredState): void {
  const validated: AuthoredState = AuthoredStateSchema.parse(next);
  const key: string = authoredStorageKey(validated.id);
  const existing: string | null = storage.getItem(key);
  if (previous === null) {
    if (existing !== null) throw new RangeError("This decision UUID already exists. A new decision cannot replace history.");
  } else {
    if (existing === null || JSON.stringify(readAuthoredState(storage, validated.id)) !== JSON.stringify(previous)) throw new RangeError("This decision changed in another tab. Reload before adding history; no stale update was saved.");
    if (JSON.stringify([validated.originalDecision, validated.assumption, validated.source]) !== JSON.stringify([previous.originalDecision, previous.assumption, previous.source])
      || JSON.stringify(validated.sources.slice(0, previous.sources.length)) !== JSON.stringify(previous.sources)
      || JSON.stringify(validated.outcomes.slice(0, previous.outcomes.length)) !== JSON.stringify(previous.outcomes)
      || (previous.review !== null && JSON.stringify(validated.review) !== JSON.stringify(previous.review))) {
      throw new RangeError("Original records, review snapshots and existing history are immutable. Only new events may be appended.");
    }
  }
  storage.setItem(key, JSON.stringify(validated));
}

export function listAuthoredIds(storage: Storage): readonly string[] {
  const ids: string[] = [];
  for (let index: number = 0; index < storage.length; index += 1) {
    const key: string | null = storage.key(index);
    if (key === null) throw new ReferenceError("Browser storage changed while listing decisions. Reload the workspace.");
    if (key.startsWith(AUTHORED_STORAGE_PREFIX)) ids.push(z.uuid().parse(key.slice(AUTHORED_STORAGE_PREFIX.length)));
  }
  return ids.sort();
}
