export const MAX_IMPORT_BYTES = 1024 * 1024;
export const DEMONSTRATION_NOTICE = "Synthetic; actor identity is not authenticated; local storage is editable and is not an audit security boundary.";

/** Bound both imported histories and new continuity records so their exports remain recoverable. */
export function requireRecoverableSize(content: string): void {
  if (new TextEncoder().encode(content).byteLength > MAX_IMPORT_BYTES) throw new RangeError("History exceeds the 1 MiB recovery limit. Preserve its existing export and create another synthetic decision; no history was truncated or replaced.");
}
