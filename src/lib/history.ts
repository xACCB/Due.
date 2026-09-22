// Undo/redo for task changes: record each affected task's state before and
// after (null = the task didn't exist), and restore one side or the other.
// Stored per task rather than as a copy of the whole list, so undoing one
// change can't roll back unrelated edits made since (e.g. from another device).

export type TaskStates<T> = [id: number, task: T | null][];

export function diffTasks<T extends { id: number }>(prev: T[], next: T[]): { before: TaskStates<T>; after: TaskStates<T> } {
  const p = new Map(prev.map(t => [t.id, t])), n = new Map(next.map(t => [t.id, t]));
  const before: TaskStates<T> = [], after: TaskStates<T> = [];
  for (const id of new Set([...p.keys(), ...n.keys()])) {
    const a = p.get(id) ?? null, b = n.get(id) ?? null;
    if (a === b) continue; // untouched (unchanged tasks keep their object identity)
    before.push([id, a]);
    after.push([id, b]);
  }
  return { before, after };
}

// Puts each listed task into the given state: replaced in place, appended if
// it's missing, removed if the state is null.
export function applyTaskStates<T extends { id: number }>(list: T[], states: TaskStates<T>): T[] {
  const want = new Map(states);
  const out: T[] = [];
  for (const t of list) {
    if (!want.has(t.id)) { out.push(t); continue; }
    const s = want.get(t.id)!;
    if (s) out.push(s);
    want.delete(t.id);
  }
  for (const s of want.values()) if (s) out.push(s);
  return out;
}
