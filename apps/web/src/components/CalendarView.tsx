import { useState, useEffect, useLayoutEffect, useRef } from "react";
import type { Task } from "@dueplanner/core/types";
import { priColor } from "@dueplanner/core/constants";
import type { ThemeObj } from "@dueplanner/core/themes";
import { localDateStr } from "@dueplanner/core/lib/dates";
import { formatTime, formatDuration, ink } from "@dueplanner/core/lib/format";
import { monthGrid, monthOnlyGrid, shiftMonth, weekdayLabels, byDueDate } from "@dueplanner/core/lib/calendar";
import { releaseVelocity } from "@dueplanner/core/lib/spring";
import { FONT } from "@dueplanner/core/fonts";
import { CheckMark } from "./icons";
import { activateOnKey } from "../lib/dom";
import { DayDetail } from "./GrowCard";
import { fz } from "../lib/textSize";

// The Calendar tab: a month grid (6 fixed rows, so it doesn't jump between
// months) where each day is dotted with its open tasks' subject colors, plus
// the chosen day's tasks underneath. Undated tasks aren't shown -- there's no day to put
// them on. Module scope like TaskModal, so the `now` tick doesn't remount it
// (which would reset the month you're looking at).
export function CalendarView({tasks,T,F,subjectColors,colorCodeUrgency,weekStart,monthOnly,h24,now,onOpenTask,onToggleDone,onAddOn}:{
  tasks:Task[]; T:ThemeObj; F:typeof FONT; subjectColors:Record<string,string>; colorCodeUrgency:boolean;
  weekStart:number; monthOnly:boolean; h24:boolean; now:number;
  onOpenTask:(t:Task)=>void; onToggleDone:(id:number)=>void; onAddOn:(date:string)=>void;
}){
  const today=localDateStr(new Date(now));
  const [ym,setYm]=useState<[number,number]>(()=>{const d=new Date(now);return [d.getFullYear(),d.getMonth()];});
  const [selected,setSelected]=useState(today);
  const [year,month]=ym;
  // What the grid draws: six full weeks including the neighbouring months'
  // days, or (monthOnly) just this month's days, blank elsewhere, in as many
  // rows as it needs. `days` is the real dates in it.
  const cells:(string|null)[]=monthOnly?monthOnlyGrid(year,month,weekStart):monthGrid(year,month,weekStart);
  const days=cells.filter((c):c is string=>c!=null);
  const rows=cells.length/7;
  const due=byDueDate(tasks.filter(t=>!t.archived));
  const gridRef=useRef<HTMLDivElement>(null);
  const refocus=useRef(false);
  // Moving the selection with the arrow keys keeps keyboard focus on it,
  // including when it crosses into the next or previous month.
  useEffect(()=>{
    if(!refocus.current)return;
    refocus.current=false;
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${selected}"]`)?.focus();
  },[selected,ym]);
  const inMonth=(iso:string)=>Number(iso.slice(5,7))-1===month;
  function select(iso:string,viaKeys=false){
    refocus.current=viaKeys;
    setSelected(iso);
    const d=new Date(iso+"T00:00");
    if(d.getFullYear()!==year||d.getMonth()!==month)setYm([d.getFullYear(),d.getMonth()]);
  }
  // Changing month only changes what's in view: the selected day stays the
  // one you last picked (so the panel below doesn't change under you), and
  // nothing in the new month is selected until you tap a day.
  function goMonth(delta:number){
    setYm(shiftMonth(year,month,delta));
  }
  // The one day Tab lands on: the selected day when it's in view, otherwise
  // today, otherwise the 1st of the month shown.
  const tabStop=days.includes(selected)?selected:days.includes(today)&&inMonth(today)?today:localDateStr(new Date(year,month,1));
  function onGridKey(e:React.KeyboardEvent){
    const step=({ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7} as Record<string,number>)[e.key];
    if(!step)return;
    e.preventDefault();
    // From the focused day, which isn't the selected one after a month change.
    const from=(e.target as HTMLElement).dataset?.day||selected;
    const d=new Date(from+"T00:00"); d.setDate(d.getDate()+step);
    select(localDateStr(d),true);
  }
  // Swipe left/right on the grid to change month.
  const swipeX=useRef<number|null>(null);
  const monthName=new Date(year,month,1).toLocaleDateString(undefined,{month:"long",year:"numeric"});
  const sortDay=(list:Task[])=>list.slice().sort((a,b)=>a.done!==b.done?(a.done?1:-1):(a.dueTime||"99").localeCompare(b.dueTime||"99")||a.order-b.order);
  const dayTasks=sortDay(due.get(selected)||[]);
  // Tapping a day also opens it as a floating card (DayDetail), growing out of
  // its cell. Arrow keys still only move the selection; Enter opens.
  const [openDay,setOpenDay]=useState<{iso:string;origin:HTMLElement}|null>(null);
  const openMins=dayTasks.filter(t=>!t.done).reduce((n,t)=>n+(t.estMins||0),0);
  const card={background:T.card,borderRadius:14,padding:"14px",border:`1px solid ${T.border}`};
  const navBtn={background:"none",border:`1px solid ${T.border}`,borderRadius:9,width:34,height:34,cursor:"pointer",color:T.text,fontSize:fz(16),display:"flex",alignItems:"center",justifyContent:"center",padding:0};
  const showToday=!(ym[0]===new Date(now).getFullYear()&&ym[1]===new Date(now).getMonth()&&selected===today);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={card}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
          <h2 aria-live="polite" style={{flex:1,margin:0,fontFamily:F.heading,fontWeight:400,fontSize:20,color:T.text}}>{monthName}</h2>
          {showToday&&<button onClick={()=>{setYm([new Date(now).getFullYear(),new Date(now).getMonth()]);setSelected(today);}} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:9,height:34,padding:"0 12px",cursor:"pointer",color:T.textMuted,fontFamily:F.body,fontSize:fz(11)}}>Today</button>}
          <button onClick={()=>goMonth(-1)} aria-label="Previous month" style={navBtn}>‹</button>
          <button onClick={()=>goMonth(1)} aria-label="Next month" style={navBtn}>›</button>
        </div>
        <div aria-hidden="true" style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4}}>
          {weekdayLabels(weekStart).map(l=><div key={l} style={{textAlign:"center",fontFamily:F.body,fontSize:fz(10),color:T.textFaint,textTransform:"uppercase",letterSpacing:"0.04em"}}>{l.slice(0,2)}</div>)}
        </div>
        {/* The fixed height (48px rows, 4px gaps) eases when a month needs a
            different number of rows, so the panel below slides instead of jumping.
            The 3px of padding (cancelled by the margin) leaves room for focus rings. */}
        <div style={{height:rows*48+(rows-1)*4+6,margin:-3,padding:3,boxSizing:"border-box",transition:"height .22s ease",overflow:"hidden"}}>
        <div ref={gridRef} key={`${year}-${month}`} className="sec-body" role="group" aria-label={`${monthName}, use arrow keys to move between days`} onKeyDown={onGridKey}
          onPointerDown={e=>{swipeX.current=e.clientX;}}
          onPointerUp={e=>{const x=swipeX.current;swipeX.current=null;if(x!=null&&Math.abs(e.clientX-x)>50)goMonth(e.clientX<x?1:-1);}}
          style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,touchAction:"pan-y"}}>
          {cells.map((iso,i)=>{
            if(iso==null)return <div key={`blank-${i}`} aria-hidden="true" style={{height:48}}/>;
            const list=due.get(iso)||[];
            const open=list.filter(t=>!t.done);
            const mins=open.reduce((n,t)=>n+(t.estMins||0),0);
            const isSel=iso===selected, isToday=iso===today, other=!inMonth(iso);
            const overdue=iso<today&&open.length>0;
            const label=new Date(iso+"T00:00").toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"})
              +(open.length?`, ${open.length} due${mins?`, ${formatDuration(mins)}`:""}`:"")+(overdue?", overdue":"");
            return(
              <button key={iso} data-day={iso} onClick={e=>{select(iso);setOpenDay({iso,origin:e.currentTarget});}} aria-haspopup="dialog" aria-label={label} aria-pressed={isSel} aria-current={isToday?"date":undefined} tabIndex={iso===tabStop?0:-1}
                style={{position:"relative",height:48,borderRadius:10,cursor:"pointer",padding:"5px 0 0",display:"flex",flexDirection:"column",alignItems:"center",gap:4,
                  background:"transparent",border:`${isSel?2:1}px solid ${isSel?T.accent:isToday?T.textMuted:"transparent"}`,opacity:other?0.4:1,color:T.text}}>
                <span style={{fontFamily:F.body,fontSize:fz(13),lineHeight:1,fontWeight:isToday?600:400,color:overdue?ink(priColor("high",colorCodeUrgency),T.light):T.text}}>{Number(iso.slice(8))}</span>
                <span aria-hidden="true" style={{display:"flex",gap:3,alignItems:"center",height:6}}>
                  {open.slice(0,3).map(t=><span key={t.id} style={{width:5,height:5,borderRadius:"50%",background:subjectColors[t.subject]||T.textMuted}}/>)}
                  {open.length>3&&<span style={{fontFamily:F.body,fontSize:fz(8),lineHeight:1,color:T.textMuted}}>+</span>}
                </span>
              </button>
            );
          })}
        </div>
        </div>
      </div>
      <div style={card}>
        <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:10,marginBottom:10}}>
          <div style={{fontFamily:F.heading,fontSize:fz(17),color:T.text}}>{selected===today?"Today":new Date(selected+"T00:00").toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"})}</div>
          {dayTasks.length>0&&<div style={{fontFamily:F.body,fontSize:fz(11),color:T.textMuted,flexShrink:0}}>{dayTasks.filter(t=>!t.done).length} due{openMins?` · ${formatDuration(openMins)}`:""}</div>}
        </div>
        {dayTasks.length===0
          ?<div style={{fontFamily:F.body,fontSize:fz(12),color:T.textFaint,marginBottom:10}}>Nothing due.</div>
          :<div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
            {dayTasks.map(t=>{
              const sc=subjectColors[t.subject]||T.accent;
              return(
                <div key={t.id} onClick={()=>onOpenTask(t)} style={{display:"flex",alignItems:"center",gap:10,background:T.surface,borderRadius:10,padding:"9px 11px",cursor:"pointer"}}>
                  <button aria-label={t.done?`Mark ${t.title} not done`:`Mark ${t.title} done`} onClick={e=>{e.stopPropagation();onToggleDone(t.id);}}
                    className="hit" style={{width:18,height:18,borderRadius:"50%",border:`2px solid ${t.done?"#2ED573":T.textFaint}`,background:t.done?"#2ED573":"none",cursor:"pointer",padding:0,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {t.done&&<CheckMark size={10}/>}
                  </button>
                  <span role="button" tabIndex={0} onKeyDown={activateOnKey} className={"title-btn"+(t.done?" strike":"")} aria-haspopup="dialog" style={{flex:1,minWidth:0,fontFamily:F.heading,fontSize:fz(14),color:t.done?T.textFaint:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</span>
                  {t.subject&&<span style={{background:sc+"22",color:ink(sc,T.light),borderRadius:999,padding:"2px 8px",fontFamily:F.body,fontSize:fz(10),flexShrink:0}}>{t.subject}</span>}
                  {t.dueTime&&<span style={{fontFamily:F.body,fontSize:fz(10),color:T.textMuted,flexShrink:0}}>{formatTime(t.dueTime,h24)}</span>}
                  {!t.dueTime&&t.estMins>0&&<span style={{fontFamily:F.body,fontSize:fz(10),color:T.textMuted,flexShrink:0}}>{formatDuration(t.estMins)}</span>}
                </div>
              );
            })}
          </div>}
        <button onClick={()=>onAddOn(selected)} style={{width:"100%",background:"none",border:`1px solid ${T.border}`,borderRadius:10,padding:"10px",cursor:"pointer",color:T.textMuted,fontFamily:F.body,fontSize:fz(12)}}>
          + Add homework due {selected===today?"today":new Date(selected+"T00:00").toLocaleDateString(undefined,{month:"short",day:"numeric"})}
        </button>
      </div>
      {openDay&&<DayDetail iso={openDay.iso} today={today} list={sortDay(due.get(openDay.iso)||[])} origin={openDay.origin}
        T={T} F={F} subjectColors={subjectColors} h24={h24}
        onOpenTask={onOpenTask} onToggleDone={onToggleDone} onAddOn={onAddOn}
        onClose={()=>{const o=openDay.origin;setOpenDay(null);requestAnimationFrame(()=>o.isConnected&&o.focus({preventScroll:true}));}}/>}
    </div>
  );
}

// The Calendar tab's Deck view: one card per date that has something due,
// with the date written large and that day's tasks under it (no add button here; adding is the Month view's job), stacked like a
// deck. Swipe the top card left for the next date and right for the one
// before (or use the arrows / arrow keys). A date is in the deck if it still
// has an open task, or is today or later. It opens on the first date from
// today on. Module scope like CalendarView, so the `now` tick doesn't reset
// which card you're on.
export function DueDeck({tasks,T,F,subjectColors,h24,now,onOpenTask,onToggleDone}:{
  tasks:Task[]; T:ThemeObj; F:typeof FONT; subjectColors:Record<string,string>;
  h24:boolean; now:number;
  onOpenTask:(t:Task)=>void; onToggleDone:(id:number)=>void;
}){
  const today=localDateStr(new Date(now));
  const due=byDueDate(tasks.filter(t=>!t.archived));
  const dates=[...due.keys()].filter(d=>d>=today||due.get(d)!.some(t=>!t.done)).sort();
  // The card on top is remembered by its date, not its position, so adding or
  // finishing tasks elsewhere doesn't move you to a different card.
  const [picked,setPicked]=useState<string|null>(null);
  const fallback=dates.find(d=>d>=today)??dates[dates.length-1];
  const current=picked&&dates.includes(picked)?picked:fallback;
  const idx=dates.indexOf(current);
  const topRef=useRef<HTMLDivElement>(null);
  const drag=useRef<{x:number;y:number;locked:boolean;samples:{t:number;y:number}[]}|null>(null);
  const moved=useRef(false);
  const leaving=useRef(false);
  const cameBack=useRef(false);
  const reduced=()=>window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Each card behind sits a little lower and narrower, scaled from its bottom
  // edge, so its rim shows under the one in front: a visible stack of edges
  // that tells you how many more cards there are (up to three).
  const depthTransform=(k:number)=>`translateY(${k*10}px) scale(${1-k*0.045})`;
  // Forward: the top card flies off to the left and the one under it rises.
  // Back: the earlier card comes back in from the left, on top.
  function go(delta:number):boolean{
    const next=dates[idx+delta];
    if(!next||leaving.current)return false;
    const el=topRef.current;
    if(delta<0||!el||reduced()){cameBack.current=delta<0;setPicked(next);return true;}
    leaving.current=true;
    const anim=el.animate([{transform:el.style.transform||depthTransform(0),opacity:1},{transform:"translateX(-120%) rotate(-10deg)",opacity:0}],{duration:220,easing:"cubic-bezier(.4,0,.8,.6)",fill:"forwards"});
    const done=()=>{leaving.current=false;setPicked(next);};
    anim.finished.then(done,done);
    return true;
  }
  useLayoutEffect(()=>{
    if(!cameBack.current)return;
    cameBack.current=false;
    if(reduced())return;
    topRef.current?.animate([{transform:"translateX(-120%) rotate(-10deg)",opacity:0},{transform:depthTransform(0),opacity:1}],{duration:260,easing:"cubic-bezier(.2,.8,.3,1)"});
  },[current]);
  function onDown(e:React.PointerEvent){
    if(leaving.current)return;
    moved.current=false;
    drag.current={x:e.clientX,y:e.clientY,locked:false,samples:[{t:e.timeStamp,y:e.clientX}]};
  }
  function onMove(e:React.PointerEvent){
    const d=drag.current, el=topRef.current;
    if(!d||!el)return;
    const dx=e.clientX-d.x, dy=e.clientY-d.y;
    if(!d.locked){
      if(Math.abs(dx)>=6&&Math.abs(dx)>Math.abs(dy)){d.locked=true;moved.current=true;el.setPointerCapture(e.pointerId);el.style.transition="none";}
      else if(Math.abs(dy)>=10){drag.current=null;return;} // scrolling the card's list or the page
      else return;
    }
    d.samples.push({t:e.timeStamp,y:e.clientX}); if(d.samples.length>8)d.samples.shift();
    // Follows the finger toward the next card; resists when there's nothing
    // that way, and when pulling right (the earlier card slides in over it).
    const x=dx<0&&idx<dates.length-1?dx:dx*0.3;
    el.style.transform=`translateX(${x}px) rotate(${x*0.04}deg)`;
  }
  function onUp(e:React.PointerEvent){
    const d=drag.current, el=topRef.current;
    drag.current=null;
    if(!d||!d.locked||!el)return;
    const dx=e.clientX-d.x, v=releaseVelocity(d.samples);
    const want=dx<=-70||(v<-600&&dx<-24)?1:dx>=70||(v>600&&dx>24)?-1:0;
    el.style.transition="";
    if(want===1&&go(1))return;
    el.style.transform=depthTransform(0);
    if(want===-1)go(-1);
  }
  function onCancel(){
    const el=topRef.current;
    if(drag.current?.locked&&el){el.style.transition="";el.style.transform=depthTransform(0);}
    drag.current=null;
  }
  const navBtn={background:"none",border:`1px solid ${T.border}`,borderRadius:9,width:38,height:38,cursor:"pointer",color:T.text,fontSize:fz(16),display:"flex",alignItems:"center",justifyContent:"center",padding:0};
  if(dates.length===0)return(
    <div style={{background:T.card,borderRadius:14,padding:"28px 16px",border:`1px solid ${T.border}`,textAlign:"center"}}>
      <div style={{fontFamily:F.heading,fontSize:20,color:T.text,marginBottom:6}}>Nothing due</div>
      <div style={{fontFamily:F.body,fontSize:fz(12),color:T.textFaint}}>Tasks with a due date show up here, one card per day.</div>
    </div>
  );
  const dayMs=(iso:string)=>new Date(iso+"T00:00:00").getTime();
  return(
    <div>
      <div role="group" aria-roledescription="deck" aria-label="Due dates, use the left and right arrow keys to move between days" tabIndex={0}
        onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(e.key==="ArrowRight"){e.preventDefault();go(1);}else if(e.key==="ArrowLeft"){e.preventDefault();go(-1);}}}
        style={{position:"relative",height:"min(540px,calc(100dvh - 300px))",minHeight:380,marginBottom:42,borderRadius:24}}>
        {dates.slice(idx,idx+4).map((iso,k)=>{
          const d=new Date(iso+"T00:00:00");
          const list=(due.get(iso)||[]).slice().sort((a,b)=>a.done!==b.done?(a.done?1:-1):(a.dueTime||"99").localeCompare(b.dueTime||"99")||a.order-b.order);
          const open=list.filter(t=>!t.done);
          const mins=open.reduce((n,t)=>n+(t.estMins||0),0);
          const diff=Math.round((dayMs(iso)-dayMs(today))/86400000);
          const rel=diff===0?"Today":diff===1?"Tomorrow":diff===-1?"Yesterday":diff>0?`In ${diff} days`:`${-diff} days ago`;
          const late=diff<0&&open.length>0;
          const top=k===0;
          return(
            <div key={iso} ref={top?topRef:undefined} aria-hidden={top?undefined:true} inert={top?undefined:true}
              {...(top?{onPointerDown:onDown,onPointerMove:onMove,onPointerUp:onUp,onPointerCancel:onCancel}:{})}
              style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",background:T.bg,border:`1px solid ${T.border}`,borderRadius:24,padding:"22px 20px 18px",
                boxShadow:T.light?"0 6px 16px rgba(0,0,0,0.10)":"0 6px 16px rgba(0,0,0,0.55)",transform:depthTransform(k),transformOrigin:"50% 100%",zIndex:4-k,
                transition:"transform .28s cubic-bezier(.2,.8,.3,1)",touchAction:"pan-y",userSelect:"none",WebkitUserSelect:"none",overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12}}>
                <div style={{minWidth:0}}>
                  <div style={{fontFamily:F.body,fontSize:fz(12),color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.12em"}}>{d.toLocaleDateString(undefined,{weekday:"long"})}</div>
                  <div style={{fontFamily:F.heading,fontSize:116,lineHeight:0.95,color:T.accent,fontVariantNumeric:"tabular-nums",margin:"4px 0 2px"}}>{d.getDate()}</div>
                  <div style={{fontFamily:F.heading,fontSize:22,color:T.text}}>{d.toLocaleDateString(undefined,{month:"long",year:"numeric"})}</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0,paddingTop:2}}>
                  <div style={{fontFamily:F.body,fontSize:fz(12),fontWeight:600,color:late?ink("#FF4757",T.light):T.text}}>{rel}{late?", overdue":""}</div>
                  <div style={{fontFamily:F.body,fontSize:fz(11),color:T.textMuted,marginTop:3}}>{open.length===0?"All done":`${open.length} due`}{mins?` · ${formatDuration(mins)}`:""}</div>
                </div>
              </div>
              <div style={{height:1,background:T.border,margin:"14px 0 12px"}}/>
              <div style={{flex:1,minHeight:0,overflowY:"auto",overscrollBehavior:"contain",display:"flex",flexDirection:"column",gap:6}}>
                {list.map(t=>{
                  const sc=subjectColors[t.subject]||T.accent;
                  return(
                    <div key={t.id} onClick={()=>{if(moved.current){moved.current=false;return;}onOpenTask(t);}} style={{display:"flex",alignItems:"center",gap:10,background:T.card,borderRadius:10,padding:"10px 11px",cursor:"pointer",flexShrink:0}}>
                      <button aria-label={t.done?`Mark ${t.title} not done`:`Mark ${t.title} done`} onClick={e=>{e.stopPropagation();onToggleDone(t.id);}}
                        className="hit" style={{width:18,height:18,borderRadius:"50%",border:`2px solid ${t.done?"#2ED573":T.textFaint}`,background:t.done?"#2ED573":"none",cursor:"pointer",padding:0,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {t.done&&<CheckMark size={10}/>}
                      </button>
                      <span role="button" tabIndex={0} onKeyDown={activateOnKey} className={"title-btn"+(t.done?" strike":"")} aria-haspopup="dialog" style={{flex:1,minWidth:0,fontFamily:F.heading,fontSize:fz(15),color:t.done?T.textFaint:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</span>
                      {t.subject&&<span style={{background:sc+"22",color:ink(sc,T.light),borderRadius:999,padding:"2px 8px",fontFamily:F.body,fontSize:fz(10),flexShrink:0}}>{t.subject}</span>}
                      {t.dueTime&&<span style={{fontFamily:F.body,fontSize:fz(10),color:T.textMuted,flexShrink:0}}>{formatTime(t.dueTime,h24)}</span>}
                      {!t.dueTime&&t.estMins>0&&<span style={{fontFamily:F.body,fontSize:fz(10),color:T.textMuted,flexShrink:0}}>{formatDuration(t.estMins)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <button onClick={()=>go(-1)} disabled={idx===0} aria-label="Earlier date" style={{...navBtn,opacity:idx===0?0.4:1,cursor:idx===0?"default":"pointer"}}>‹</button>
        <span aria-live="polite" style={{flex:1,textAlign:"center",fontFamily:F.body,fontSize:fz(11),color:T.textFaint}}>{idx+1} of {dates.length}</span>
        <button onClick={()=>go(1)} disabled={idx===dates.length-1} aria-label="Later date" style={{...navBtn,opacity:idx===dates.length-1?0.4:1,cursor:idx===dates.length-1?"default":"pointer"}}>›</button>
      </div>
    </div>
  );
}
