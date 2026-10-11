import { useLayoutEffect, useRef } from "react";
import type { WhatsNewItem } from "../whatsNew";
import type { ThemeObj } from "../themes";
import { contrastColor, longDate } from "../lib/format";
import { FONT } from "../fonts";
import { box, freezeBox, pin, unpin } from "../lib/dom";

// An Inbox update, opened: the row grows out of the menu into a card floating
// in the middle of a blurred screen (its box animates from the row's box to
// the card's, so nothing stretches), and shrinks back into the row on close.
// Back/Next step through the other updates in place. `origin` is the row
// element it grew from; module scope like SearchOverlay.
export function UpdateDetail({items,index,T,F,origin,onIndex,onDismiss,onClosing,onClose,onGo}:{
  items:WhatsNewItem[]; index:number; T:ThemeObj; F:typeof FONT;
  origin:HTMLElement|null;
  onIndex:(i:number)=>void; onDismiss:(id:string)=>void; onClosing:()=>void; onClose:()=>void;
  onGo:(dest:string)=>void;
}){
  const item=items[index];
  const backdropRef=useRef<HTMLDivElement>(null), cardRef=useRef<HTMLDivElement>(null), bodyRef=useRef<HTMLDivElement>(null);
  const closeRef=useRef<HTMLButtonElement>(null);
  const closing=useRef(false);
  const reduced=()=>window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Grow out of the row once, on open. `origin` changes with Back/Next (so
  // close shrinks into the row of the update being shown), but that mustn't
  // replay this -- it made every Back/Next look like the panel reloading.
  const openedFrom=useRef(origin);
  useLayoutEffect(()=>{
    closeRef.current?.focus({preventScroll:true});
    const card=cardRef.current, from=openedFrom.current?.getBoundingClientRect();
    if(!card||!from||reduced())return;
    const to=card.getBoundingClientRect();
    // The contents are laid out once, at the card's final size, and revealed as
    // it grows. Left to follow the growing box they re-wrapped on the way,
    // which showed as text hopping about while it faded in.
    const thaw=bodyRef.current?freezeBox(bodyRef.current):null;
    pin(card,to);
    backdropRef.current?.animate([{opacity:0},{opacity:1}],{duration:280,easing:"ease-out"});
    const anim=card.animate([{...box(from),borderRadius:"8px"},{...box(to),borderRadius:"16px"}],{duration:400,easing:"cubic-bezier(.2,.9,.25,1)"});
    const release=()=>{if(!closing.current){thaw?.();unpin(card);}};
    anim.finished.then(release,release);
    bodyRef.current?.animate([{opacity:0},{opacity:0,offset:0.4},{opacity:1}],{duration:400,easing:"ease-out"});
  },[]);
  // Back/Next swap the content in place: it fades in (it used to slide in from
  // the side too, which read as the headline moving twice; the user asked for
  // a plain fade), and the card eases to the new height from the one measured
  // just before the switch (see go()).
  const shown=useRef(index);
  const heightBefore=useRef<number|null>(null);
  function go(i:number){
    heightBefore.current=cardRef.current?.getBoundingClientRect().height??null;
    onIndex(i);
  }
  useLayoutEffect(()=>{
    const dir=Math.sign(index-shown.current);
    shown.current=index;
    const card=cardRef.current, from=heightBefore.current;
    heightBefore.current=null;
    if(!dir||!card||closing.current||window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const to=card.getBoundingClientRect().height;
    if(from!=null&&Math.abs(from-to)>=1)card.animate([{height:`${from}px`},{height:`${to}px`}],{duration:280,easing:"cubic-bezier(.2,.8,.3,1)"});
    bodyRef.current?.animate([{opacity:0},{opacity:1}],{duration:200,easing:"ease-out"});
  },[index]);
  // Back into the row -- or, when the row is gone (dismissed) or off screen, a fade.
  function close(dismissed=false){
    if(closing.current)return;
    closing.current=true;
    const card=cardRef.current, to=dismissed?null:origin?.getBoundingClientRect();
    // A dismissed update leaves the list only once the card is gone, or the
    // panel would unmount before its exit animation plays.
    const done=()=>{if(dismissed)onDismiss(item.id);onClose();};
    if(!card||reduced()){done();return;}
    const from=card.getBoundingClientRect();
    card.getAnimations().forEach(a=>a.cancel());
    bodyRef.current?.getAnimations().forEach(a=>a.cancel());
    pin(card,from);
    const intoRow=!!to&&to.width>0&&to.bottom>0&&to.top<window.innerHeight;
    backdropRef.current?.animate([{opacity:1},{opacity:0}],{duration:intoRow?340:200,easing:"ease-out",fill:"forwards"});
    let anim:Animation;
    if(intoRow){
      // One continuous move: the row is shown again underneath right away
      // (onClosing), and the card shrinks onto it while dissolving, so there's
      // nothing left to pop in when it lands. The text keeps its size and
      // wrapping (the body is frozen at its current box and clipped by the
      // card) instead of vanishing or re-flowing on the way.
      const body=bodyRef.current;
      if(body)Object.assign(body.style,{width:`${body.offsetWidth}px`,height:`${body.offsetHeight}px`,flexShrink:"0",overflow:"hidden"});
      onClosing();
      const ease="cubic-bezier(.32,.72,0,1)";
      body?.animate([{opacity:1},{opacity:0}],{duration:200,easing:"ease-out",fill:"forwards"});
      card.animate([{opacity:1},{opacity:1,offset:0.3},{opacity:0}],{duration:340,easing:"linear",fill:"forwards"});
      anim=card.animate([{...box(from),borderRadius:"16px"},{...box(to!),borderRadius:"8px"}],{duration:340,easing:ease,fill:"forwards"});
    } else {
      anim=card.animate([{opacity:1,transform:"none"},{opacity:0,transform:"scale(.96)"}],{duration:200,easing:"ease-in",fill:"forwards"});
    }
    anim.finished.then(done,done);
  }
  // "Take me there": a quick fade instead of shrinking back into the row,
  // since the destination opens as it goes.
  function goThere(dest:string){
    if(closing.current)return;
    closing.current=true;
    const card=cardRef.current;
    if(!card||reduced()){onGo(dest);return;}
    backdropRef.current?.animate([{opacity:1},{opacity:0}],{duration:180,easing:"ease-in",fill:"forwards"});
    const anim=card.animate([{opacity:1,transform:"none"},{opacity:0,transform:"scale(.97)"}],{duration:180,easing:"ease-in",fill:"forwards"});
    anim.finished.then(()=>onGo(dest),()=>onGo(dest));
  }
  if(!item)return null;
  const btn={background:"none",border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 12px",cursor:"pointer",color:T.textMuted,fontFamily:F.body,fontSize:12};
  return(
    <div role="dialog" aria-modal="true" aria-labelledby="update-detail-title" data-keeps-menu onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();close();}}}
      style={{position:"fixed",inset:0,zIndex:900,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div ref={backdropRef} onClick={()=>close()} style={{position:"absolute",inset:0,background:T.light?"rgba(245,245,245,0.55)":"rgba(0,0,0,0.5)",backdropFilter:"blur(14px)",WebkitBackdropFilter:"blur(14px)"}}/>
      <div ref={cardRef} style={{position:"relative",width:"min(460px,100%)",maxHeight:"100%",overflow:"hidden",background:T.card,border:`1px solid ${T.border}`,borderRadius:16,boxShadow:T.light?"0 16px 48px rgba(0,0,0,0.16)":"0 16px 48px rgba(0,0,0,0.6)",display:"flex",flexDirection:"column"}}>
        <div ref={bodyRef} style={{padding:"20px 20px 16px",display:"flex",flexDirection:"column",gap:14,overflowY:"auto"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
            <span style={{background:T.cardAlt,color:T.textMuted,border:`1px solid ${T.border}`,borderRadius:999,padding:"3px 10px",fontFamily:F.body,fontSize:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>{item.kind}</span>
            <button ref={closeRef} onClick={()=>close()} aria-label="Close" style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:20,lineHeight:1,padding:"2px 4px"}}>×</button>
          </div>
          <div>
            <h2 id="update-detail-title" style={{margin:0,fontFamily:F.heading,fontWeight:400,fontSize:26,lineHeight:1.15,color:T.text}}>{item.headline}</h2>
            <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginTop:6}}>{longDate(item.date)}</div>
          </div>
          <p style={{margin:0,fontFamily:F.body,fontSize:13,lineHeight:1.6,color:T.text}}>{item.description}</p>
          {item.list&&<div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>Finished</div>
            <ul style={{margin:0,paddingLeft:16,fontFamily:F.body,fontSize:12,lineHeight:1.6,color:T.text}}>
              {item.list.map((t,i)=><li key={i} style={{overflowWrap:"anywhere"}}>{t}</li>)}
            </ul>
          </div>}
          {item.where&&<div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>Where to find it</div>
            <div style={{fontFamily:F.body,fontSize:12,lineHeight:1.5,color:T.text}}>{item.where}</div>
            {item.go&&<button onClick={()=>goThere(item.go!)} style={{marginTop:10,background:"none",border:`1px solid ${T.accent}`,borderRadius:9,padding:"7px 12px",cursor:"pointer",color:T.accent,fontFamily:F.body,fontSize:12}}>Take me there →</button>}
          </div>}
          <div style={{display:"flex",alignItems:"center",gap:8,paddingTop:4}}>
            <button onClick={()=>go(index-1)} disabled={index===0} aria-label="Back to the previous message" style={{...btn,opacity:index===0?0.4:1,cursor:index===0?"default":"pointer"}}>‹ Back</button>
            <button onClick={()=>go(index+1)} disabled={index===items.length-1} aria-label="Next message" style={{...btn,opacity:index===items.length-1?0.4:1,cursor:index===items.length-1?"default":"pointer"}}>Next ›</button>
            <span style={{flex:1,textAlign:"center",fontFamily:F.body,fontSize:10,color:T.textFaint}}>{index+1} of {items.length}</span>
            <button onClick={()=>close(true)} style={{...btn,background:T.accent,border:"none",color:contrastColor(T.accent)}}>Dismiss</button>
          </div>
        </div>
      </div>
    </div>
  );
}
