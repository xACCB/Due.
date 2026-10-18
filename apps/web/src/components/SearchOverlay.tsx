import { useState, useEffect, useLayoutEffect, useRef } from "react";
import type { Task } from "@dueplanner/core/types";
import { priColor } from "@dueplanner/core/constants";
import { searchTasks } from "@dueplanner/core/lib/taskViews";
import type { ThemeObj } from "@dueplanner/core/themes";
import { getPriority, daysUntil, ink } from "@dueplanner/core/lib/format";
import { FONT } from "@dueplanner/core/fonts";
import { IconSearch } from "./icons";
import { fz } from "../lib/textSize";

// Search as a floating panel: the search field lifts off the Tasks tab and
// floats up the middle of a blurred screen, and matching tasks (title, subject
// or tag) pop in under it as you type. Module scope, like TaskModal, so the
// once-a-second `now` tick doesn't remount it (and lose what's typed). `origin`
// is the field it flies out of and back into.
export function SearchOverlay({tasks,T,F,subjectColors,colorCodeUrgency,origin,onOpenTask,onClose}:{
  tasks:Task[]; T:ThemeObj; F:typeof FONT; subjectColors:Record<string,string>; colorCodeUrgency:boolean;
  origin:React.RefObject<HTMLButtonElement|null>;
  onOpenTask:(task:Task)=>void; onClose:()=>void;
}){
  const [query,setQuery]=useState("");
  const backdropRef=useRef<HTMLDivElement>(null), barRef=useRef<HTMLDivElement>(null);
  const resultsRef=useRef<HTMLDivElement>(null), inputRef=useRef<HTMLInputElement>(null);
  const closing=useRef(false);
  // The part of the screen actually visible -- on phones the keyboard covers
  // the bottom, and the bar should float in the middle of what's left.
  const [view,setView]=useState(()=>({h:window.visualViewport?.height??window.innerHeight,top:window.visualViewport?.offsetTop??0}));
  useEffect(()=>{
    const vv=window.visualViewport;
    if(!vv)return;
    const update=()=>setView({h:vv.height,top:vv.offsetTop});
    vv.addEventListener("resize",update);vv.addEventListener("scroll",update);
    return()=>{vv.removeEventListener("resize",update);vv.removeEventListener("scroll",update);};
  },[]);
  // The page underneath stays put while search is open: dragging on the
  // backdrop does nothing (the results list scrolls on its own).
  // (A layout effect, ahead of the fly-in below: hiding the page's scrollbar
  // shifts the layout, and the bar's landing spot must be measured after that.)
  useLayoutEffect(()=>{
    const backdrop=backdropRef.current;
    if(!backdrop)return;
    const stop=(e:TouchEvent)=>e.preventDefault();
    backdrop.addEventListener("touchmove",stop,{passive:false});
    const root=document.documentElement, before=root.style.overflow;
    root.style.overflow="hidden";
    return()=>{backdrop.removeEventListener("touchmove",stop);root.style.overflow=before;};
  },[]);
  // On a phone the keyboard slides up a moment after the bar has flown in,
  // which shrinks the visible area and used to move the bar a second time.
  // Until the keyboard is up, aim for where the bar will sit once it is.
  const keyboardComing=window.matchMedia("(pointer:coarse)").matches&&view.h>window.innerHeight*0.8;
  const aimH=keyboardComing?view.h*0.58:view.h;
  const q=query.trim().toLowerCase();
  const results=searchTasks(tasks,q);
  // Fly in from the field. A layout effect, so the first frame already shows
  // the bar at the field's spot, and focus lands inside the tap that opened
  // it (iOS only raises the keyboard for focus during a user gesture).
  useLayoutEffect(()=>{
    inputRef.current?.focus({preventScroll:true});
    const bar=barRef.current, from=origin.current?.getBoundingClientRect();
    if(!bar||!from||window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const to=bar.getBoundingClientRect();
    backdropRef.current?.animate([{opacity:0},{opacity:1}],{duration:260,easing:"ease-out"});
    bar.animate([
      {transform:`translate(${from.left-to.left}px,${from.top-to.top}px)`,height:`${from.height}px`,boxShadow:"0 0 0 rgba(0,0,0,0)"},
      {transform:"none",height:`${to.height}px`},
    ],{duration:440,easing:"cubic-bezier(.2,.9,.25,1)"});
  },[origin]);
  // Fly back into the field, then unmount.
  function close(){
    if(closing.current)return;
    closing.current=true;
    const bar=barRef.current, to=origin.current?.getBoundingClientRect();
    if(!bar||!to||window.matchMedia("(prefers-reduced-motion: reduce)").matches){onClose();return;}
    const from=bar.getBoundingClientRect();
    resultsRef.current?.animate([{opacity:1},{opacity:0}],{duration:140,fill:"forwards"});
    backdropRef.current?.animate([{opacity:1},{opacity:0}],{duration:280,easing:"ease-in",fill:"forwards"});
    const anim=bar.animate([
      {transform:"none",height:`${from.height}px`},
      {transform:`translate(${to.left-from.left}px,${to.top-from.top}px)`,height:`${to.height}px`,boxShadow:"0 0 0 rgba(0,0,0,0)"},
    ],{duration:300,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"});
    anim.finished.then(onClose,onClose);
  }
  function onKeyDown(e:React.KeyboardEvent){
    if(e.key==="Escape"){e.preventDefault();close();return;}
    if(e.key!=="ArrowDown"&&e.key!=="ArrowUp")return;
    // Arrow keys walk from the field through the results and back.
    const items=[inputRef.current,...(resultsRef.current?.querySelectorAll<HTMLElement>("[data-result]")??[])].filter(Boolean) as HTMLElement[];
    const i=items.indexOf(document.activeElement as HTMLElement);
    const next=items[Math.max(0,Math.min(items.length-1,i+(e.key==="ArrowDown"?1:-1)))];
    if(next){e.preventDefault();next.focus();}
  }
  // The typed text, marked where it matches the title.
  const highlight=(title:string)=>{
    const at=q?title.toLowerCase().indexOf(q):-1;
    if(at<0)return title;
    return <>{title.slice(0,at)}<mark style={{background:T.light?"rgba(0,0,0,0.1)":"rgba(255,255,255,0.18)",color:"inherit",borderRadius:3,padding:"0 1px"}}>{title.slice(at,at+q.length)}</mark>{title.slice(at+q.length)}</>;
  };
  return(
    <div role="dialog" aria-modal="true" aria-label="Search tasks" onKeyDown={onKeyDown}
      style={{position:"fixed",left:0,right:0,top:view.top,height:view.h,zIndex:900,display:"flex",justifyContent:"center",padding:`${Math.max(24,Math.round(aimH*0.34-28))}px 16px 16px`,transition:"padding-top .25s ease"}}>
      {/* Fixed to the whole screen (and past its edges, for overscroll), not to
          this box: the box follows the visible viewport above the keyboard, which
          left the rest of the page unblurred. */}
      <div ref={backdropRef} onClick={close} style={{position:"fixed",top:-200,bottom:-200,left:0,right:0,background:T.light?"rgba(245,245,245,0.8)":"rgba(0,0,0,0.74)",backdropFilter:"blur(18px)",WebkitBackdropFilter:"blur(18px)"}}/>
      <div style={{position:"relative",width:"min(548px,100%)",display:"flex",flexDirection:"column",gap:10,maxHeight:"100%"}}>
        <div ref={barRef} className="search-bar" style={{display:"flex",alignItems:"center",gap:9,height:54,flexShrink:0,overflow:"hidden",background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"0 8px 0 15px",color:T.textMuted,boxShadow:T.light?"0 12px 40px rgba(0,0,0,0.14)":"0 12px 40px rgba(0,0,0,0.55)"}}>
          <IconSearch/>
          <input ref={inputRef} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search tasks..." aria-label="Search tasks" enterKeyHint="search"
            onKeyDown={e=>{if(e.key==="Enter"&&results[0]){e.preventDefault();onOpenTask(results[0]);}}}
            style={{flex:1,minWidth:0,background:"none",border:"none",color:T.text,padding:"9px 0",fontFamily:F.body,fontSize:fz(16),outline:"none"}}/>
          <button onClick={close} style={{background:"none",border:"none",color:T.textMuted,cursor:"pointer",fontFamily:F.body,fontSize:fz(11),padding:"6px 7px"}}>Cancel</button>
        </div>
        <div ref={resultsRef} style={{display:"flex",flexDirection:"column",gap:6,overflowY:"auto",overscrollBehavior:"contain",minHeight:0,paddingBottom:8}}>
          {results.map((t,i)=>{
            const pr=getPriority(t.dueDate,t.estMins,t.priorityOverride);
            const sc=subjectColors[t.subject]||T.accent;
            return(
              <button key={t.id} data-result onClick={()=>onOpenTask(t)} className="search-pop"
                style={{animationDelay:`${Math.min(i,8)*35}ms`,display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"11px 13px",cursor:"pointer",color:T.text}}>
                <span aria-hidden="true" style={{width:7,height:7,borderRadius:"50%",background:t.done?T.textFaint:priColor(pr,colorCodeUrgency),flexShrink:0}}/>
                <span style={{flex:1,minWidth:0,fontFamily:F.heading,fontSize:fz(14),overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:t.done?T.textFaint:T.text,textDecoration:t.done?"line-through":"none"}}>{highlight(t.title)}</span>
                {t.subject&&<span style={{background:sc+"22",color:ink(sc,T.light),borderRadius:999,padding:"2px 8px",fontFamily:F.body,fontSize:fz(10),flexShrink:0}}>{t.subject}</span>}
                {!t.done&&t.dueDate&&<span style={{fontFamily:F.body,fontSize:fz(10),color:ink(priColor(pr,colorCodeUrgency),T.light),flexShrink:0}}>{daysUntil(t.dueDate)}</span>}
              </button>
            );
          })}
          <div aria-live="polite" style={{textAlign:"center",fontFamily:F.body,fontSize:fz(11),color:T.textMuted,padding:"6px 0"}}>
            {!q?"Type a title, subject or tag":results.length===0?`No tasks match "${query.trim()}"`:<span className="sr-only">{results.length} {results.length===1?"task":"tasks"} found</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
