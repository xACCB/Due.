import { useLayoutEffect, useRef } from "react";
import type { Task } from "@dueplanner/core/types";
import type { ThemeObj } from "@dueplanner/core/themes";
import { formatDate, formatTime, formatDuration, countdown, ink } from "@dueplanner/core/lib/format";
import { FONT } from "@dueplanner/core/fonts";
import { CheckMark } from "./icons";
import { activateOnKey, box, freezeBox, pin, unpin } from "../lib/dom";
import { fz } from "../lib/textSize";

// A card that grows out of whatever was tapped (`origin`) into the middle of
// a blurred screen, and shrinks back into it on close: the same motion an
// Inbox message uses (UpdateDetail). Shared by a Calendar day (DayDetail) and
// a Time left breakdown (TimeDetail). It draws its own close button, top
// right (it takes focus on open, and plays the exit before calling onClose),
// so content should leave about 28px free there.
export function GrowCard({origin,labelledBy,T,onClose,children}:{
  origin:HTMLElement|null; labelledBy:string; T:ThemeObj; onClose:()=>void;
  children:React.ReactNode;
}){
  const backdropRef=useRef<HTMLDivElement>(null), cardRef=useRef<HTMLDivElement>(null), bodyRef=useRef<HTMLDivElement>(null);
  const closeRef=useRef<HTMLButtonElement>(null);
  const closing=useRef(false);
  const openedFrom=useRef(origin);
  const reduced=()=>window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The page behind stays put while the card is open. A layout effect, and
  // declared before the one that measures the card: hiding the page's
  // scrollbar changes the layout width, and measuring first would aim the
  // opening animation at a spot the card then jumps away from.
  useLayoutEffect(()=>{
    const backdrop=backdropRef.current;
    const stop=(e:TouchEvent)=>e.preventDefault();
    backdrop?.addEventListener("touchmove",stop,{passive:false});
    const root=document.documentElement, before=root.style.overflow;
    root.style.overflow="hidden";
    return()=>{backdrop?.removeEventListener("touchmove",stop);root.style.overflow=before;};
  },[]);
  useLayoutEffect(()=>{
    closeRef.current?.focus({preventScroll:true});
    const card=cardRef.current, from=openedFrom.current?.getBoundingClientRect();
    if(!card||!from||reduced())return;
    const to=card.getBoundingClientRect();
    // Contents laid out once at the final size (see UpdateDetail).
    const thaw=bodyRef.current?freezeBox(bodyRef.current):null;
    pin(card,to);
    backdropRef.current?.animate([{opacity:0},{opacity:1}],{duration:280,easing:"ease-out"});
    const anim=card.animate([{...box(from),borderRadius:"10px"},{...box(to),borderRadius:"20px"}],{duration:400,easing:"cubic-bezier(.2,.9,.25,1)"});
    const release=()=>{if(!closing.current){thaw?.();unpin(card);}};
    anim.finished.then(release,release);
    bodyRef.current?.animate([{opacity:0},{opacity:0,offset:0.4},{opacity:1}],{duration:400,easing:"ease-out"});
  },[]);
  // Back into where it came from, dissolving as it lands (that element is
  // still there underneath); a plain fade if it's gone.
  function close(){
    if(closing.current)return;
    closing.current=true;
    const card=cardRef.current, to=origin?.isConnected?origin.getBoundingClientRect():null;
    if(!card||reduced()){onClose();return;}
    const from=card.getBoundingClientRect();
    card.getAnimations().forEach(a=>a.cancel());
    bodyRef.current?.getAnimations().forEach(a=>a.cancel());
    pin(card,from);
    backdropRef.current?.animate([{opacity:1},{opacity:0}],{duration:320,easing:"ease-out",fill:"forwards"});
    let anim:Animation;
    if(to&&to.width>0&&to.bottom>0&&to.top<window.innerHeight){
      const body=bodyRef.current;
      if(body)Object.assign(body.style,{width:`${body.offsetWidth}px`,height:`${body.offsetHeight}px`,flexShrink:"0",overflow:"hidden"});
      body?.animate([{opacity:1},{opacity:0}],{duration:180,easing:"ease-out",fill:"forwards"});
      card.animate([{opacity:1},{opacity:1,offset:0.3},{opacity:0}],{duration:320,easing:"linear",fill:"forwards"});
      anim=card.animate([{...box(from),borderRadius:"20px"},{...box(to),borderRadius:"10px"}],{duration:320,easing:"cubic-bezier(.32,.72,0,1)",fill:"forwards"});
    }else{
      anim=card.animate([{opacity:1,transform:"none"},{opacity:0,transform:"scale(.96)"}],{duration:200,easing:"ease-in",fill:"forwards"});
    }
    anim.finished.then(onClose,onClose);
  }
  return(
    <div role="dialog" aria-modal="true" aria-labelledby={labelledBy} data-keeps-menu onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();close();}}}
      style={{position:"fixed",inset:0,zIndex:900,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div ref={backdropRef} onClick={close} style={{position:"fixed",top:-200,bottom:-200,left:0,right:0,background:T.light?"rgba(245,245,245,0.55)":"rgba(0,0,0,0.5)",backdropFilter:"blur(14px)",WebkitBackdropFilter:"blur(14px)"}}/>
      <div ref={cardRef} style={{position:"relative",width:"min(460px,100%)",maxHeight:"100%",overflow:"hidden",background:T.bg,border:`1px solid ${T.border}`,borderRadius:20,boxShadow:T.light?"0 16px 48px rgba(0,0,0,0.16)":"0 16px 48px rgba(0,0,0,0.6)",display:"flex",flexDirection:"column"}}>
        <div ref={bodyRef} style={{padding:"20px 20px 18px",display:"flex",flexDirection:"column",minHeight:0}}>
          <button ref={closeRef} onClick={close} aria-label="Close" className="hit" style={{position:"absolute",top:16,right:14,zIndex:1,background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:20,lineHeight:1,padding:"2px 4px"}}>×</button>
          {children}
        </div>
      </div>
    </div>
  );
}

