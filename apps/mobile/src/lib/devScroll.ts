import { useEffect, type RefObject } from "react";

// Development only: lets the dev remote (devRemote.ts, `"scroll": 600`) scroll
// whichever screen is showing, to screenshot what's below the fold. A screen
// passes its ScrollView or FlatList ref to useDevScroll; does nothing in a
// release build.
type Scrollable = { scrollTo?: (o: { y: number; animated?: boolean }) => void; scrollToOffset?: (o: { offset: number; animated?: boolean }) => void };
const listeners = new Set<(y: number) => void>();

export function devScrollTo(y: number): void {
  for (const l of listeners) l(y);
}

export function useDevScroll(ref: RefObject<Scrollable | null>): void {
  useEffect(() => {
    if (!__DEV__) return;
    const l = (y: number) => {
      const r = ref.current;
      if (r?.scrollToOffset) r.scrollToOffset({ offset: y, animated: false });
      else r?.scrollTo?.({ y, animated: false });
    };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, [ref]);
}

// `"toggle": 1003` ticks (or unticks) that task through Home's own toggle, so
// the completion hold and animation run as from a tap. Development only.
const togglers = new Set<(id: number) => void>();
export function devToggle(id: number): void {
  for (const t of togglers) t(id);
}
export function useDevToggle(fn: (id: number) => void): void {
  useEffect(() => {
    if (!__DEV__) return;
    togglers.add(fn);
    return () => { togglers.delete(fn); };
  }, [fn]);
}
