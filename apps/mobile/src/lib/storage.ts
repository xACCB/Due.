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

// Every hw-* key on this phone (account deletion: "delete my data" means all
// of it, as on the web, which clears its hw-* localStorage keys).
export function clearAppData(): void {
  for (const key of store.getAllKeys()) if (key.startsWith("hw-")) store.remove(key);
}
