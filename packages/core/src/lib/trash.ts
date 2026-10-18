// Recently deleted: entries, their 30-day pruning, and the combined view of
// live and deleted tasks that sync merges.
import type { Task } from "../types";
import type { SyncRecord } from "./sync";

// Recently deleted entries. Built at module scope because the React
// Compiler's purity lint rejects Date.now() inside component functions.
export type TrashEntry={task:Task;deletedAt:number};
export const TRASH_DAYS=30;
export function trashEntries(list:Task[]):TrashEntry[]{ const at=Date.now(); return list.map(task=>({task,deletedAt:at})); }
export function pruneTrash(prev:TrashEntry[]):TrashEntry[]{
  const cutoff=Date.now()-TRASH_DAYS*86400000;
  return prev.some(e=>e.deletedAt<cutoff)?prev.filter(e=>e.deletedAt>=cutoff):prev;
}
// Every task this device knows about, live or in Recently deleted, keyed by id
// -- the shape src/lib/sync.ts merges.
export function localRecords(tasks:Task[],trash:TrashEntry[]):Map<number,SyncRecord<Task>>{
  const m=new Map<number,SyncRecord<Task>>();
  for(const e of trash)m.set(e.task.id,{task:e.task,deletedAt:e.deletedAt});
  for(const t of tasks)m.set(t.id,{task:t});
  return m;
}
