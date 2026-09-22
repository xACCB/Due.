import type { Priority } from "../types";

export function contrastColor(hex:string):string {
  const c=hex.replace("#","");
  const r=parseInt(c.substring(0,2),16)/255, g=parseInt(c.substring(2,4),16)/255, b=parseInt(c.substring(4,6),16)/255;
  const lin=(v:number)=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);
  const L=0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
  return L>0.5?"#1a1a1a":"#ffffff";
}

function luminance(hex:string):number {
  const c=hex.replace("#","");
  const lin=(i:number)=>{const v=parseInt(c.substring(i,i+2),16)/255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
  return 0.2126*lin(0)+0.7152*lin(2)+0.0722*lin(4);
}

// WCAG contrast ratio between two #rrggbb colors (1 to 21).
export function contrastRatio(a:string,b:string):number {
  const la=luminance(a), lb=luminance(b);
  return (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05);
}

// The same hue, darkened (on a light background) or lightened (on a dark one)
// just enough to read as text against `bg` -- for colored text like subject
// chips and urgency labels, which are picked for looks, not contrast. Colors
// that already pass, and anything that isn't #rrggbb, come back unchanged.
export function readableOn(fg:string,bg:string,ratio=4.5):string {
  if(!/^#[0-9a-f]{6}$/i.test(fg)||!/^#[0-9a-f]{6}$/i.test(bg))return fg;
  if(contrastRatio(fg,bg)>=ratio)return fg;
  const target=luminance(bg)>0.5?0:255;
  const ch=(i:number)=>parseInt(fg.substring(1+i,3+i),16);
  let out=fg;
  for(let t=0.05;t<=1;t+=0.05){
    out="#"+[0,2,4].map(i=>Math.round(ch(i)+(target-ch(i))*t).toString(16).padStart(2,"0")).join("");
    if(contrastRatio(out,bg)>=ratio)break;
  }
  return out;
}
export function getPriority(dueDate:string, estMins:number, override?:Priority):Priority {
  if (override) return override;
  if (!dueDate) return "low";
  const d=(new Date(dueDate+"T00:00:00").getTime()-Date.now())/86400000;
  if (d<1||(d<2&&estMins>60)) return "high"; if (d<3) return "medium"; return "low";
}
export function formatDate(s:string):string {
  if (!s) return "No date";
  return new Date(s+"T00:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
}
// Quotes a CSV field only when it actually needs it (contains a comma,
// quote, or newline), escaping embedded quotes by doubling them per the
// standard CSV convention -- avoids needlessly quoting every plain field.
export function csvField(v:string|number):string {
  const s=String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}
// "3:05 PM", or "15:05" with the 24-hour setting on.
export function formatTime(t:string, h24=false):string {
  if (!t) return "";
  const [h,m]=t.split(":").map(Number);
  if (h24) return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  return new Date(2000,0,1,h,m).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
}
export function daysUntil(s:string):string|null {
  if (!s) return null;
  const now=new Date(); now.setHours(0,0,0,0);
  // round, not ceil: across a daylight-saving change the gap between two local
  // midnights is 23h or 25h, and ceil turned 25h ("tomorrow") into 2 days.
  const d=Math.round((new Date(s+"T00:00:00").getTime()-now.getTime())/86400000);
  if (d<0) return "Overdue!"; if (d===0) return "Due today!"; if (d===1) return "Due tomorrow"; return `${d} days left`;
}
// One duration format everywhere ("45m", "1h", "1h 30m"). Returns "" for a
// missing/zero estimate (e.g. the estimate step was skipped), so callers can
// just hide the label instead of showing "0m".
export function formatDuration(mins:number|undefined|null):string {
  if (!mins || mins<=0) return "";
  const h=Math.floor(mins/60), m=mins%60;
  if (h===0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
// Live countdown for a task due *today at a specific time*: "Due in 2h 15m",
// "Due in <1m", or "Overdue by 20m". Returns null for anything else (no time
// set, or due on another day), so callers fall back to daysUntil().
export function countdown(dueDate:string, dueTime:string, now:number):string|null {
  if (!dueDate || !dueTime) return null;
  const n=new Date(now);
  const today=`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
  if (dueDate!==today) return null;
  const mins=Math.round((new Date(`${dueDate}T${dueTime}:00`).getTime()-now)/60000);
  if (mins>0) return `Due in ${formatDuration(mins)}`;
  if (mins===0) return "Due in <1m";
  return `Overdue by ${formatDuration(-mins)}`;
}
// "just now", "5m ago", "2h ago", "3d ago" -- for "Synced 5m ago".
export function formatAgo(at:number, now:number):string {
  const mins=Math.floor((now-at)/60000);
  if (mins<1) return "just now";
  if (mins<60) return `${mins}m ago`;
  const h=Math.floor(mins/60);
  if (h<24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}
