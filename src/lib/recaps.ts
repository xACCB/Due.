import { localDateStr, startOfWeek } from "./dates";
import { formatDuration } from "./format";

// Inbox messages: a recap written when a day, week, month or year ends. Each
// one is a snapshot (counts and titles copied out of the tasks at that
// moment), so it still reads the same after those tasks are edited or deleted.

export type RecapPeriod="day"|"week"|"month"|"year";
export type Recap={
  id:string; period:RecapPeriod;
  start:string; end:string; // local dates, both inclusive
  finished:number; mins:number;
  dated:number; onTime:number; // of the finished tasks that had a due date
  busiest:string|null;
  titles:string[]; // finished tasks, in the order they were finished (capped)
  read:boolean;
};
// Just the task fields a recap reads.
export type RecapTask={
  title:string; subject:string; dueDate:string; dueTime:string;
  completedAt?:number|null; sessions?:{mins:number; at:number}[];
};
export type Period={period:RecapPeriod; start:string; end:string};

export const RECAP_LIMITS={days:7,titles:20,kept:60};

const dayOf=(iso:string)=>new Date(iso+"T00:00:00");
const shift=(iso:string,days:number)=>{const d=dayOf(iso);d.setDate(d.getDate()+days);return localDateStr(d);};

// The periods that have ended and haven't had a recap yet. `lastChecked` is
// the local date this last ran (null the first time): a period is new if it
// ended on or after that date and before `today`. Days go back at most a
// week; for weeks, months and years only the latest one is considered, so a
// long absence doesn't flood the Inbox.
export function endedPeriods(lastChecked:string|null,today:string,weekStart:number):Period[]{
  if(lastChecked!=null&&lastChecked>=today)return [];
  const fresh=(end:string)=>lastChecked==null||end>=lastChecked;
  const out:Period[]=[];
  const yesterday=shift(today,-1);
  const oldest=shift(today,-RECAP_LIMITS.days);
  const firstDay=lastChecked==null?yesterday:lastChecked>oldest?lastChecked:oldest;
  for(let d=firstDay;d<=yesterday;d=shift(d,1))out.push({period:"day",start:d,end:d});
  const thisWeek=localDateStr(startOfWeek(dayOf(today),weekStart));
  const week={period:"week" as const,start:shift(thisWeek,-7),end:shift(thisWeek,-1)};
  if(fresh(week.end))out.push(week);
  const t=dayOf(today);
  const month={period:"month" as const,start:localDateStr(new Date(t.getFullYear(),t.getMonth()-1,1)),end:localDateStr(new Date(t.getFullYear(),t.getMonth(),0))};
  if(fresh(month.end))out.push(month);
  const year={period:"year" as const,start:`${t.getFullYear()-1}-01-01`,end:`${t.getFullYear()-1}-12-31`};
  if(fresh(year.end))out.push(year);
  return out;
}

// One period's recap, or null when nothing was finished and no time was
// logged (an empty recap isn't worth a message). On time means finished by
// the due time, or by the end of the due date when there's no time.
export function buildRecap(tasks:RecapTask[],p:Period):Recap|null{
  const from=dayOf(p.start).getTime(), to=dayOf(shift(p.end,1)).getTime();
  const within=(ms:number)=>ms>=from&&ms<to;
  const done=tasks.filter(t=>t.completedAt!=null&&within(t.completedAt)).sort((a,b)=>(a.completedAt as number)-(b.completedAt as number));
  const mins=tasks.reduce((s,t)=>s+(t.sessions||[]).filter(x=>within(x.at)).reduce((a,x)=>a+x.mins,0),0);
  if(done.length===0&&mins===0)return null;
  const dated=done.filter(t=>t.dueDate);
  const onTime=dated.filter(t=>(t.completedAt as number)<=new Date(`${t.dueDate}T${t.dueTime||"23:59"}:00`).getTime()).length;
  const counts:Record<string,number>={};
  done.forEach(t=>{if(t.subject)counts[t.subject]=(counts[t.subject]||0)+1;});
  const top=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
  return {
    id:`recap-${p.period}-${p.start}`,period:p.period,start:p.start,end:p.end,
    finished:done.length,mins,dated:dated.length,onTime,busiest:top?top[0]:null,
    titles:done.slice(0,RECAP_LIMITS.titles).map(t=>t.title),read:false,
  };
}

export function newRecaps(tasks:RecapTask[],lastChecked:string|null,today:string,weekStart:number):Recap[]{
  return endedPeriods(lastChecked,today,weekStart).map(p=>buildRecap(tasks,p)).filter((r):r is Recap=>r!=null);
}

// Newest first; on the same end date the longer period goes on top. Keeps
// what's already stored when an id repeats (so a read recap stays read).
const RANK:Record<RecapPeriod,number>={year:0,month:1,week:2,day:3};
export function mergeRecaps(existing:Recap[],fresh:Recap[]):Recap[]{
  const have=new Set(existing.map(r=>r.id));
  return [...existing,...fresh.filter(r=>!have.has(r.id))]
    .sort((a,b)=>a.end===b.end?RANK[a.period]-RANK[b.period]:a.end<b.end?1:-1)
    .slice(0,RECAP_LIMITS.kept);
}

// The recap as an Inbox message (the same shape as a What's New entry).
export type RecapMessage={id:string; date:string; kind:string; headline:string; description:string; list?:string[]};
const KIND:Record<RecapPeriod,string>={day:"Daily recap",week:"Weekly recap",month:"Monthly recap",year:"Yearly recap"};
export function recapMessage(r:Recap):RecapMessage{
  const start=dayOf(r.start), end=dayOf(r.end);
  const short=(d:Date)=>d.toLocaleDateString(undefined,{month:"short",day:"numeric"});
  const headline=r.period==="day"?`${start.toLocaleDateString(undefined,{weekday:"long"})} recap`
    :r.period==="week"?"Weekly recap"
    :r.period==="month"?`${start.toLocaleDateString(undefined,{month:"long"})} recap`
    :`${start.getFullYear()} recap`;
  const time=formatDuration(r.mins);
  const parts:string[]=[];
  if(r.period==="week")parts.push(`${short(start)} to ${short(end)}.`);
  if(r.finished>0)parts.push(`You finished ${r.finished} task${r.finished===1?"":"s"}${time?` and spent ${time} working`:""}.`);
  else parts.push(`You spent ${time} working, with no tasks finished.`);
  if(r.dated===1)parts.push(r.onTime===1?"The one with a due date was on time.":"The one with a due date was late.");
  else if(r.dated>1)parts.push(r.onTime===r.dated?`All ${r.dated} with a due date were on time.`
    :r.onTime===0?`All ${r.dated} with a due date were late.`
    :`${r.onTime} of the ${r.dated} with a due date were on time.`);
  if(r.busiest)parts.push(`Your busiest subject was ${r.busiest}.`);
  const more=r.finished-r.titles.length;
  const list=r.titles.length?[...r.titles,...(more>0?[`and ${more} more`]:[])]:undefined;
  return {id:r.id,date:r.end,kind:KIND[r.period],headline,description:parts.join(" "),list};
}
