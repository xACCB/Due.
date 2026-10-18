import { useSyncExternalStore } from "react";
import { getFlags, subscribeFlags } from "../lib/flags";
import type { Flags } from "../lib/flags";

// The current feature flags (src/lib/flags.ts); re-renders when Remote Config's values land.
export function useFlags(): Flags {
  return useSyncExternalStore(subscribeFlags, getFlags);
}
