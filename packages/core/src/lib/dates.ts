import type { Recurrence } from "../types";

// Local calendar date as YYYY-MM-DD -- deliberately NOT toISOString() (which is
// UTC), since due-date strings (and every other place a Date needs to become
// one) need to roll over at the user's own local midnight, not UTC midnight.
export function localDateStr(d:Date):string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
export function todayISO():string { return localDateStr(new Date()); }
export function advanceDate(dateStr:string, recurrence:Recurrence):string {
  const d = dateStr ? new Date(dateStr+"T00:00:00") : new Date();
  if (recurrence==="daily") d.setDate(d.getDate()+1);
  else if (recurrence==="weekly") d.setDate(d.getDate()+7);
  else if (recurrence==="monthly") {
    // setMonth() doesn't clamp to the target month's length -- e.g. Jan 31 + 1
    // month would silently become Mar 3, not Feb 28. Jump to day 1 of the
    // target month first (so the day-of-month can't overflow into it), then
    // clamp the original day-of-month to however many days that month has.
    const day=d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth()+1);
    const daysInMonth=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
    d.setDate(Math.min(day,daysInMonth));
  }
  return localDateStr(d);
}
// Local midnight at the start of the week containing `d`. weekStart: 0 =
// Sunday, 1 = Monday (the "Week starts on" setting).
export function startOfWeek(d:Date, weekStart:number):Date {
  const out=new Date(d); out.setHours(0,0,0,0);
  out.setDate(out.getDate()-((out.getDay()-weekStart+7)%7));
  return out;
}
