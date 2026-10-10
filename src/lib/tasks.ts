// Plain functions over tasks: completing (and the repeat copy that spawns),
// ordering, snooze dates, the suggestion text. No React, no browser storage.
import type { Recurrence, Task } from "../types";
import { localDateStr, advanceDate } from "./dates";
import { getPriority, daysUntil, formatDuration } from "./format";
import { nextId } from "./id";

// A new user starts with an empty list. The app used to seed four example
// tasks; these are what they looked like, kept only to recognise them: they
// are cleared once from a device that still has them untouched (see the tasks
// initializer), and never treated as the user's own work when signing in.
export const LEGACY_EXAMPLE_TASKS=[
  { id:1, title:"Chapter 5 Review", subject:"Math", estMins:45 },
  { id:2, title:"Essay Draft", subject:"English", estMins:90 },
  { id:3, title:"Lab Report", subject:"Science", estMins:60 },
  { id:4, title:"History Reading", subject:"History", estMins:30 },
];
// An example exactly as it was seeded: same id, title, subject and estimate,
// not finished, nothing added to it.
export function isUntouchedExample(t:Task):boolean{
  return !t.done&&!t.archived&&!t.subtasks?.length&&!t.sessions?.length&&!t.tags?.length
    &&LEGACY_EXAMPLE_TASKS.some(d=>d.id===t.id&&d.title===t.title&&d.subject===t.subject&&d.estMins===t.estMins);
}

// Picks the most urgent pending task, computed locally and instantly from the
// task data (this once called an AI API from the browser, which was both
// broken and insecure; nothing about it needs a network call).
export function buildSuggestion(tasks:Task[]):string {
  const pending=tasks.filter(t=>!t.done&&!t.archived);
  if (pending.length===0) return "Nothing left to do. Great work!";
  if (pending.length===1) return `Just one task left: "${pending[0].title}". You've got this!`;
  const sorted=[...pending].sort((a,b)=>{
    const o:Record<string,number>={high:0,medium:1,low:2};
    const d=o[getPriority(a.dueDate,a.estMins,a.priorityOverride)]-o[getPriority(b.dueDate,b.estMins,b.priorityOverride)];
    return d!==0?d:(a.dueDate||"9999-99-99").localeCompare(b.dueDate||"9999-99-99");
  });
  const top=sorted[0];
  const days=daysUntil(top.dueDate);
  const timeStr=formatDuration(top.estMins);
  const urgencyWord=days==="Overdue!"?"overdue":days==="Due today!"?"due today":days==="Due tomorrow"?"due tomorrow":days?days.replace(" days left","d left"):"no deadline";
  return `Most urgent: "${top.title}"\n${urgencyWord}${timeStr?`, ~${timeStr}`:""}`;
}

// A local YYYY-MM-DD `days` from today (bulk "set due date" shortcuts). Module
// scope for the same React Compiler purity reason as snoozeTarget below.
export function dateInDays(days:number):string{ const d=new Date(); d.setDate(d.getDate()+days); return localDateStr(d); }

// Snooze moves a task's due date (and, for "in 3 hours", its time) forward.
export type SnoozeKind="later"|"tomorrow"|"week";
export function snoozeTarget(kind:SnoozeKind):{dueDate:string;dueTime?:string}{
  if(kind==="later"){
    // Three hours from now, rounded up to the next quarter hour.
    const d=new Date(Date.now()+3*3600000);
    d.setMinutes(Math.ceil(d.getMinutes()/15)*15,0,0);
    return {dueDate:localDateStr(d),dueTime:`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`};
  }
  const d=new Date(); d.setDate(d.getDate()+(kind==="tomorrow"?1:7));
  return {dueDate:localDateStr(d)};
}

// Marks tasks done/undone. A recurring task spawns its next occurrence when
// marked done -- due date advanced (or still none, if it never had one),
// subtasks reset to unchecked, no carried-over sessions -- and remembers that
// copy's id, so marking it undone again removes the copy (if it hasn't been
// completed itself) instead of leaving a duplicate behind on every toggle.
export function setDone(prev:Task[],ids:number[],done:boolean):Task[]{
  let next=[...prev];
  for(const id of ids){
    const task=next.find(t=>t.id===id);
    if(!task||task.done===done)continue;
    // Un-completing also un-archives: an archived task that isn't done would
    // otherwise be hidden from every view except Archived.
    next=next.map(t=>t.id===id?{...t,done,completedAt:done?Date.now():null,...(done?{}:{archived:false})}:t);
    const recurring=task.recurrence&&task.recurrence!=="none";
    if(done&&recurring&&!(task.spawnedNextId&&next.some(t=>t.id===task.spawnedNextId))){
      const copyId=nextId();
      next=next.map(t=>t.id===id?{...t,spawnedNextId:copyId}:t);
      next.push({...task,id:copyId,done:false,completedAt:null,archived:false,spawnedNextId:null,
        dueDate:task.dueDate?advanceDate(task.dueDate,task.recurrence as Recurrence):"",
        order:nextOrder(next),sessions:[],
        ...(task.subtasks?{subtasks:task.subtasks.map(s=>({...s,id:String(nextId()),done:false}))}:{})});
    }
    if(!done&&task.spawnedNextId){
      const copy=next.find(t=>t.id===task.spawnedNextId);
      if(copy&&!copy.done) next=next.filter(t=>t.id!==copy.id);
      next=next.map(t=>t.id===id?{...t,spawnedNextId:null}:t);
    }
  }
  return next;
}

// Next free manual-order slot. Using list.length collided with existing
// orders once tasks had been deleted (orders keep their gaps), which made
// new tasks sort unpredictably among old ones.
export function nextOrder(list:Task[]):number{
  return list.reduce((m,t)=>Math.max(m,t.order??0),-1)+1;
}
