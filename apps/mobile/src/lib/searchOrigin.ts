// Home's "Search tasks..." field, for Search's bar to fly out of it and back
// into it, as the web's SearchOverlay does. Home records the field's place on
// screen just before opening Search, and hides the field while Search's bar
// is out of it (the web hides searchTriggerRef the same way). Opened another
// way (the sidebar), there's no place and the bar simply fades in.
import { useSyncExternalStore } from "react";

export type Box = { x: number; y: number; w: number; h: number };

let origin: Box | null = null;
let hidden = false;
const listeners = new Set<() => void>();

export function setSearchOrigin(box: Box | null) { origin = box; }
// Search reads it once when it opens; the next opening must record its own.
export function takeSearchOrigin(): Box | null { const b = origin; origin = null; return b; }

export function setSearchFieldHidden(v: boolean) {
  if (v === hidden) return;
  hidden = v;
  listeners.forEach(f => f());
}
export function useSearchFieldHidden(): boolean {
  return useSyncExternalStore(f => { listeners.add(f); return () => { listeners.delete(f); }; }, () => hidden);
}
