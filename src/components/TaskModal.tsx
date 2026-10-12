import { useState, useEffect, useLayoutEffect, useRef } from "react";
import type { Priority, Recurrence, Subtask, Task } from "../types";
import { priColor } from "../constants";
import type { SnoozeKind } from "../lib/tasks";
import type { ThemeObj } from "../themes";
import { localDateStr, todayISO } from "../lib/dates";
import { nextId } from "../lib/id";
import { animationRate } from "../lib/animSpeed";
import { contrastColor, getPriority, formatDate, formatTime, formatDuration, countdown, ink } from "../lib/format";
import { stepSpring, springSettled, rubberBand, releaseVelocity, shouldDismiss } from "../lib/spring";
import { LIMITS } from "../lib/limits";
import { FONT } from "../fonts";
import { fz } from "../lib/textSize";

// ─── TASK SESSION MODAL ───────────────────────────────────────────────────────
// Defined at module scope (not nested in HomeworkPlanner) so its identity stays
// stable across renders -- otherwise the session timer's once-a-second tick
// would redefine this as a "new" component each time, forcing React to unmount
// and remount the whole modal (replaying its entrance animation) every second.
// What TaskModal's editable fields hold while being edited. The estimate is kept
// as typed text (see the note at `draft` in TaskModal).
type TaskDraft={title:string;subject:string;dueDate:string;dueTime:string;estH:string;estM:string;recurrence:Recurrence};
function taskDraft(task:Task):TaskDraft{
  return {title:task.title,subject:task.subject,dueDate:task.dueDate,dueTime:task.dueTime,
    estH:task.estMins>=60?String(Math.floor(task.estMins/60)):"",estM:task.estMins%60?String(task.estMins%60):"",recurrence:task.recurrence||"none"};
}
// `page`: shown as a whole screen (a task opened from the sidebar) instead of a
// bottom sheet. No overlay, focus trap or drag, and no Edit button: the fields
// are always there and save as you go (see commitDraft).
export function TaskModal({page,task,T,F,subjects,subjectColors,colorCodeUrgency,now,h24,sessionActive,sessionSecs,allTags,onClose,onStartSession,onEndSession,onToggleDone,onDelete,onUpdateSubtasks,onArchive,onRestore,onDuplicate,onUpdateTask,onSnooze,onSkipOccurrence,onSetPriorityOverride,onSetTags,onSaveAsTemplate}:{
  page?:boolean;
  task:Task; T:ThemeObj; F:typeof FONT; subjects:string[]; subjectColors:Record<string,string>; colorCodeUrgency:boolean; now:number; h24:boolean;
  sessionActive:boolean; sessionSecs:number;
  allTags:string[];
  onClose:()=>void; onStartSession:()=>void; onEndSession:()=>void; onToggleDone:()=>void; onDelete:()=>void;
  onUpdateSubtasks:(subtasks:Subtask[])=>void; onArchive:()=>void; onRestore:()=>void; onDuplicate:()=>void;
  onUpdateTask:(patch:Partial<Task>)=>void; onSnooze:(kind:SnoozeKind)=>void; onSkipOccurrence:()=>void;
  onSetPriorityOverride:(override:Priority|null)=>void; onSetTags:(tags:string[])=>void;
  onSaveAsTemplate:(name:string)=>void;
}){
  const pr=getPriority(task.dueDate,task.estMins,task.priorityOverride);
  const sc=subjectColors[task.subject]||T.accent;
  const sh=Math.floor(sessionSecs/3600); const sm=Math.floor(sessionSecs/60)%60; const ss=sessionSecs%60;
  const today=todayISO();
  const sessionHistory=(task.sessions||[]).filter(s=>localDateStr(new Date(s.at))===today)
    .map(s=>{const d=new Date(s.at);return {mins:s.mins,date:formatTime(`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`,h24)};});
  const totalSessionMins=sessionHistory.reduce((a,b)=>a+b.mins,0);
  const subtasks=task.subtasks||[];
  const [newSubtaskText,setNewSubtaskText]=useState("");
  function addSubtask(){
    const text=newSubtaskText.trim();
    if(!text||subtasks.length>=LIMITS.subtasks)return; // firestore.rules caps the list
    onUpdateSubtasks([...subtasks,{id:String(nextId()),text,done:false}]);
    setNewSubtaskText("");
  }
  const tags=task.tags||[];
  const [newTagText,setNewTagText]=useState("");
  // Editing the task's own fields (title, subject, due date/time, estimate,
  // repeat) -- previously these could only be set while adding a task.
  // The estimate is kept as the typed text (digits only, may be empty mid-edit)
  // and only turned into minutes on save; minutes past 59 roll into hours.
  const [draft,setDraft]=useState<TaskDraft|null>(()=>page?taskDraft(task):null);
  const draftEstMins=draft?Math.min(LIMITS.estMins,(parseInt(draft.estH,10)||0)*60+(parseInt(draft.estM,10)||0)):0;
  function startEdit(){setDraft(taskDraft(task));}
  // As a page the fields are always open, so they follow the task: whenever its
  // saved values change (our own save, an undo, another device), the fields are
  // refilled from it. Adjusted while rendering, React's pattern for state that
  // tracks a changed value.
  const taskSig=`${task.title}\n${task.subject}\n${task.dueDate}\n${task.dueTime}\n${task.estMins}\n${task.recurrence||"none"}`;
  const [draftSig,setDraftSig]=useState(taskSig);
  if(page&&taskSig!==draftSig){setDraftSig(taskSig);setDraft(taskDraft(task));}
  // The page's way of saving: there's no Save button, so a field saves when you
  // leave it (or at once, for a choice). Saves only a real change, so tabbing
  // through the fields doesn't fill the undo history; with nothing to save the
  // fields are reset to the task (an emptied title comes back).
  function commitDraft(d:TaskDraft|null=draft){
    if(!d)return;
    const next={title:d.title.trim()||task.title,subject:d.subject,dueDate:d.dueDate,dueTime:d.dueDate?d.dueTime:"",
      estMins:Math.min(LIMITS.estMins,(parseInt(d.estH,10)||0)*60+(parseInt(d.estM,10)||0)),recurrence:d.recurrence};
    const same=next.title===task.title&&next.subject===task.subject&&next.dueDate===task.dueDate&&next.dueTime===(task.dueTime||"")
      &&next.estMins===task.estMins&&next.recurrence===(task.recurrence||"none");
    if(same)setDraft(taskDraft(task));else onUpdateTask(next);
  }
  function saveEdit(){
    if(!draft)return;
    onUpdateTask({title:draft.title.trim()||task.title,subject:draft.subject,dueDate:draft.dueDate,
      dueTime:draft.dueDate?draft.dueTime:"",estMins:draftEstMins,recurrence:draft.recurrence});
    setDraft(null);
  }
  // Inline "name this template" field (replaces a browser prompt() dialog).
  const [templateName,setTemplateName]=useState<string|null>(null);
  const [templateSaved,setTemplateSaved]=useState(false);
  function addTag(){
    const t=newTagText.trim();
    if(!t||tags.includes(t)||tags.length>=LIMITS.tags)return; // firestore.rules caps the list
    onSetTags([...tags,t]);
    setNewTagText("");
  }
  // Focus trap + focus-return: a custom div-based modal gets neither for free
  // the way a native <dialog> would. On open, move focus in and cycle
  // Tab/Shift+Tab between the panel's first/last focusable elements so
  // keyboard users can't tab out to the page underneath; on close, restore
  // focus to whatever opened the modal instead of losing it to <body>.
  //
  // The mount/unmount effect below intentionally runs once ([] deps) so it
  // doesn't re-steal focus into the first element on every unrelated
  // re-render (e.g. the session timer ticking) -- sessionActive/onClose are
  // read through refs instead, kept current by this separate effect, so
  // Escape always sees the latest sessionActive rather than whatever it was
  // when the modal first opened.
  const sessionActiveRef=useRef(sessionActive);
  const onCloseRef=useRef(onClose);
  useEffect(()=>{sessionActiveRef.current=sessionActive;onCloseRef.current=onClose;});
  const panelRef=useRef<HTMLDivElement>(null);
  // Whatever opened the modal, captured in a layout effect: the page behind is
  // made inert in the same commit, and the browser blurs anything focused
  // inside an inert subtree before a regular effect would get to look. Kept on
  // a re-run (StrictMode's dev double-mount), when focus is already inside.
  const openerRef=useRef<HTMLElement|null>(null);
  useLayoutEffect(()=>{if(!openerRef.current)openerRef.current=document.activeElement as HTMLElement|null;},[]);
  useEffect(()=>{
    if(page)return; // a page isn't a dialog: nothing to trap or hand back
    const previouslyFocused=openerRef.current;
    const focusableSelector='button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    panelRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    function handleKeyDown(e:KeyboardEvent){
      if(e.key==="Escape"&&!sessionActiveRef.current){onCloseRef.current();return;}
      if(e.key!=="Tab"||!panelRef.current)return;
      const els=Array.from(panelRef.current.querySelectorAll<HTMLElement>(focusableSelector)).filter(el=>!el.hasAttribute("disabled"));
      if(els.length===0)return;
      const first=els[0], last=els[els.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
    document.addEventListener("keydown",handleKeyDown);
    return ()=>{document.removeEventListener("keydown",handleKeyDown);previouslyFocused?.focus();};
  },[page]);
  // Drag the top handle to move the sheet, like a native bottom sheet: it
  // follows the finger (with rubber-band resistance if pulled up), the backdrop
  // fades as it goes, and on release it springs back into place or -- if dragged
  // far enough or flicked -- flies off the bottom and closes, keeping the
  // finger's speed either way (physics in src/lib/spring.ts). Driven through
  // refs and direct style writes, not state, so a drag doesn't re-render the
  // whole modal every frame. Declared below onCloseRef on purpose (see the
  // React Compiler note in CLAUDE.md about forward references).
  const sheetRef=useRef<HTMLDivElement>(null);
  const overlayRef=useRef<HTMLDivElement>(null);
  const sheetDrag=useRef<{startY:number;samples:{t:number;y:number}[]}|null>(null);
  const sheetY=useRef(0);
  const sheetAnim=useRef(0);
  function setSheetY(y:number){
    sheetY.current=y;
    if(sheetRef.current)sheetRef.current.style.transform=y?`translateY(${y}px)`:"";
    const h=sheetRef.current?.offsetHeight||window.innerHeight;
    if(overlayRef.current)overlayRef.current.style.background=`rgba(0,0,0,${(0.53*(1-Math.min(1,Math.max(0,y)/h))).toFixed(3)})`;
  }
  function releaseSheet(vel:number,dismiss:boolean){
    cancelAnimationFrame(sheetAnim.current);
    if(window.matchMedia("(prefers-reduced-motion: reduce)").matches){if(dismiss)onCloseRef.current();else setSheetY(0);return;}
    const h=sheetRef.current?.offsetHeight||window.innerHeight;
    let v=dismiss?Math.max(vel,1400):vel, last=performance.now();
    const frame=(now:number)=>{
      const dt=Math.min(0.05,(now-last)/1000); last=now;
      if(dismiss){
        v+=4000*dt; // keeps accelerating off the screen
        const y=sheetY.current+v*dt; setSheetY(y);
        if(y>=h){onCloseRef.current();return;}
      }else{
        // zeta 1: settles without overshooting. The speed has to carry over from
        // frame to frame (v=st.vel): without it the sheet stalled part-way back.
        const st=stepSpring(sheetY.current,v,0,dt*animationRate(),380,1);
        v=st.vel;
        if(springSettled(st.pos,st.vel,0)){setSheetY(0);return;}
        setSheetY(st.pos);
      }
      sheetAnim.current=requestAnimationFrame(frame);
    };
    sheetAnim.current=requestAnimationFrame(frame);
  }
  useEffect(()=>()=>cancelAnimationFrame(sheetAnim.current),[]);
  // On a touch screen the whole sheet is the handle, like an iOS sheet: pull
  // down anywhere on it and it follows the finger, as long as its content is
  // scrolled to the top (otherwise the pull scrolls the content back up, and a
  // second pull moves the sheet). Touch events with a non-passive touchmove,
  // not pointer events: the browser cancels a pointer the moment it starts
  // scrolling, and preventDefault here is what stops it scrolling the page
  // instead. The page behind is scroll-locked while the sheet is open, and a
  // drag on the dimmed backdrop does nothing. Fields and the handle itself
  // (which has its own pointer handlers, for a mouse) are left alone.
  const sheetApi=useRef({setSheetY,releaseSheet});
  useEffect(()=>{sheetApi.current={setSheetY,releaseSheet};});
  useEffect(()=>{
    const panel=panelRef.current, overlay=overlayRef.current;
    if(!panel||!overlay)return;
    let start:{x:number;y:number;base:number}|null=null, dragging=false, samples:{t:number;y:number}[]=[];
    const onStart=(e:TouchEvent)=>{
      dragging=false; start=null;
      if(sessionActiveRef.current||e.touches.length!==1)return;
      if((e.target as Element|null)?.closest?.("input,textarea,select,[data-sheet-handle]"))return;
      cancelAnimationFrame(sheetAnim.current); // catch the sheet mid-spring
      start={x:e.touches[0].clientX,y:e.touches[0].clientY,base:sheetY.current};
      samples=[{t:e.timeStamp,y:e.touches[0].clientY}];
    };
    const onMove=(e:TouchEvent)=>{
      if(!start)return;
      const t=e.touches[0], dy=t.clientY-start.y, dx=t.clientX-start.x;
      if(!dragging){
        if(Math.abs(dy)<6&&Math.abs(dx)<6)return;
        if(dy>0&&Math.abs(dy)>=Math.abs(dx)&&panel.scrollTop<=0)dragging=true;
        else{
          // Not a pull on the sheet. If the content has nowhere to scroll, stop
          // the gesture from scrolling the page behind instead.
          if(panel.scrollHeight<=panel.clientHeight&&e.cancelable)e.preventDefault();
          if(start.base>0)sheetApi.current.releaseSheet(0,false);
          start=null;return;
        }
      }
      if(e.cancelable)e.preventDefault();
      samples.push({t:e.timeStamp,y:t.clientY}); if(samples.length>8)samples.shift();
      sheetApi.current.setSheetY(Math.max(0,start.base+dy));
    };
    const onEnd=()=>{
      const was=dragging, had=start;
      dragging=false; start=null;
      if(!was){if(had&&had.base>0)sheetApi.current.releaseSheet(0,false);return;}
      const v=releaseVelocity(samples);
      sheetApi.current.releaseSheet(v,shouldDismiss(sheetY.current,v));
    };
    const onBackdrop=(e:TouchEvent)=>{if(e.target===overlay&&e.cancelable)e.preventDefault();};
    panel.addEventListener("touchstart",onStart,{passive:true});
    panel.addEventListener("touchmove",onMove,{passive:false});
    panel.addEventListener("touchend",onEnd);
    panel.addEventListener("touchcancel",onEnd);
    overlay.addEventListener("touchmove",onBackdrop,{passive:false});
    const root=document.documentElement, before=root.style.overflow;
    root.style.overflow="hidden";
    return()=>{
      panel.removeEventListener("touchstart",onStart);
      panel.removeEventListener("touchmove",onMove);
      panel.removeEventListener("touchend",onEnd);
      panel.removeEventListener("touchcancel",onEnd);
      overlay.removeEventListener("touchmove",onBackdrop);
      root.style.overflow=before;
    };
  },[]);
  // The content, without the sheet around it, so the page can show it as is.
  const content=(
        <div style={{padding:page?"8px 0 32px":"12px 20px 32px"}}>
          {/* Task header */}
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16}}>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:6}}>
                {task.subject&&<span style={{background:sc+"22",color:ink(sc,T.light),borderRadius:999,padding:"3px 10px",fontFamily:F.body,fontSize:fz(11)}}>{task.subject}</span>}
                {!task.done&&<span style={{background:priColor(pr,colorCodeUrgency)+"22",color:ink(priColor(pr,colorCodeUrgency),T.light),borderRadius:999,padding:"3px 10px",fontFamily:F.body,fontSize:fz(11)}}>{pr[0].toUpperCase()+pr.slice(1)} priority{task.priorityOverride?" (set manually)":""}</span>}
                {task.done&&<span style={{background:"#2ED57322",color:ink("#2ED573",T.light),borderRadius:999,padding:"3px 10px",fontFamily:F.body,fontSize:fz(11)}}>✓ Done</span>}
              </div>
              {page&&draft
                ?<input value={draft.title} maxLength={500} aria-label="Title" onChange={e=>setDraft({...draft,title:e.target.value})} onBlur={()=>commitDraft()} onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur();}}
                  style={{display:"block",width:"100%",boxSizing:"border-box",background:"none",border:"none",borderBottom:`1px solid ${T.borderFaint}`,borderRadius:0,outline:"none",padding:"2px 0 6px",fontFamily:F.heading,fontSize:26,color:T.text,lineHeight:1.2}}/>
                :<div style={{fontFamily:F.heading,fontSize:22,color:T.text,lineHeight:1.2}}>{task.title}</div>}
            </div>
            {!page&&<div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
              {!draft&&<button data-tour="task-edit" onClick={startEdit} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,color:T.textMuted,fontSize:fz(11),cursor:"pointer",padding:"5px 10px"}}>Edit</button>}
              {!sessionActive&&<button onClick={onClose} aria-label="Close" className="hit hit-sm" style={{background:"none",border:"none",color:T.textFaint,fontSize:22,cursor:"pointer",padding:"0 0 0 8px",lineHeight:1}}>×</button>}
            </div>}
          </div>

          {/* Edit panel. On the page it's always open, and a field saves when you
              leave it (the form's onBlur) or at once for a choice (change(...,true)). */}
          {draft&&(()=>{
            const field={background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,padding:"8px 10px",fontSize:fz(12),outline:"none",width:"100%",boxSizing:"border-box" as const};
            const label={fontSize:fz(10),color:T.textMuted,textTransform:"uppercase" as const,letterSpacing:"0.08em",marginBottom:4,display:"block"};
            const clear={background:"none",border:"none",padding:"6px 0 0",cursor:"pointer",color:T.textMuted,fontFamily:F.body,fontSize:fz(11),textDecoration:"underline"};
            const subjectOptions=draft.subject&&!subjects.includes(draft.subject)?[...subjects,draft.subject]:subjects;
            const change=(patch:Partial<TaskDraft>,saveNow?:boolean)=>{const d={...draft,...patch};setDraft(d);if(page&&saveNow)commitDraft(d);};
            return (
            <form className="sec-body" onSubmit={e=>{e.preventDefault();if(page)commitDraft();else saveEdit();}} onBlur={page?()=>commitDraft():undefined} style={{background:T.card,borderRadius:14,padding:"14px",border:`1px solid ${page?T.border:T.accent+"44"}`,marginBottom:16,display:"flex",flexDirection:"column",gap:10}}>
              {!page&&<label><span style={label}>Title</span>
                <input className="edit-field" autoFocus value={draft.title} maxLength={500} onChange={e=>setDraft({...draft,title:e.target.value})} style={field}/></label>}
              <label><span style={label}>Subject</span>
                <select className="edit-field" value={draft.subject} onChange={e=>change({subject:e.target.value},true)} style={field}>
                  <option value="">No subject</option>
                  {subjectOptions.map(s=><option key={s} value={s}>{s}</option>)}
                </select></label>
              <div style={{display:"flex",gap:8}}>
                {/* minWidth:0 lets the two halves shrink evenly: iOS gives date and
                    time inputs an intrinsic width that otherwise pushes one over
                    the other (see .edit-field in the runtime css). */}
                {/* The clear buttons sit outside the labels (inside one, a tap would
                    open the picker again). The phone's own date/time pickers have no
                    "none" choice, so these are the way back from a stray tap. */}
                <div style={{flex:"1 1 0",minWidth:0}}>
                  <label style={{display:"block"}}><span style={label}>Due date</span>
                    <input className="edit-field" type="date" value={draft.dueDate} onChange={e=>setDraft({...draft,dueDate:e.target.value})} style={field}/></label>
                  {draft.dueDate&&<button type="button" onClick={()=>change({dueDate:"",dueTime:""},true)} style={clear}>No due date</button>}
                </div>
                <div style={{flex:"1 1 0",minWidth:0}}>
                  <label style={{display:"block"}}><span style={label}>Time</span>
                    <input className="edit-field" type="time" value={draft.dueTime} disabled={!draft.dueDate} onChange={e=>setDraft({...draft,dueTime:e.target.value})} style={{...field,opacity:draft.dueDate?1:0.5}}/></label>
                  {draft.dueTime&&<button type="button" data-tour="no-due-time" onClick={()=>change({dueTime:""},true)} style={clear}>No due time</button>}
                </div>
              </div>
              <div style={{display:"flex",gap:8}}>
                {/* Plain text fields with the number keypad, not type="number":
                    those snapped an emptied field back to 0 (typing then gave
                    "030"), and step/max validation silently blocked Save. */}
                <label style={{flex:1}}><span style={label}>Estimate (hours)</span>
                  <input className="edit-field" inputMode="numeric" placeholder="0" value={draft.estH} onFocus={e=>e.currentTarget.select()} onChange={e=>setDraft({...draft,estH:e.target.value.replace(/\D/g,"").slice(0,4)})} style={field}/></label>
                <label style={{flex:1}}><span style={label}>Minutes</span>
                  <input className="edit-field" inputMode="numeric" placeholder="0" value={draft.estM} onFocus={e=>e.currentTarget.select()} onChange={e=>setDraft({...draft,estM:e.target.value.replace(/\D/g,"").slice(0,4)})} style={field}/></label>
              </div>
              {(parseInt(draft.estM,10)||0)>=60&&<div style={{fontSize:fz(10),color:T.textMuted,marginTop:-4}}>Saves as {formatDuration(draftEstMins)}</div>}
              <label><span style={label}>Repeats</span>
                <select className="edit-field" value={draft.recurrence} onChange={e=>change({recurrence:e.target.value as Recurrence},true)} style={field}>
                  <option value="none">Doesn't repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
                </select></label>
              {!page&&<div style={{display:"flex",gap:8}}>
                <button type="button" onClick={()=>setDraft(null)} style={{flex:1,background:"none",border:`1px solid ${T.border}`,borderRadius:9,padding:"9px",color:T.textMuted,cursor:"pointer",fontSize:fz(12)}}>Cancel</button>
                <button type="submit" style={{flex:1,background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:9,padding:"9px",cursor:"pointer",fontSize:fz(12),fontWeight:500}}>Save</button>
              </div>}
            </form>
            );
          })()}

          {/* Info row */}
          <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
            {task.dueDate&&<div style={{background:T.card,borderRadius:10,padding:"8px 14px",border:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontFamily:F.body,fontSize:fz(12),color:T.textMuted}}>{formatDate(task.dueDate)}{task.dueTime?` at ${formatTime(task.dueTime,h24)}`:""}</span>
              {!task.done&&countdown(task.dueDate,task.dueTime,now)&&<span style={{fontFamily:F.body,fontSize:fz(12),color:ink(priColor(pr,colorCodeUrgency),T.light),fontWeight:500}}>· {countdown(task.dueDate,task.dueTime,now)}</span>}
            </div>}
            {task.estMins>0&&<div style={{background:T.card,borderRadius:10,padding:"8px 14px",border:`1px solid ${T.accent}44`,display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontFamily:F.body,fontSize:fz(12),color:T.accent,fontWeight:500}}>
                {formatDuration(task.estMins)} estimated
              </span>
            </div>}
            {totalSessionMins>0&&<div style={{background:"#2ED57322",borderRadius:10,padding:"8px 14px",border:"1px solid #2ED57344",display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:fz(14)}}>✓</span>
              <span style={{fontFamily:F.body,fontSize:fz(12),color:ink("#2ED573",T.light)}}>{formatDuration(totalSessionMins)} spent today</span>
            </div>}
          </div>

          {/* Snooze */}
          {/* Not on the task page (removed at the user's request): the date field is right there. */}
          {!task.done&&!draft&&!page&&(
            <div data-tour="task-snooze" style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginTop:-8,marginBottom:18}}>
              <span style={{fontSize:fz(10),color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginRight:2}}>Snooze</span>
              {([["later","In 3 hours"],["tomorrow","Tomorrow"],["week","Next week"]] as const).map(([k,l])=>(
                <button key={k} onClick={()=>onSnooze(k)} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:999,padding:"5px 12px",color:T.text,cursor:"pointer",fontSize:fz(11)}}>{l}</button>
              ))}
              {task.recurrence&&task.recurrence!=="none"&&(
                <button data-tour="task-skip" onClick={onSkipOccurrence} title="Move this repeating task to its next occurrence without completing it" style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:999,padding:"5px 12px",color:T.text,cursor:"pointer",fontSize:fz(11)}}>Skip this one ↻</button>
              )}
            </div>
          )}

          {/* Priority override */}
          <div style={{background:T.card,borderRadius:14,padding:"14px",border:`1px solid ${T.border}`,marginBottom:16}}>
            <div style={{fontFamily:F.body,fontSize:fz(10),color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>Priority</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
              {([null,"low","medium","high"] as const).map(p=>{
                const active=p===null?!task.priorityOverride:task.priorityOverride===p;
                const label=p===null?"Auto":p[0].toUpperCase()+p.slice(1);
                const color=p===null?T.accent:priColor(p,colorCodeUrgency);
                return <button key={p??"auto"} aria-pressed={active} onClick={()=>onSetPriorityOverride(p)}
                  style={{background:active?color+"22":T.surface,border:`1.5px solid ${active?color:T.border}`,borderRadius:9,padding:"8px 4px",cursor:"pointer",color:active?color:T.textMuted,fontFamily:F.body,fontSize:fz(11)}}>
                  {label}
                </button>;
              })}
            </div>
          </div>

          {/* Subtasks */}
          <div style={{background:T.card,borderRadius:14,padding:"14px",border:`1px solid ${T.border}`,marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:subtasks.length?10:0}}>
              <div style={{fontFamily:F.body,fontSize:fz(10),color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em"}}>Subtasks</div>
              {subtasks.length>0&&<div style={{fontFamily:F.body,fontSize:fz(11),color:T.textFaint}}>{subtasks.filter(s=>s.done).length}/{subtasks.length}</div>}
            </div>
            {subtasks.length>0&&<div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:10}}>
              {subtasks.map(s=>(
                <div key={s.id} style={{display:"flex",alignItems:"center",gap:8}}>
                  <button onClick={()=>onUpdateSubtasks(subtasks.map(x=>x.id===s.id?{...x,done:!x.done}:x))} aria-label={s.done?`Uncheck ${s.text}`:`Check off ${s.text}`} className="hit hit-row" style={{background:s.done?"#2ED573":"none",border:`1.5px solid ${s.done?"#2ED573":T.textFaint}`,borderRadius:"50%",width:16,height:16,cursor:"pointer",flexShrink:0,padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {s.done&&<span style={{color:"#111",fontSize:fz(9),fontWeight:"bold"}}>✓</span>}
                  </button>
                  <span style={{flex:1,fontFamily:F.body,fontSize:fz(12),color:s.done?T.textFaint:T.text,textDecoration:s.done?"line-through":"none"}}>{s.text}</span>
                  <button onClick={()=>onUpdateSubtasks(subtasks.filter(x=>x.id!==s.id))} aria-label={`Delete subtask ${s.text}`} className="hit hit-row" style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:fz(13),lineHeight:1,padding:"0 2px"}}>×</button>
                </div>
              ))}
            </div>}
            <div style={{display:"flex",gap:6}}>
              <input value={newSubtaskText} onChange={e=>setNewSubtaskText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addSubtask()} placeholder={subtasks.length>=LIMITS.subtasks?`Limit of ${LIMITS.subtasks} subtasks reached`:"Add a subtask..."} disabled={subtasks.length>=LIMITS.subtasks} maxLength={500} style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,padding:"7px 10px",fontFamily:F.body,fontSize:fz(12),outline:"none"}}/>
              <button onClick={addSubtask} aria-label="Add subtask" style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:8,padding:"7px 12px",cursor:"pointer",fontFamily:F.body,fontSize:fz(12),fontWeight:500}}>+</button>
            </div>
          </div>

          {/* Tags */}
          <div style={{background:T.card,borderRadius:14,padding:"14px",border:`1px solid ${T.border}`,marginBottom:16}}>
            <div style={{fontFamily:F.body,fontSize:fz(10),color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:tags.length?10:0}}>Tags</div>
            {tags.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
              {tags.map(tag=>(
                <span key={tag} style={{display:"flex",alignItems:"center",gap:4,background:T.accent+"22",color:T.accent,borderRadius:999,padding:"3px 4px 3px 10px",fontFamily:F.body,fontSize:fz(11)}}>
                  {tag}
                  <button onClick={()=>onSetTags(tags.filter(x=>x!==tag))} aria-label={`Remove tag ${tag}`} className="hit hit-sm" style={{background:"none",border:"none",color:T.accent,cursor:"pointer",fontSize:fz(13),lineHeight:1,padding:"0 4px"}}>×</button>
                </span>
              ))}
            </div>}
            <div style={{display:"flex",gap:6}}>
              <input value={newTagText} onChange={e=>setNewTagText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTag()} placeholder={tags.length>=LIMITS.tags?`Limit of ${LIMITS.tags} tags reached`:"Add a tag..."} disabled={tags.length>=LIMITS.tags} maxLength={100} style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,padding:"7px 10px",fontFamily:F.body,fontSize:fz(12),outline:"none"}}/>
              <button onClick={addTag} aria-label="Add tag" style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:8,padding:"7px 12px",cursor:"pointer",fontFamily:F.body,fontSize:fz(12),fontWeight:500}}>+</button>
            </div>
            {tags.length<LIMITS.tags&&allTags.filter(t=>!tags.includes(t)).length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
              {allTags.filter(t=>!tags.includes(t)).slice(0,8).map(t=>(
                <button key={t} onClick={()=>onSetTags([...tags,t])} style={{background:"none",border:`1px dashed ${T.border}`,borderRadius:999,padding:"3px 10px",fontFamily:F.body,fontSize:fz(10),color:T.textFaint,cursor:"pointer"}}>+{t}</button>
              ))}
            </div>}
          </div>

          {/* Session timer */}
          <div style={{background:T.card,borderRadius:16,padding:"20px",border:`1px solid ${sessionActive?T.accent+"66":T.border}`,marginBottom:16,textAlign:"center",transition:"border-color .2s ease-out"}}>
            {sessionActive?(
              <>
                <div style={{fontFamily:F.body,fontSize:fz(11),color:T.accent,marginBottom:8,letterSpacing:"0.1em",textTransform:"uppercase"}}>Session in progress</div>
                <div style={{fontFamily:F.heading,fontSize:52,color:T.text,lineHeight:1,marginBottom:4}}>
                  {sh>0?`${sh}:`:""}{String(sm).padStart(2,"0")}:{String(ss).padStart(2,"0")}
                </div>
                <div style={{fontFamily:F.body,fontSize:fz(11),color:T.textFaint,marginBottom:18}}>Keep going!</div>
                <button onClick={onEndSession} style={{background:"#FF4757",color:"#fff",border:"none",borderRadius:12,padding:"13px 32px",fontFamily:F.heading,fontSize:fz(17),cursor:"pointer",width:"100%",boxShadow:"0 4px 20px #FF475744"}}>
                  End Session
                </button>
              </>
            ):(
              <>
                <div style={{fontFamily:F.body,fontSize:fz(11),color:T.textMuted,marginBottom:8,letterSpacing:"0.1em",textTransform:"uppercase"}}>Ready to work?</div>
                <div style={{fontFamily:F.heading,fontSize:52,color:T.textFaint,lineHeight:1,marginBottom:18}}>00:00</div>
                <button onClick={onStartSession} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:12,padding:"13px 32px",fontFamily:F.heading,fontSize:fz(17),cursor:"pointer",width:"100%",boxShadow:`0 4px 20px ${T.accentGlow}`}}>
                  Start Session
                </button>
              </>
            )}
          </div>

          {/* Session history */}
          {sessionHistory.length>0&&(
            <div style={{background:T.card,borderRadius:12,padding:"12px 14px",border:`1px solid ${T.border}`,marginBottom:16}}>
              <div style={{fontFamily:F.body,fontSize:fz(10),color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Sessions today</div>
              {sessionHistory.map((s,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:i<sessionHistory.length-1?`1px solid ${T.borderFaint}`:"none"}}>
                  <span style={{fontFamily:F.body,fontSize:fz(12),color:T.text}}>Session {i+1}</span>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <span style={{fontFamily:F.body,fontSize:fz(11),color:T.textFaint}}>{s.date}</span>
                    <span style={{fontFamily:F.body,fontSize:fz(12),color:T.accent,fontWeight:500}}>{formatDuration(s.mins)}</span>
                  </div>
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",marginTop:8,paddingTop:8,borderTop:`1px solid ${T.border}`}}>
                <span style={{fontFamily:F.body,fontSize:fz(12),color:T.textMuted}}>Total</span>
                <span style={{fontFamily:F.heading,fontSize:fz(16),color:T.accent}}>{formatDuration(totalSessionMins)}</span>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{display:"grid",gridTemplateColumns:task.done?"1fr 1fr 1fr":"1fr 1fr",gap:8}}>
            <button onClick={onToggleDone}
              style={{background:task.done?"#FF475722":"#2ED57322",color:ink(task.done?"#FF4757":"#2ED573",T.light),border:`1px solid ${task.done?"#FF475744":"#2ED57344"}`,borderRadius:11,padding:"11px",fontFamily:F.body,fontSize:fz(12),cursor:"pointer"}}>
              {task.done?"↩ Mark undone":"✓ Mark done"}
            </button>
            {task.done&&!task.archived&&(
              <button onClick={onArchive}
                style={{background:T.surface,color:T.textMuted,border:`1px solid ${T.border}`,borderRadius:11,padding:"11px",fontFamily:F.body,fontSize:fz(12),cursor:"pointer"}}>
                Archive
              </button>
            )}
            {task.archived&&(
              <button onClick={onRestore}
                style={{background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:11,padding:"11px",fontFamily:F.body,fontSize:fz(12),cursor:"pointer"}}>
                Restore
              </button>
            )}
            <button onClick={onDelete}
              style={{background:"#FF475711",color:ink("#FF4757",T.light),border:"1px solid #FF475733",borderRadius:11,padding:"11px",fontFamily:F.body,fontSize:fz(12),cursor:"pointer"}}>
              Delete task
            </button>
          </div>
          <button data-tour="task-duplicate" onClick={onDuplicate}
            style={{width:"100%",marginTop:8,background:"none",border:`1px solid ${T.border}`,borderRadius:11,padding:"10px",color:T.textMuted,fontFamily:F.body,fontSize:fz(11),cursor:"pointer"}}>
            Duplicate task
          </button>
          {templateName===null&&<button onClick={()=>{setTemplateSaved(false);setTemplateName(task.title);}}
            style={{width:"100%",marginTop:8,background:"none",border:`1px solid ${T.border}`,borderRadius:11,padding:"10px",color:T.textMuted,fontFamily:F.body,fontSize:fz(11),cursor:"pointer"}}>
            {templateSaved?"✓ Saved. Find it under \"+ Add homework\"":"Save as template"}
          </button>}
          {templateName!==null&&<form onSubmit={e=>{e.preventDefault();if(templateName.trim()){onSaveAsTemplate(templateName.trim());setTemplateName(null);setTemplateSaved(true);}}} style={{display:"flex",gap:6,marginTop:8}}>
            <input autoFocus value={templateName} onChange={e=>setTemplateName(e.target.value)} placeholder="Template name" aria-label="Template name" style={{flex:1,minWidth:0,background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,color:T.text,padding:"9px 12px",fontSize:fz(12),outline:"none"}}/>
            <button type="submit" disabled={!templateName.trim()} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:9,padding:"9px 14px",cursor:"pointer",fontSize:fz(12),fontWeight:500,opacity:templateName.trim()?1:0.5}}>Save</button>
            <button type="button" onClick={()=>setTemplateName(null)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 12px",color:T.textMuted,cursor:"pointer",fontSize:fz(12)}}>Cancel</button>
          </form>}
        </div>
  );
  if(page)return <div ref={panelRef}>{content}</div>;
  return(
    <div ref={overlayRef} className="fade-in" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.53)",zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"center",padding:"0 0 0 0"}} onClick={e=>{if(e.target===e.currentTarget&&!sessionActive)onClose();}}>
      {/* The drag offset lives on this wrapper, not the panel: the panel's "pop"
          entrance animation (fill-mode forwards) would override its transform. */}
      <div ref={sheetRef} style={{width:"100%",maxWidth:580}}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={task.title} className="pop" style={{background:T.bg,borderRadius:"20px 20px 0 0",width:"100%",maxHeight:"90vh",overflowY:"auto",overscrollBehavior:"contain",border:`1px solid ${T.border}`,borderBottom:"none"}}>
        {/* Handle -- drag down to close (not while a session is running) */}
        {!sessionActive&&<div data-sheet-handle
          onPointerDown={e=>{
            cancelAnimationFrame(sheetAnim.current); // catch the sheet mid-spring
            sheetDrag.current={startY:e.clientY-sheetY.current,samples:[{t:e.timeStamp,y:e.clientY}]};
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={e=>{
            const d=sheetDrag.current; if(!d)return;
            d.samples.push({t:e.timeStamp,y:e.clientY}); if(d.samples.length>8)d.samples.shift();
            const raw=e.clientY-d.startY;
            setSheetY(raw>=0?raw:-rubberBand(-raw));
          }}
          onPointerUp={e=>{
            const d=sheetDrag.current; if(!d)return; sheetDrag.current=null;
            d.samples.push({t:e.timeStamp,y:e.clientY});
            const v=releaseVelocity(d.samples);
            releaseSheet(v,shouldDismiss(sheetY.current,v));
          }}
          onPointerCancel={()=>{sheetDrag.current=null;releaseSheet(0,false);}}
          style={{display:"flex",justifyContent:"center",padding:"12px 0 8px",cursor:"grab",touchAction:"none"}}>
          <div style={{width:36,height:4,borderRadius:999,background:T.border}}/>
        </div>}
        {sessionActive&&<div style={{height:20}}/>}
        {content}
      </div>
      </div>
    </div>
  );
}