// One task as a row inside a GrowCard: check it off, tap to open, and a short
// note on the right (`note`), e.g. its time or how long it'll take.
export function CardTaskRow({t,T,F,subjectColors,note,onOpenTask,onToggleDone}:{
  t:Task; T:ThemeObj; F:typeof FONT; subjectColors:Record<string,string>; note?:string;
  onOpenTask:(t:Task)=>void; onToggleDone:(id:number)=>void;
}){
  const sc=subjectColors[t.subject]||T.accent;
  return(
    <div onClick={()=>onOpenTask(t)} style={{display:"flex",alignItems:"center",gap:10,background:T.card,borderRadius:10,padding:"10px 11px",cursor:"pointer",flexShrink:0}}>
      <button aria-label={t.done?`Mark ${t.title} not done`:`Mark ${t.title} done`} onClick={e=>{e.stopPropagation();onToggleDone(t.id);}}
        className="hit" style={{width:18,height:18,borderRadius:"50%",border:`2px solid ${t.done?"#2ED573":T.textFaint}`,background:t.done?"#2ED573":"none",cursor:"pointer",padding:0,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
        {t.done&&<CheckMark size={10}/>}
      </button>
      <span role="button" tabIndex={0} onKeyDown={activateOnKey} className={"title-btn"+(t.done?" strike":"")} aria-haspopup="dialog" style={{flex:1,minWidth:0,fontFamily:F.heading,fontSize:fz(15),color:t.done?T.textFaint:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</span>
      {t.subject&&<span style={{background:sc+"22",color:ink(sc,T.light),borderRadius:999,padding:"2px 8px",fontFamily:F.body,fontSize:fz(10),flexShrink:0}}>{t.subject}</span>}
      {note&&<span style={{fontFamily:F.body,fontSize:fz(10),color:T.textMuted,flexShrink:0}}>{note}</span>}
    </div>
  );
}

// A Calendar day, opened (tap a day in the month grid): the date, that day's
// tasks and the add button. `origin` is the day's cell.
export function DayDetail({iso,today,list,origin,T,F,subjectColors,h24,onOpenTask,onToggleDone,onAddOn,onClose}:{
  iso:string; today:string; list:Task[]; origin:HTMLElement|null;
  T:ThemeObj; F:typeof FONT; subjectColors:Record<string,string>; h24:boolean;
  onOpenTask:(t:Task)=>void; onToggleDone:(id:number)=>void; onAddOn:(date:string)=>void; onClose:()=>void;
}){
  const d=new Date(iso+"T00:00:00");
  const dayMs=(s:string)=>new Date(s+"T00:00:00").getTime();
  const diff=Math.round((dayMs(iso)-dayMs(today))/86400000);
  const rel=diff===0?"Today":diff===1?"Tomorrow":diff===-1?"Yesterday":diff>0?`In ${diff} days`:`${-diff} days ago`;
  const open=list.filter(t=>!t.done);
  const mins=open.reduce((n,t)=>n+(t.estMins||0),0);
  const late=diff<0&&open.length>0;
  return(
    <GrowCard origin={origin} labelledBy="day-detail-title" T={T} onClose={onClose}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,paddingRight:28}}>
        <div style={{minWidth:0}}>
          <div style={{fontFamily:F.body,fontSize:fz(11),color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.12em"}}>{d.toLocaleDateString(undefined,{weekday:"long"})}</div>
          <h2 id="day-detail-title" style={{margin:"4px 0 0",fontFamily:F.heading,fontWeight:400,fontSize:30,lineHeight:1.1,color:T.text}}>{d.toLocaleDateString(undefined,{month:"long",day:"numeric"})}</h2>
          <div style={{fontFamily:F.body,fontSize:fz(11),color:late?ink("#FF4757",T.light):T.textMuted,marginTop:6}}>
            {rel}{late?", overdue":""}{list.length>0?` · ${open.length===0?"all done":`${open.length} due`}${mins?` · ${formatDuration(mins)}`:""}`:""}
          </div>
        </div>
      </div>
      <div style={{height:1,background:T.border,margin:"14px 0 12px",flexShrink:0}}/>
      {list.length===0
        ?<div style={{fontFamily:F.body,fontSize:fz(12),color:T.textFaint,marginBottom:12}}>Nothing due.</div>
        :<div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12,overflowY:"auto",overscrollBehavior:"contain",minHeight:0}}>
          {list.map(t=><CardTaskRow key={t.id} t={t} T={T} F={F} subjectColors={subjectColors} onOpenTask={onOpenTask} onToggleDone={onToggleDone}
            note={t.dueTime?formatTime(t.dueTime,h24):formatDuration(t.estMins)}/>)}
        </div>}
      <button onClick={()=>onAddOn(iso)} style={{width:"100%",background:"none",border:`1px solid ${T.border}`,borderRadius:10,padding:"10px",cursor:"pointer",color:T.textMuted,fontFamily:F.body,fontSize:fz(12),flexShrink:0}}>
        + Add homework due {diff===0?"today":d.toLocaleDateString(undefined,{month:"short",day:"numeric"})}
      </button>
    </GrowCard>
  );
}

// A row of the Time left dropdown, opened: one due-date group or one subject
// in depth. Totals (time left, tasks, time already worked, how many have no
// estimate) and every open task in it, soonest first, each with when it's due
// and how long it should take. `origin` is the row that was tapped.
export function TimeDetail({title,kicker,color,list,origin,T,F,subjectColors,h24,now,onOpenTask,onToggleDone,onClose}:{
  title:string; kicker:string; color?:string; list:Task[]; origin:HTMLElement|null;
  T:ThemeObj; F:typeof FONT; subjectColors:Record<string,string>; h24:boolean; now:number;
  onOpenTask:(t:Task)=>void; onToggleDone:(id:number)=>void; onClose:()=>void;
}){
  const open=list.filter(t=>!t.done);
  const mins=open.reduce((n,t)=>n+(t.estMins||0),0);
  const worked=open.reduce((n,t)=>n+(t.sessions||[]).reduce((a,x)=>a+x.mins,0),0);
  const noEstimate=open.filter(t=>!t.estMins).length;
  const sorted=list.slice().sort((a,b)=>a.done!==b.done?(a.done?1:-1):(a.dueDate||"9999").localeCompare(b.dueDate||"9999")||(a.dueTime||"99").localeCompare(b.dueTime||"99")||a.order-b.order);
  const stat=(label:string,value:string)=>(
    <div style={{flex:1,minWidth:0,background:T.card,borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
      <div style={{fontFamily:F.heading,fontSize:fz(18),color:T.text,whiteSpace:"nowrap"}}>{value}</div>
      <div style={{fontFamily:F.body,fontSize:fz(9),color:T.textFaint,marginTop:2,textTransform:"uppercase",letterSpacing:"0.06em"}}>{label}</div>
    </div>
  );
  const noteFor=(t:Task)=>{
    const when=!t.dueDate?"Anytime":countdown(t.dueDate,t.dueTime,now)??`${formatDate(t.dueDate)}${t.dueTime?` ${formatTime(t.dueTime,h24)}`:""}`;
    return `${when} · ${formatDuration(t.estMins)||"no estimate"}`;
  };
  return(
    <GrowCard origin={origin} labelledBy="time-detail-title" T={T} onClose={onClose}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,paddingRight:28}}>
        <div style={{minWidth:0}}>
          <div style={{fontFamily:F.body,fontSize:fz(11),color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.12em"}}>{kicker}</div>
          <h2 id="time-detail-title" style={{margin:"4px 0 0",fontFamily:F.heading,fontWeight:400,fontSize:28,lineHeight:1.15,color:T.text,display:"flex",alignItems:"center",gap:10}}>
            {color&&<span aria-hidden="true" style={{width:12,height:12,borderRadius:"50%",background:color,flexShrink:0}}/>}
            <span style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis"}}>{title}</span>
          </h2>
        </div>
      </div>
      <div style={{display:"flex",gap:8,margin:"14px 0 0",flexShrink:0}}>
        {stat("Time left",formatDuration(mins)||"0m")}
        {stat(open.length===1?"Task":"Tasks",String(open.length))}
        {stat("Worked",formatDuration(worked)||"0m")}
      </div>
      {noEstimate>0&&<div style={{fontFamily:F.body,fontSize:fz(11),color:T.textMuted,marginTop:10,flexShrink:0}}>{noEstimate} {noEstimate===1?"task has":"tasks have"} no estimate, so the time left reads low.</div>}
      <div style={{height:1,background:T.border,margin:"14px 0 12px",flexShrink:0}}/>
      {sorted.length===0
        ?<div style={{fontFamily:F.body,fontSize:fz(12),color:T.textFaint}}>Nothing left here.</div>
        :<div style={{display:"flex",flexDirection:"column",gap:6,overflowY:"auto",overscrollBehavior:"contain",minHeight:0}}>
          {sorted.map(t=><CardTaskRow key={t.id} t={t} T={T} F={F} subjectColors={subjectColors} onOpenTask={onOpenTask} onToggleDone={onToggleDone} note={noteFor(t)}/>)}
        </div>}
    </GrowCard>
  );
}
