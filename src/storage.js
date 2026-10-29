export const SAVE_KEY = "declare.savedMatch.v1";
export const USER_KEY = "declare.user.v1";
export const BACKEND_KEY = "declare.backendUrl.v1";

// localStorage can be blocked (private windows, disabled site data). The app still works without it.
export function readItem(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeItem(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Ignored: the match simply isn't saved on this device.
  }
}

export function removeItem(key) {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Ignored.
  }
}

// Each account keeps its own unfinished local match. Guests share one slot on this device.
export function savedMatchKey(userId) {
  return userId ? `${SAVE_KEY}.${userId}` : SAVE_KEY;
}

// Only an unfinished local match can be resumed. Finished and online matches are never offered.
export function resumableMatch(raw) {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    return saved && saved.mode !== "online" && saved.status !== "matchResult" ? saved : null;
  } catch {
    return null;
  }
}

export function parseStoredSession(raw) {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    return saved && saved.user && saved.token ? saved : null;
  } catch {
    return null;
  }
}
