import { StateSchema, initialState } from "./model.ts";
import type { DemoState } from "./model.ts";

export const STORAGE_KEY = "bn7-decision-continuity-demo-v1";

/** Parse and validate local data. Corrupt or incompatible data fails instead of resetting history. */
export function readState(storage: Storage, storageKey: string): DemoState {
  const saved: string | null = storage.getItem(storageKey);
  if (saved === null) return initialState();
  return StateSchema.parse(JSON.parse(saved));
}

/** Persist an already validated local session; storage errors propagate to the interface. */
export function writeState(storage: Storage, storageKey: string, state: DemoState): void {
  storage.setItem(storageKey, JSON.stringify(StateSchema.parse(state)));
}
