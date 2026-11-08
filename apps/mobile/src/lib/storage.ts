import { createMMKV } from "react-native-mmkv";

// The phone's equivalent of the web app's localStorage: synchronous, and the
// same `hw-*` key names, so a value means the same thing on both.
const store = createMMKV({ id: "dueplanner" });

export function readJSON<T>(key: string, fallback: T): T {
  const raw = store.getString(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export function writeJSON(key: string, value: unknown): void {
  store.set(key, JSON.stringify(value));
}
