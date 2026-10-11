// Enter/Space activation for plain elements given role="button". Task titles
// and the reorder handle deliberately aren't <button>s: they sit in the path of
// swipe and drag gestures, and a real <button> there can swallow the touch on
// iOS Safari. click() bubbles to the card's own handler, same as a tap.
export function activateOnKey(e:React.KeyboardEvent<HTMLElement>){
  if(e.key==="Enter"||e.key===" "){e.preventDefault();e.currentTarget.click();}
}

// The sidebar is always there at this width and up (unless folded away); below
// it, it's a drawer. Must match the min-width in the runtime css.
export const isWideScreen=()=>window.matchMedia("(min-width:900px)").matches;

// "Take me there": once the destination has rendered, scrolls the element
// marked data-tour={anchor} into view, focuses it if it's a control, and rings
// it briefly. Retries for a moment, since the destination (Settings, a task
// sheet, Focus Mode) mounts after the state change that opens it. The ring is
// an inset shadow so an overflow:hidden parent (e.g. the title menu) can't clip it.
export function flashTarget(anchor:string,color:string,tries=20){
  const el=document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
  if(!el||!el.getClientRects().length){if(tries>0)setTimeout(()=>flashTarget(anchor,color,tries-1),60);return;}
  const reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({block:"center",behavior:reduce?"auto":"smooth"});
  if(el.matches("button,a,input,select,[tabindex]"))el.focus({preventScroll:true});
  el.animate([
    {boxShadow:`inset 0 0 0 0 ${color}00`},
    {boxShadow:`inset 0 0 0 2px ${color}`,offset:0.12},
    {boxShadow:`inset 0 0 0 2px ${color}`,offset:0.75},
    {boxShadow:`inset 0 0 0 0 ${color}00`},
  ],{duration:2000,easing:"ease-out"});
}

// A box as keyframe/style values, and pinning an element to one: UpdateDetail's
// card is normally centered by its flex container, so while its box animates
// it's pinned to fixed screen coordinates (else each width step would re-center
// it) and released after.
export const box=(r:DOMRect)=>({left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`,height:`${r.height}px`});
// Pinning writes over the card's own inline styles, so what they were is kept
// and put back on release. Clearing them instead lost the card's declared
// width ("min(460px,100%)"): on a wide screen it grew to its spot and then
// snapped to the full width of the window.
// Holds an element at the size it has now (its parent clips it), so its
// contents don't re-flow while the parent's box animates around it. Returns
// the undo, which puts back the inline styles exactly as they were.
export function freezeBox(el:HTMLElement){
  const was=el.style.cssText;
  Object.assign(el.style,{width:`${el.offsetWidth}px`,height:`${el.offsetHeight}px`,flexShrink:"0",overflow:"hidden"});
  return ()=>{el.style.cssText=was;};
}
const PIN_PROPS=["position","margin","left","top","width","height"] as const;
const pinnedStyles=new WeakMap<HTMLElement,Record<string,string>>();
export function pin(el:HTMLElement,r:DOMRect){
  if(!pinnedStyles.has(el))pinnedStyles.set(el,Object.fromEntries(PIN_PROPS.map(p=>[p,el.style[p]])));
  Object.assign(el.style,{position:"fixed",margin:"0",...box(r)});
}
export function unpin(el:HTMLElement){
  const was=pinnedStyles.get(el);
  pinnedStyles.delete(el);
  Object.assign(el.style,was??{position:"relative",margin:"",left:"",top:"",width:"",height:""});
}

// `new Notification()` throws on Android Chrome (pages there may only show
// notifications through a service worker), so fall back to the PWA's service
// worker registration. Best-effort either way.
export function notify(title:string,options?:NotificationOptions){
  try{ new Notification(title,options); }
  catch{ navigator.serviceWorker?.ready.then(reg=>reg.showNotification(title,options)).catch(()=>{}); }
}

// Short two-note chime for the end of a Pomodoro -- synthesized with Web Audio
// so there's no sound file to ship. Best-effort: silently does nothing if
// audio is unavailable or blocked.
export function playChime(){
  try{
    const Ctx=window.AudioContext||(window as unknown as {webkitAudioContext:typeof AudioContext}).webkitAudioContext;
    const ctx=new Ctx();
    [880,1320].forEach((freq,i)=>{
      const osc=ctx.createOscillator(), gain=ctx.createGain();
      osc.type="sine"; osc.frequency.value=freq;
      const start=ctx.currentTime+i*0.18;
      gain.gain.setValueAtTime(0.0001,start);
      gain.gain.exponentialRampToValueAtTime(0.25,start+0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001,start+0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start); osc.stop(start+0.55);
    });
    setTimeout(()=>{ctx.close().catch(()=>{});},1500);
  }catch{/* audio unavailable */}
}
