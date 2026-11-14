// Pure, DOM-free: how long a toast stays, how many stand at once, and what a failed request says in plain words.

export const TOAST_MAX = 3; // more than this and the oldest leaves
const BASE_MS = 3200;
const PER_CHAR_MS = 45;
const MAX_MS = 10000;

/** How long a toast stays: longer for more words, twice as long for an error, never past ten seconds; one with an action stays long enough to use it. */
export function toastMs(text, { kind = "info", action = false } = {}) {
  const read = BASE_MS + String(text ?? "").length * PER_CHAR_MS;
  const ms = kind === "error" ? read * 2 : read;
  return Math.min(MAX_MS, Math.max(action ? 6000 : 0, ms));
}

/** The toasts standing after `next` joins `list` (oldest first): the same words twice become one, and only the newest TOAST_MAX stay. */
export function pushToast(list, next) {
  const kept = list.filter((x) => !(x.text === next.text && x.kind === next.kind));
  return [...kept, next].slice(-TOAST_MAX);
}

/**
 * Which plain sentence a failure deserves: "offline" when the request never reached a server (the browser's own
 * "Failed to fetch", "Load failed", "NetworkError…"), "busy" for a 409, else "other" (the error's own message is shown).
 */
export function failureKind(error) {
  const message = String(error?.message ?? error ?? "");
  if (error?.status === 409) return "busy";
  if (error?.name === "TypeError" || /failed to fetch|load failed|networkerror|network request failed/i.test(message)) return "offline";
  return "other";
}
