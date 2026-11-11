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

// The same grid with only that month's days: cells from the months before and
// after are null (drawn blank), and a week with no day of the month in it is
// dropped, so the grid is 4 to 6 rows.
export function monthOnlyGrid(year:number, month:number, weekStart:number):(string|null)[] {
  const prefix=`${year}-${String(month+1).padStart(2,"0")}-`;
  const cells=monthGrid(year,month,weekStart).map(iso=>iso.startsWith(prefix)?iso:null);
  const out:(string|null)[]=[];
  for(let i=0;i<cells.length;i+=7){
    const week=cells.slice(i,i+7);
    if(week.some(c=>c!=null))out.push(...week);
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

// The Deck (Calendar -> Deck, web and phone): one card per date that still has
// an open task or is today or later, oldest first. `due` is byDueDate's map.
export function deckDates<T extends {done:boolean}>(due:Map<string,T[]>, today:string):string[] {
  return [...due.keys()].filter(d=>d>=today||due.get(d)!.some(t=>!t.done)).sort();
}

// The card on top: the picked date while it's still in the deck (remembered by
// date, not position, so adding or finishing tasks elsewhere doesn't move you),
// else the first date from today on, else the last. Undefined when empty.
export function deckTop(dates:string[], picked:string|null, today:string):string|undefined {
  if(picked&&dates.includes(picked))return picked;
  return dates.find(d=>d>=today)??dates[dates.length-1];
}

// Where the top card sits while dragged `dx` pixels: with the finger toward a
// next card, a third as far when there's none that way or when pulling right
// (the earlier card comes in over it instead).
export function deckDragX(dx:number, hasNext:boolean):number {
  return dx<0&&hasNext?dx:dx*0.3;
}

// Letting go of the top card: 1 for the next date, -1 for the one before, 0 to
// spring back. Past 70px, or a flick (over 600px/s) after 24px.
export function deckSwipe(dx:number, velocity:number):-1|0|1 {
  return dx<=-70||(velocity<-600&&dx<-24)?1:dx>=70||(velocity>600&&dx>24)?-1:0;
}

// The month grid: a swipe past 50px changes month, left for the next one.
export function monthSwipe(dx:number):-1|0|1 {
  return Math.abs(dx)>50?(dx<0?1:-1):0;
}
