import type { Task } from "../types";
import { priColor } from "../constants";
import type { ThemeObj } from "../themes";
import { contrastColor, getPriority, formatDate, formatTime, daysUntil, formatDuration, countdown, ink } from "../lib/format";
import { FONT } from "../fonts";
import { CheckMark } from "./icons";
import { activateOnKey } from "../lib/dom";

// ─── TASK CARD (base) ────────────────────────────────────────────────────────
// Also module scope (see TaskModal above) -- MiniCard is rendered in a loop
// for every visible task across every layout, so being redefined (and every
// instance's DOM torn down/recreated) on each unrelated render was the most
// consequential case of this pattern in the file.
export function MiniCard({task,rank,reorderable,swipeable,T,F,subjectColors,colorCodeUrgency,now,h24,dragTaskId,dragOffsetY,onOpen,onToggleDone,onDelete,swipeClickGuard,swipeHandlers,swipeContentStyle,renderSwipeReveal,startDrag,onDragMove,endDrag,selectionMode,isSelected,onToggleSelect,justDone,onMoveBy}:{
  task:Task; rank:number; reorderable?:boolean; swipeable?:boolean;
  T:ThemeObj; F:typeof FONT; subjectColors:Record<string,string>; colorCodeUrgency:boolean; now:number; h24:boolean;
  dragTaskId:number|null; dragOffsetY:number;
  onOpen:(task:Task)=>void;
  onToggleDone:(id:number)=>void;
  onDelete:(id:number)=>void;
  swipeClickGuard:(onOpen:()=>void)=>()=>void;
  swipeHandlers:(id:number)=>{
    onPointerDown:(e:React.PointerEvent)=>void;
    onPointerMove:(e:React.PointerEvent)=>void;
    onPointerUp:()=>void;
    onPointerCancel:()=>void;
  };
  swipeContentStyle:(id:number)=>React.CSSProperties;
  renderSwipeReveal:(id:number)=>React.ReactNode;
  startDrag:(id:number,e:React.PointerEvent)=>void;
  onDragMove:(e:React.PointerEvent)=>void;
  endDrag:()=>void;
  selectionMode?:boolean; isSelected?:boolean; onToggleSelect?:(id:number)=>void;
  justDone?:boolean;
  onMoveBy?:(id:number,delta:number)=>void;
}) {
  const pr=getPriority(task.dueDate,task.estMins,task.priorityOverride);
  const sc=subjectColors[task.subject]||T.accent;
  const dm=countdown(task.dueDate,task.dueTime,now)??daysUntil(task.dueDate);
  // A task just checked off keeps its badge, drag handle and due label until
  // it settles (justDone), so the card doesn't change size, and shift its
  // neighbours, before the move.
  const live=!task.done||!!justDone;
  const isTop=rank===0&&live; const isNext=rank===1&&live;
  const isDragging=dragTaskId===task.id;
  return(
    <div
      className="tc"
      role="listitem"
      data-task-id={task.id}
      onClick={selectionMode?()=>onToggleSelect?.(task.id):swipeClickGuard(()=>{if(dragTaskId==null){onOpen(task);}})}
      {...(swipeable&&!selectionMode?swipeHandlers(task.id):{})}
      style={{background:isTop?T.gradientCard:T.card,borderRadius:13,padding:"13px 15px",border:`1px solid ${isSelected?T.accent:isTop?T.accent+"44":!live?"transparent":T.border}`,position:"relative",overflow:"hidden",cursor:"pointer",transform:isDragging?`translateY(${dragOffsetY}px) scale(1.02)`:"none",transition:isDragging?"none":undefined,boxShadow:isDragging?"0 8px 24px rgba(0,0,0,0.35)":undefined,zIndex:isDragging?10:undefined,touchAction:isDragging?"none":swipeable?"pan-y":undefined,pointerEvents:isDragging?"none":undefined}}>
      {swipeable&&!selectionMode&&renderSwipeReveal(task.id)}
      {live&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:priColor(pr,colorCodeUrgency),borderRadius:"13px 0 0 13px"}}/>}
      <div style={{paddingLeft:8,display:"flex",alignItems:"flex-start",gap:9,...(swipeable?swipeContentStyle(task.id):{})}}>
        {reorderable&&live&&!selectionMode&&(
          // Drag handle, and the keyboard way to reorder: focus it and use the
          // arrow keys. A div, not a <button> -- see activateOnKey.
          <div role="button" tabIndex={0} className="hit hit-grip" data-reorder aria-label={`Reorder ${task.title}`} title="Drag, or use the arrow keys"
            onClick={e=>e.stopPropagation()}
            onKeyDown={e=>{if(e.key==="ArrowUp"||e.key==="ArrowDown"){e.preventDefault();e.stopPropagation();onMoveBy?.(task.id,e.key==="ArrowUp"?-1:1);}}}
            onPointerDown={e=>{e.stopPropagation();startDrag(task.id,e);}}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{background:"none",border:"none",color:T.textFaint,cursor:isDragging?"grabbing":"grab",fontSize:14,lineHeight:1,marginTop:2,padding:"0 2px",touchAction:"none",flexShrink:0,fontFamily:"inherit"}}>
            <span aria-hidden="true">⠿</span>
          </div>
        )}
        <button aria-label={selectionMode?(isSelected?`Deselect ${task.title}`:`Select ${task.title}`):task.done?`Mark ${task.title} not done`:`Mark ${task.title} done`} onClick={e=>{e.stopPropagation();if(selectionMode){onToggleSelect?.(task.id);}else{onToggleDone(task.id);}}} style={{background:selectionMode?(isSelected?T.accent:"none"):task.done?"#2ED573":"none",border:`2px solid ${selectionMode?(isSelected?T.accent:T.textFaint):task.done?"#2ED573":T.textFaint}`,borderRadius:selectionMode?4:"50%",width:19,height:19,cursor:"pointer",flexShrink:0,marginTop:2,display:"flex",alignItems:"center",justifyContent:"center",padding:0,transition:"all .2s ease-out"}} className={justDone&&!selectionMode?"hit check-pop":"hit"}>
          {(selectionMode?isSelected:task.done)&&<CheckMark size={11} color={selectionMode?contrastColor(T.accent):"#111"} animate={justDone&&!selectionMode}/>}
        </button>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
            {isTop&&<span className="rb" style={{background:T.accent+"33",color:T.accent}}>do first</span>}
            {isNext&&<span className="rb" style={{background:T.text+"11",color:T.text}}>next up</span>}
            <span role="button" tabIndex={0} onKeyDown={activateOnKey} className={"title-btn"+(task.done?(justDone?" strike strike-anim":" strike"):"")} aria-haspopup={selectionMode?undefined:"dialog"} style={{fontFamily:F.heading,fontSize:15,color:task.done?T.textFaint:T.text,transition:"color .2s ease-out"}}>{task.title}</span>
            {task.recurrence&&task.recurrence!=="none"&&<span title={`Repeats ${task.recurrence}`} style={{color:T.textMuted,fontSize:12}}>↻</span>}
            {task.subject&&<span style={{background:sc+"22",color:ink(sc,T.light),borderRadius:999,padding:"2px 8px",fontFamily:F.body,fontSize:10}}>{task.subject}</span>}
            {task.priorityOverride&&<span className="rb" title="Priority set manually" style={{background:priColor(task.priorityOverride,colorCodeUrgency)+"22",color:ink(priColor(task.priorityOverride,colorCodeUrgency),T.light)}}>{task.priorityOverride}</span>}
            {task.tags?.map(tag=><span key={tag} style={{color:T.textMuted,fontFamily:F.body,fontSize:10}}>#{tag}</span>)}
          </div>
          <div style={{display:"flex",gap:12,marginTop:4,flexWrap:"wrap"}}>
            {task.dueDate&&<span style={{fontFamily:F.body,fontSize:11,color:T.textMuted}}>{formatDate(task.dueDate)}{task.dueTime?` ${formatTime(task.dueTime,h24)}`:""}</span>}
            {task.estMins>0&&<span style={{fontFamily:F.body,fontSize:11,color:T.textMuted}}>{formatDuration(task.estMins)}</span>}
            {live&&dm&&<span style={{fontFamily:F.body,fontSize:11,color:ink(priColor(pr,colorCodeUrgency),T.light),fontWeight:500}}>{dm}</span>}
          </div>
          {!!task.subtasks?.length&&(
            <div style={{display:"flex",alignItems:"center",gap:6,marginTop:5}}>
              <div style={{flex:1,maxWidth:80,height:4,background:T.border,borderRadius:999}}>
                <div style={{width:`${Math.round(task.subtasks.filter(s=>s.done).length/task.subtasks.length*100)}%`,height:"100%",background:T.accent,borderRadius:999,transition:"width 0.3s"}}/>
              </div>
              <span style={{fontFamily:F.body,fontSize:10,color:T.textFaint}}>{task.subtasks.filter(s=>s.done).length}/{task.subtasks.length}</span>
            </div>
          )}
        </div>
        {!selectionMode&&<button className="hit" aria-label={`Delete ${task.title}`} style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:15,padding:"2px 5px",lineHeight:1}} onClick={e=>{e.stopPropagation();onDelete(task.id);}}>×</button>}
      </div>
    </div>
  );
}
