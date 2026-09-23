// Conflict handling for task sync (see the tasks/trash listeners in App.tsx).
//
// Every task is a "record": live, or deleted (in Recently deleted, with a
// deletedAt). Three versions of each record meet when a cloud snapshot
// arrives:
//   base  -- what we last knew the cloud held
//   local -- what this device has now (possibly edited since base)
//   cloud -- what the cloud holds now (possibly edited by another device)
// A record this device hasn't touched just takes the cloud version. One both
// sides changed is merged field by field: a field only one side changed takes
// that side's value, and a field both changed takes the newer edit.

export type SyncRecord<T> = { task: T; deletedAt?: number };
export type CloudRecord<T> = SyncRecord<T> & { updatedAt: number };

// JSON with object keys sorted, so two equal values compare equal regardless
// of key order (Firestore hands fields back in a different order than they
// were written).
export function stableStringify(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}
export function same(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

// Three-way, field-by-field merge of one task. `localAt`/`cloudAt` are when
// each side's edit happened; they only matter for a field both sides changed.
export function mergeFields<T extends object>(base: T | undefined, local: T, cloud: T, localAt: number, cloudAt: number): T {
  const b = (base || {}) as Record<string, unknown>, l = local as Record<string, unknown>, c = cloud as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(l), ...Object.keys(c)])) {
    let v: unknown;
    if (same(l[k], c[k])) v = l[k];
    else if (same(l[k], b[k])) v = c[k];      // only the cloud changed it
    else if (same(c[k], b[k])) v = l[k];      // only this device changed it
    else v = cloudAt > localAt ? c[k] : l[k]; // both changed it: newest wins
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

// Merges one record. `dirtyAt` is when this device last changed it without
// having written that change yet (undefined = no unsaved local change).
export function mergeRecord<T extends object>(
  base: SyncRecord<T> | undefined,
  local: SyncRecord<T> | undefined,
  cloud: CloudRecord<T> | undefined,
  dirtyAt: number | undefined,
): SyncRecord<T> | undefined {
  const strip = (r: CloudRecord<T> | undefined): SyncRecord<T> | undefined =>
    r && (r.deletedAt !== undefined ? { task: r.task, deletedAt: r.deletedAt } : { task: r.task });
  if (dirtyAt === undefined || same(local, base)) return strip(cloud);
  if (same(strip(cloud), base)) return local;  // cloud unchanged since base
  if (!cloud) return local;                    // purged elsewhere; this device's edit is newer news
  if (!local) return cloudAtWins(cloud, dirtyAt) ? strip(cloud) : undefined;
  const cloudDeleted = cloud.deletedAt !== undefined, localDeleted = local.deletedAt !== undefined;
  if (cloudDeleted !== localDeleted) return cloudAtWins(cloud, dirtyAt) ? strip(cloud) : local;
  const task = mergeFields(base?.task, local.task, cloud.task, dirtyAt, cloud.updatedAt);
  if (!localDeleted) return { task };
  return { task, deletedAt: Math.max(local.deletedAt!, cloud.deletedAt!) };
}
function cloudAtWins(cloud: { updatedAt: number }, dirtyAt: number) { return cloud.updatedAt > dirtyAt; }

// Merges every record. Returns the new local state.
export function reconcile<T extends object>(
  base: Map<number, SyncRecord<T>>,
  local: Map<number, SyncRecord<T>>,
  cloud: Map<number, CloudRecord<T>>,
  dirtyAt: Map<number, number>,
): Map<number, SyncRecord<T>> {
  const out = new Map<number, SyncRecord<T>>();
  for (const id of new Set([...base.keys(), ...local.keys(), ...cloud.keys()])) {
    const r = mergeRecord(base.get(id), local.get(id), cloud.get(id), dirtyAt.get(id));
    if (r) out.set(id, r);
  }
  return out;
}

// The fields of `next` that differ from `prev`, for a partial (merge) write;
// a field removed in `next` maps to `removed` (the caller passes deleteField()).
export function changedFields<T extends object>(prev: T, next: T, removed: unknown): Record<string, unknown> {
  const p = prev as Record<string, unknown>, n = next as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(p), ...Object.keys(n)])) {
    if (same(p[k], n[k])) continue;
    out[k] = n[k] === undefined ? removed : n[k];
  }
  return out;
}

// ---- Task counter (users/{uid}/meta/counts, see firestore.rules) ----
// Which collection a task's doc lives in: tasks/, trash/, or neither.
export type TaskHome = "tasks" | "trash" | null;
export function homeOf(r: { deletedAt?: number } | undefined): TaskHome {
  return !r ? null : r.deletedAt !== undefined ? "trash" : "tasks";
}
// How the counts doc's n (tasks) and t (trash) must change when one task's
// doc moves from `before` to `after`. firestore.rules checks exactly this
// against which docs really exist before and after the batch.
export function countDelta(before: TaskHome, after: TaskHome): { n: number; t: number } {
  return {
    n: (after === "tasks" ? 1 : 0) - (before === "tasks" ? 1 : 0),
    t: (after === "trash" ? 1 : 0) - (before === "trash" ? 1 : 0),
  };
}
