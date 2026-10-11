import { useState } from "react";
import type { Task } from "../types";
import type { ThemeObj } from "../themes";
import { ink } from "../lib/format";
import { SIDEBAR_TASK_CAP, dueShort } from "../lib/sidebarSubjects";
import type { SubjectGroup } from "../lib/sidebarSubjects";
import { FONT } from "../fonts";

// One row of the sidebar. Styled by .sb-row in the runtime css; `current` marks
// the screen being shown.
export function SidebarRow({icon,label,current,onClick,tour,children}:{icon:React.ReactNode;label:string;current?:boolean;onClick:()=>void;tour?:string;children?:React.ReactNode}){
  return(
    <button className="sb-row" data-tour={tour} onClick={onClick} aria-current={current?"page":undefined}>
      <span aria-hidden="true" style={{display:"flex",width:18,justifyContent:"center",flexShrink:0}}>{icon}</span>
      <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</span>
      {children}
    </button>
  );
}
// The sidebar's subject list (groups from subjectGroups()). Each subject is two
// buttons, as in Notion: the arrow unfolds its open tasks underneath, the name
// filters Home to that subject (`picked`; "" is the "No subject" group). An
// unfolded subject shows SIDEBAR_TASK_CAP tasks until "Show all" is pressed.
export function SidebarSubjects({groups,open,onToggleOpen,picked,onPick,onOpenTask,currentTaskId,subjectColors,today,T,F}:{
  groups:SubjectGroup<Task>[]; open:string[]; onToggleOpen:(name:string)=>void;
  picked:string|null; onPick:(name:string)=>void; onOpenTask:(t:Task)=>void; currentTaskId:number|null;
  subjectColors:Record<string,string>; today:string; T:ThemeObj; F:typeof FONT;
}){
  // Which unfolded subjects are showing every task. Not remembered.
  const [showAll,setShowAll]=useState<string[]>([]);
  if(groups.length===0)return null;
  return(
    <div data-tour="sidebar-subjects">
      <div className="sb-rule" aria-hidden="true"/>
      <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:".08em",padding:"4px 10px 6px"}}>Subjects</div>
      {groups.map(g=>{
        const label=g.name||"No subject";
        const isOpen=open.includes(g.name), all=showAll.includes(g.name);
        const shown=all?g.tasks:g.tasks.slice(0,SIDEBAR_TASK_CAP);
        const color=g.name?(subjectColors[g.name]||T.accent):T.textMuted;
        return(
          <div key={g.name}>
            <div style={{display:"flex",alignItems:"center"}}>
              <button onClick={()=>onToggleOpen(g.name)} aria-expanded={isOpen} aria-label={`${isOpen?"Hide":"Show"} ${label} tasks`} style={{background:"none",border:"none",color:T.textMuted,cursor:"pointer",padding:"8px 4px 8px 8px",borderRadius:8,display:"flex",flexShrink:0}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{transform:isOpen?"rotate(90deg)":"none",transition:"transform .2s ease-out"}}><polyline points="9,5 16,12 9,19"/></svg>
              </button>
              <button className="sb-row" onClick={()=>onPick(g.name)} aria-pressed={picked===g.name} title={`Show only ${label} on Home`} style={{flex:1,minWidth:0,padding:"8px 10px 8px 6px",gap:8}}>
                <span aria-hidden="true" style={{width:8,height:8,borderRadius:"50%",background:color,flexShrink:0}}/>
                <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</span>
                {g.tasks.length>0&&<span aria-label={`${g.tasks.length} to do`} style={{fontSize:11,color:T.textMuted,flexShrink:0}}>{g.tasks.length}</span>}
              </button>
            </div>
            {isOpen&&<div className="sec-body" style={{display:"flex",flexDirection:"column",gap:1,margin:"0 0 4px 13px",paddingLeft:9,borderLeft:`1px solid ${T.borderFaint}`}}>
              {g.tasks.length===0&&<div style={{fontFamily:F.body,fontSize:11,color:T.textFaint,padding:"6px 10px"}}>Nothing to do</div>}
              {shown.map(t=>{
                const due=dueShort(t.dueDate,today);
                return(
                  <button key={t.id} className="sb-row sb-task" onClick={()=>onOpenTask(t)} aria-current={t.id===currentTaskId?"page":undefined}>
                    <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</span>
                    {due&&<span style={{fontSize:10,flexShrink:0,color:due==="Overdue"?ink("#FF4757",T.light):T.textMuted}}>{due}</span>}
                  </button>
                );
              })}
              {g.tasks.length>SIDEBAR_TASK_CAP&&<button className="sb-row sb-task" onClick={()=>setShowAll(a=>all?a.filter(n=>n!==g.name):[...a,g.name])} style={{color:T.textMuted}}>{all?"Show fewer":`Show all ${g.tasks.length}`}</button>}
            </div>}
          </div>
        );
      })}
    </div>
  );
}
// The back button on the menu screens and the task page. The screen's name is
// in the page header (SCREEN_TITLES), so this is only the way back; the css
// hides it where the sidebar is showing.
export function ScreenHeader({onBack,T}:{title:string;onBack:()=>void;T:ThemeObj;F:typeof FONT}){
  return(
    <div className="screen-header" style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
      <button onClick={onBack} aria-label="Back to Home" style={{background:T.cardAlt,border:`1px solid ${T.border}`,color:T.text,fontSize:12,cursor:"pointer",padding:"6px 12px",borderRadius:9}}>‹ Home</button>
    </div>
  );
}
