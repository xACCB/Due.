import { localDateStr, startOfWeek } from "./dates";

// The Calendar tab's month grid: 6 rows of 7 local dates (YYYY-MM-DD),
// starting on the week containing the 1st of the month, so every month has
// the same shape and the grid doesn't jump in height between months.
// `month` is 0-based, like Date. weekStart: 0 = Sunday, 1 = Monday.
export function monthGrid(year:number, month:number, weekStart:number):string[] {
  const d=startOfWeek(new Date(year,month,1),weekStart);
  const out:string[]=[];
  for(let i=0;i<42;i++){
    out.push(localDateStr(d));
    d.setDate(d.getDate()+1);
  }
  return out;
}

// The month `delta` months from year/month, as [year, month].
export function shiftMonth(year:number, month:number, delta:number):[number,number] {
  const d=new Date(year,month+delta,1);
  return [d.getFullYear(),d.getMonth()];
}

// Weekday initials in the grid's column order.
export function weekdayLabels(weekStart:number):string[] {
  const names=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return names.map((_,i)=>names[(i+weekStart)%7]);
}

// How busy a day looks on the heatmap, from the minutes of open work due that
// day: 0 = nothing, then light / medium / heavy / very heavy. A day with open
// tasks but no estimates still counts as light, so it doesn't look empty.
export function heatLevel(mins:number, openCount:number):0|1|2|3|4 {
  if(openCount===0)return 0;
  if(mins<60)return 1;
  if(mins<120)return 2;
  if(mins<180)return 3;
  return 4;
}

// Tasks grouped by due date (tasks without one are left out -- the calendar
// has nowhere to put them).
export function byDueDate<T extends {dueDate:string}>(tasks:T[]):Map<string,T[]> {
  const m=new Map<string,T[]>();
  for(const t of tasks){
    if(!t.dueDate)continue;
    const list=m.get(t.dueDate);
    if(list)list.push(t);else m.set(t.dueDate,[t]);
  }
  return m;
}
