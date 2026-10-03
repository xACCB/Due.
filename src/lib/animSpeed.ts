// The "Animation speed" setting (Settings -> Looks). The app's motion comes
// from three places: CSS transitions/animations (inline styles and the
// runtime stylesheet), element.animate() calls, and a few timers/springs.
// Rather than thread a multiplier through every duration, this sets the
// playback rate on animations as they start: element.animate() is wrapped
// once, and CSS transitions/animations are caught by their start events
// (which bubble to the document). Timers and springs that have to keep in
// step use scaledMs() / animationRate().
//
// 1 is normal, 2 is twice as fast, 0.5 half speed. Reduced motion is separate
// and still wins: those code paths skip animating altogether.

export const ANIM_SPEED={min:0.5,max:2,step:0.25};

let rate=1;
let installed=false;

export const animationRate=()=>rate;
// A wait that should last as long as an animation it's paired with.
export const scaledMs=(ms:number)=>ms/rate;

export function clampSpeed(value:unknown):number{
  const n=typeof value==="number"?value:Number(value);
  return Number.isFinite(n)?Math.min(ANIM_SPEED.max,Math.max(ANIM_SPEED.min,n)):1;
}

export function setAnimationSpeed(next:number){
  rate=clampSpeed(next);
  if(installed||typeof document==="undefined")return;
  installed=true;
  const native=Element.prototype.animate;
  Element.prototype.animate=function(this:Element,...args:Parameters<typeof native>){
    const animation=native.apply(this,args);
    if(rate!==1)animation.playbackRate=rate;
    return animation;
  };
  const retime=(e:Event)=>{
    if(rate===1||!(e.target instanceof Element))return;
    for(const a of e.target.getAnimations())if(a.playbackRate!==rate)a.playbackRate=rate;
  };
  document.addEventListener("transitionrun",retime,true);
  document.addEventListener("animationstart",retime,true);
}
