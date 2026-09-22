import type { Priority } from "../types";

export function contrastColor(hex:string):string {
  const c=hex.replace("#","");
  const r=parseInt(c.substring(0,2),16)/255, g=parseInt(c.substring(2,4),16)/255, b=parseInt(c.substring(4,6),16)/255;
  const lin=(v:number)=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);
  const L=0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
  return L>0.5?"#1a1a1a":"#ffffff";
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
export function formatTime(t:string):string {
  if (!t) return "";
  const [h,m]=t.split(":").map(Number);
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
