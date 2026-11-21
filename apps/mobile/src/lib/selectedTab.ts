// Which main screen (a route of app/(tabs)) is showing, for ScreenBody's entrance.
// Not useIsFocused: a sheet or Search over a screen takes the focus, and the
// screen behind must not replay its entrance when they close.
// app/(tabs)/_layout.tsx sets it from the tab navigator's state.
import { useSyncExternalStore } from "react";

let current: string | null = null;
const listeners = new Set<() => void>();

export function setSelectedTab(name: string) {
  if (name === current) return;
  current = name;
  listeners.forEach(f => f());
}

export function useSelectedTab(): string | null {
  return useSyncExternalStore(
    f => { listeners.add(f); return () => { listeners.delete(f); }; },
    () => current,
  );
}
