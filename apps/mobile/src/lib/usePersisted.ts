import { useEffect, useState } from "react";
import { readJSON, writeJSON } from "./storage";

// useState that's saved under a `hw-*` key (the web's usePersistedState).
// `clean` turns whatever was stored into a valid value (wrong type, old shape).
export function usePersisted<T>(key: string, initial: T, clean?: (raw: unknown) => T) {
  const [value, setValue] = useState<T>(() => {
    const raw = readJSON<unknown>(key, initial);
    return clean ? clean(raw) : (raw as T);
  });
  useEffect(() => { writeJSON(key, value); }, [key, value]);
  return [value, setValue] as const;
}
