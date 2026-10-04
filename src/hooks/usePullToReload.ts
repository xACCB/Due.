import { useEffect } from "react";

// Pull down at the very top of the page to reload. Only meant for the
// installed app (standalone), which has no browser pull-to-refresh of its
// own; in a browser tab the browser already does this. Reloading is safe at
// any moment: local state is in localStorage and Firestore keeps unsent
// writes queued.
//
// A pull only counts when it starts with the page scrolled to the top, on
// something that isn't itself scrollable, a dialog, or the reorder handle. The
// little pill that follows the finger is plain DOM, not React state, so a pull
// doesn't re-render the app per frame.
const THRESHOLD=90;

export function usePullToReload(enabled:boolean,bg:string,fg:string,border:string){
  useEffect(()=>{
    if(!enabled)return;
    let startY:number|null=null, pull=0, pill:HTMLDivElement|null=null;
    const atTop=()=>(document.scrollingElement?.scrollTop??window.scrollY)<=0;
    const blocked=(target:EventTarget|null)=>{
      for(let el=target instanceof Element?target:null;el&&el!==document.body;el=el.parentElement){
        if(el.matches("[role=dialog],[data-reorder],input,textarea,select"))return true;
        const oy=getComputedStyle(el).overflowY;
        if((oy==="auto"||oy==="scroll")&&el.scrollHeight>el.clientHeight)return true;
      }
      return false;
    };
    const hide=()=>{pill?.remove();pill=null;};
    const show=(dist:number)=>{
      if(!pill){
        pill=document.createElement("div");
        pill.setAttribute("role","status");
        Object.assign(pill.style,{position:"fixed",top:"0",left:"50%",zIndex:"2000",padding:"7px 14px",borderRadius:"999px",
          background:bg,color:fg,border:`1px solid ${border}`,font:"12px 'DM Mono',monospace",pointerEvents:"none",whiteSpace:"nowrap",boxShadow:"0 6px 20px rgba(0,0,0,0.25)"});
        document.body.appendChild(pill);
      }
      const ready=dist>=THRESHOLD;
      pill.textContent=ready?"Release to reload":"Pull to reload";
      pill.style.opacity=String(Math.min(1,dist/THRESHOLD));
      pill.style.transform=`translate(-50%,${Math.min(dist,THRESHOLD+30)*0.6-28}px)`;
    };
    const start=(e:TouchEvent)=>{
      pull=0;
      startY=e.touches.length===1&&atTop()&&!blocked(e.target)?e.touches[0].clientY:null;
    };
    const move=(e:TouchEvent)=>{
      if(startY==null)return;
      if(e.touches.length!==1||!atTop()){startY=null;pull=0;hide();return;}
      pull=e.touches[0].clientY-startY;
      if(pull>12)show(pull);else hide();
    };
    const end=()=>{
      const reload=startY!=null&&pull>=THRESHOLD;
      startY=null;pull=0;
      if(reload){if(pill)pill.textContent="Reloading…";window.location.reload();}
      else hide();
    };
    document.addEventListener("touchstart",start,{passive:true});
    document.addEventListener("touchmove",move,{passive:true});
    document.addEventListener("touchend",end);
    document.addEventListener("touchcancel",end);
    return()=>{
      document.removeEventListener("touchstart",start);
      document.removeEventListener("touchmove",move);
      document.removeEventListener("touchend",end);
      document.removeEventListener("touchcancel",end);
      hide();
    };
  },[enabled,bg,fg,border]);
}
