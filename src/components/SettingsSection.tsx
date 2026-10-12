import type { ThemeObj } from "../themes";
import { contrastColor, ink } from "../lib/format";
import { FONT } from "../fonts";

// One Settings section as a dropdown: the whole header row toggles it, and
// the body is only rendered while open. Which sections are open is
// kept only while Settings is on screen (openSettings). `tour` is the
// data-tour anchor "Take me there" highlights (see goTo).
export function SettingsSection({id,title,open,onToggle,T,F,tour,danger,gap=0,children}:{
  id:string; title:string; open:boolean; onToggle:(id:string)=>void; T:ThemeObj; F:typeof FONT;
  tour?:string; danger?:boolean; gap?:number; children:React.ReactNode;
}){
  const color=danger?ink("#FF4757",T.light):T.textMuted;
  return(
    <div data-tour={tour} style={{background:T.card,borderRadius:12,border:`1px solid ${danger?"#FF475744":T.border}`}}>
      <button onClick={()=>onToggle(id)} aria-expanded={open} aria-controls={`settings-${id}`}
        style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",background:"none",border:"none",cursor:"pointer",padding:"16px",borderRadius:12,WebkitTapHighlightColor:"transparent"}}>
        <span style={{color,fontFamily:F.body,fontSize:10,letterSpacing:".08em",textTransform:"uppercase"}}>{title}</span>
        <span aria-hidden="true" style={{color,fontSize:13,transform:open?"rotate(180deg)":"none",transition:"transform .2s ease-out",display:"inline-block"}}>⌄</span>
      </button>
      {open&&<div id={`settings-${id}`} className="sec-body" style={{display:"flex",flexDirection:"column",gap,padding:"0 16px 16px"}}>{children}</div>}
    </div>
  );
}

// Defined at module scope for the same reason as TaskModal above: it's
// rendered from several places (toggles in the Settings tab) and stability
// matters so it isn't torn down and recreated on every unrelated re-render.
export function Toggle({on,onChange,T,label}:{on:boolean;onChange:(v:boolean)=>void;T:ThemeObj;label:string}){
  const trackColor=on?T.accent:T.solidBorder;
  return <button className="tog hit hit-tog" role="switch" aria-checked={on} aria-label={label} onClick={()=>onChange(!on)} style={{background:trackColor}}>
    <span style={{position:"absolute",top:3,left:on?21:3,width:14,height:14,borderRadius:"50%",background:contrastColor(trackColor),boxShadow:"0 1px 3px rgba(0,0,0,0.4)",transition:"left .2s ease-out",display:"block"}}/>
  </button>;
}
