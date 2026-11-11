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

// `"act": ["open-message", "recap-day-2026-11-09"]`: a named development action a
// screen answers (useDevAction), standing in for a tap the remote can't make.
const actions = new Map<string, Set<(arg: string) => void>>();
export function devAct(name: string, arg: string): void {
  for (const f of actions.get(name) ?? []) f(arg);
}
export function useDevAction(name: string, fn: (arg: string) => void): void {
  useEffect(() => {
    if (!__DEV__) return;
    const set = actions.get(name) ?? new Set();
    actions.set(name, set);
    set.add(fn);
    return () => { set.delete(fn); };
  }, [name, fn]);
}
