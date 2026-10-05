import { z } from "zod";
import { initialState, initialVersionState } from "./model.ts";
import type { DemoState } from "./model.ts";
import { STORAGE_KEY, readState, writeState } from "./storage.ts";

export const LEGACY_SESSION_ID = "existing-demo";
export const SESSION_STORAGE_PREFIX: string = `${STORAGE_KEY}:session:`;
export const SessionIdSchema = z.union([z.literal(LEGACY_SESSION_ID), z.uuid()]);
export type SessionId = z.infer<typeof SessionIdSchema>;
export type DemoSession = Readonly<{ id: SessionId; storageKey: string }>;

/** Keep the original storage record in place while mapping new sessions to distinct keys. */
export function sessionForId(id: SessionId): DemoSession {
  const validatedId: SessionId = SessionIdSchema.parse(id);
  return { id: validatedId, storageKey: validatedId === LEGACY_SESSION_ID ? STORAGE_KEY : `${SESSION_STORAGE_PREFIX}${validatedId}` };
}

/** Parse the selected local session without accepting ambiguous or invalid identifiers. */
export function sessionFromUrl(url: URL): DemoSession {
  const values: string[] = url.searchParams.getAll("session");
  if (values.length === 0) return sessionForId(LEGACY_SESSION_ID);
  if (values.length !== 1) throw new RangeError("The URL must contain exactly one session identifier. Remove duplicate session parameters.");
  return sessionForId(SessionIdSchema.parse(values[0]));
}

/** Build a local navigation URL; the identifier does not transfer records to another browser. */
export function urlForSession(url: URL, id: SessionId): URL {
  const next: URL = new URL(url.href);
  next.hash = "";
  if (id === LEGACY_SESSION_ID) next.searchParams.delete("session");
  else next.searchParams.set("session", SessionIdSchema.parse(id));
  return next;
}

/** List namespaced records without rewriting or migrating any saved history. */
export function listSessions(storage: Storage): readonly DemoSession[] {
  const sessions: DemoSession[] = [];
  for (let index: number = 0; index < storage.length; index += 1) {
    const key: string | null = storage.key(index);
    if (key === null) throw new ReferenceError(`Local storage changed while listing session key ${index}. Reload before choosing a session.`);
    if (key.startsWith(SESSION_STORAGE_PREFIX)) {
      sessions.push(sessionForId(z.uuid().parse(key.slice(SESSION_STORAGE_PREFIX.length))));
    }
  }
  return [sessionForId(LEGACY_SESSION_ID), ...sessions.sort((left: DemoSession, right: DemoSession): number => left.id.localeCompare(right.id))];
}

/** Create a pristine synthetic session only when its new identifier is unused. */
export function createSession(storage: Storage, id: string): DemoSession {
  const session: DemoSession = sessionForId(z.uuid().parse(id));
  if (storage.getItem(session.storageKey) !== null) {
    throw new RangeError(`Session ${session.id} already exists. Existing history cannot be replaced by a new session.`);
  }
  writeState(storage, session.storageKey, initialState());
  return session;
}

/** Create an opt-in v2 authoring session without rewriting any v1 record. */
export function createVersionSession(storage: Storage, id: string): DemoSession {
  const session: DemoSession = sessionForId(z.uuid().parse(id));
  if (storage.getItem(session.storageKey) !== null) {
    throw new RangeError(`Session ${session.id} already exists. Existing history cannot be replaced by a new session.`);
  }
  writeState(storage, session.storageKey, initialVersionState());
  return session;
}

/** Missing named sessions fail explicitly; a fresh browser must not pretend to resume another record. */
export function readSessionState(storage: Storage, session: DemoSession): DemoState {
  if (session.id !== LEGACY_SESSION_ID && storage.getItem(session.storageKey) === null) {
    throw new ReferenceError(`Session ${session.id} is absent from this browser profile and origin. A session URL selects local data; it does not share history. Open the base demo URL to create a local session.`);
  }
  return readState(storage, session.storageKey);
}
