// Focus Mode's stopwatch, and the setting for what Focus Mode shows.

// Elapsed time as "MM:SS", or "H:MM:SS" once it passes an hour.
export function formatStopwatch(ms:number):string{
  const total=Math.max(0,Math.floor(ms/1000));
  const h=Math.floor(total/3600), m=Math.floor((total%3600)/60), s=total%60;
  const two=(n:number)=>String(n).padStart(2,"0");
  return h?`${h}:${two(m)}:${two(s)}`:`${two(m)}:${two(s)}`;
}

// The session length logged to a task when the stopwatch is saved: whole
// minutes, at least one (a session of 0 minutes would show as nothing).
export function stopwatchMinutes(ms:number):number{
  return Math.max(1,Math.round(ms/60000));
}

// What Focus Mode shows under the task ("hw-focus-show").
export const FOCUS_SHOW=[
  {key:"task",label:"Task only"},
  {key:"task-stopwatch",label:"Task and stopwatch"},
  {key:"task-pomodoro",label:"Task and Pomodoro"},
  {key:"all",label:"Task, Pomodoro and stopwatch"},
] as const;
export type FocusShow=typeof FOCUS_SHOW[number]["key"];
export function normalizeFocusShow(value:unknown):FocusShow{
  return FOCUS_SHOW.some(o=>o.key===value)?value as FocusShow:"all";
}
export const showsPomodoro=(v:FocusShow)=>v==="task-pomodoro"||v==="all";
export const showsStopwatch=(v:FocusShow)=>v==="task-stopwatch"||v==="all";
