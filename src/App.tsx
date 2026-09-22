import { useState, useEffect, useRef, useMemo } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut as fbSignOut, onAuthStateChanged, deleteUser } from "firebase/auth";
import type { User } from "firebase/auth";
import { initializeFirestore, doc, getDoc, setDoc, updateDoc, deleteField, collection, getDocs, writeBatch, onSnapshot, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getPerformance } from "firebase/performance";
import { getAnalytics, isSupported as isAnalyticsSupported } from "firebase/analytics";
import type { Priority, Recurrence } from "./types";
import { THEMES } from "./themes";
import type { ThemeName, ThemeObj } from "./themes";
import { localDateStr, todayISO, advanceDate } from "./lib/dates";
import { nextId } from "./lib/id";
import { parseSyllabus } from "./lib/syllabus";
import { contrastColor, getPriority, formatDate, csvField, formatTime, daysUntil } from "./lib/format";
import { downloadFile } from "./lib/download";
import { usePersistedState } from "./hooks/usePersistedState";
import { ErrorBoundary } from "./components/ErrorBoundary";

// ─── FIREBASE ────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyD9W3eTvKjthiEZ_0MjeCHBIZ6BevMKgSo",
  // Deliberately this site's own domain, not Firebase's *.firebaseapp.com --
  // see vercel.json, which transparently proxies /__/auth/** on this domain
  // to Firebase's real handler. Sign-in then never crosses origins at all,
  // which is what actually eliminates (not just mitigates) the class of bug
  // where browsers with strict storage partitioning -- Firefox's Enhanced
  // Tracking Protection notably -- break signInWithRedirect when the auth
  // handler lives on a different origin than the app itself.
  authDomain: "dueplanner.vercel.app",
  projectId: "ai-homework-planner-92260",
  storageBucket: "ai-homework-planner-92260.firebasestorage.app",
  messagingSenderId: "445404835645",
  appId: "1:445404835645:web:c84c3f1bbb8cbfe171df54",
};
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
// ignoreUndefinedProperties: a stray `undefined` field anywhere in a synced
// payload would otherwise make setDoc() throw synchronously (uncaught, since
// this fires from a plain useEffect with no error boundary), crashing the
// whole app to a blank screen instead of just dropping that one field.
//
// localCache/persistentLocalCache: enables an IndexedDB-backed local cache
// instead of the default in-memory-only one, so the app can actually read
// (and queue writes to sync later) while offline, and repeat loads serve from
// the local cache instead of a fresh network round trip every time.
// persistentMultipleTabManager lets multiple open tabs share that cache
// instead of only the first tab getting persistence and the rest silently
// falling back to memory-only. Wrapped in try/catch, with a plain in-memory
// fallback, because this runs at module load time (before React even
// renders) -- if an exotic environment (locked-down IndexedDB, very old
// browser) made this throw synchronously and uncaught, the whole app would
// fail to load at all rather than just missing offline support.
let db: Firestore;
try {
  db = initializeFirestore(fbApp, {
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (e) {
  console.error("Firestore persistent cache unavailable, falling back to in-memory cache:", e);
  db = initializeFirestore(fbApp, { ignoreUndefinedProperties: true });
}
const googleProvider = new GoogleAuthProvider();
// App Check proves requests are coming from this real app (not a script
// hitting the project directly with the public firebaseConfig above) via a
// reCAPTCHA Enterprise attestation (classic reCAPTCHA v3 is deprecated in
// favor of this as of when this key was created). Fully inert -- and safe to
// leave committed -- until VITE_RECAPTCHA_SITE_KEY is actually set, since
// without a site key there's nothing to initialize. A site key isn't a
// secret (same category as firebaseConfig: meant to be public, verified
// server-side by Google), so this doesn't need to live outside version
// control. Generating tokens here does nothing on its own -- enforcement
// (Firestore actually rejecting requests without a valid token) is a
// separate switch in the Firebase Console, off by default, and should only
// be flipped on after confirming in the console's App Check metrics that
// real traffic is producing valid tokens -- otherwise it locks out every
// real user at once.
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
if (recaptchaSiteKey) {
  initializeAppCheck(fbApp, {
    provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}
// Automatically tracks real-world page load time and network request
// latency, visible in Firebase Console -> Performance. No setup/key needed
// (unlike App Check) and included on the free Spark plan. Wrapped in
// try/catch since it relies on browser Performance APIs that could be
// missing in an unsupported environment -- shouldn't be able to break the
// app over a monitoring feature.
try {
  getPerformance(fbApp);
} catch (e) {
  console.error("Firebase Performance Monitoring unavailable:", e);
}
// Basic usage analytics (page views, sessions, engagement time) -- free on
// the Spark plan, visible in Firebase Console -> Analytics. isSupported() is
// used (not just try/catch) because the underlying gtag.js script commonly
// gets blocked outright by ad/privacy blocker extensions (AdGuard, uBlock,
// etc.) rather than throwing -- isSupported() checks this explicitly instead
// of silently failing partway through initialization. If the project's never
// had Google Analytics linked at the Firebase-project level, this will just
// silently collect nothing rather than error.
isAnalyticsSupported().then(supported => {
  if (!supported) return;
  try {
    getAnalytics(fbApp);
  } catch (e) {
    console.error("Firebase Analytics unavailable:", e);
  }
}).catch(()=>{});
// Detects the signature of a browser blocking the storage handoff Firebase
// needs to complete signInWithRedirect across the round trip through its
// authDomain (a different origin from this site) -- notably Firefox's
// Enhanced Tracking Protection / Total Cookie Protection, on by default. This
// shows up two different ways depending on exactly when the browser blocks
// it: sometimes getRedirectResult() just resolves with no result and no
// error (handled separately, see the "no result" branch below), and
// sometimes it throws this specific error instead ("missing initial state" /
// web-storage-unsupported) -- both are the same underlying cause and deserve
// the same actionable message, not a generic "unknown error".
function isStorageBlockedError(e: unknown): boolean {
  const code = (e as { code?: string })?.code || "";
  const message = ((e as { message?: string })?.message || "").toLowerCase();
  return code === "auth/web-storage-unsupported"
    || message.includes("missing initial state")
    || message.includes("sessionstorage");
}
const STORAGE_BLOCKED_MESSAGE = "Sign-in was blocked by your browser's tracking protection. In Firefox: click the shield icon in the address bar and turn off Enhanced Tracking Protection for this site, then try again. Chrome and Edge don't hit this issue.";

const LAYOUTS = {
  list:      { name:"List",       emoji:"☰",  desc:"Classic cards" },
  compact:   { name:"Compact",    emoji:"⊟",  desc:"Slim rows" },
  board:     { name:"Board",      emoji:"⊞",  desc:"Grid cards" },
  minimal:   { name:"Minimal",    emoji:"·",  desc:"Just text" },
  checklist: { name:"Checklist",  emoji:"☑",  desc:"Simple ticks" },
  sticky:    { name:"Sticky",     emoji:"▤",  desc:"Sticky notes" },
  kanban:    { name:"Kanban",     emoji:"𝄘",  desc:"By status" },
  timeline:  { name:"Timeline",   emoji:"↓",  desc:"Time ordered" },
  subject:   { name:"By Subject", emoji:"▥", desc:"Subject tabs" },
  progress:  { name:"Progress",   emoji:"▓",  desc:"Progress bars" },
  pyramid:   { name:"Pyramid",    emoji:"△",  desc:"By priority" },
  calendar:  { name:"Calendar",   emoji:"▦", desc:"Week view" },
} as const;
type LayoutName = keyof typeof LAYOUTS;

// ─── TAB BAR ICONS ─────────────────────────────────────────────────────────────
// Small stroke-based SVGs (not Unicode glyphs) for the icon-only main tab bar --
// built from plain primitives (line/circle/polyline) rather than hand-drawn path
// data, so they render identically and crisply everywhere instead of depending on
// whichever symbols a given OS/browser's font happens to ship. `stroke="currentColor"`
// picks up the parent button's `color`, so active/inactive state needs no extra prop.
function IconTasks(){
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="4" cy="6" r="1.3"/><line x1="8.5" y1="6" x2="20" y2="6"/>
    <circle cx="4" cy="12" r="1.3"/><line x1="8.5" y1="12" x2="20" y2="12"/>
    <circle cx="4" cy="18" r="1.3"/><line x1="8.5" y1="18" x2="20" y2="18"/>
  </svg>;
}
function IconTools(){
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="4" x2="6" y2="20"/><circle cx="6" cy="14" r="2.1"/>
    <line x1="12" y1="4" x2="12" y2="20"/><circle cx="12" cy="8" r="2.1"/>
    <line x1="18" y1="4" x2="18" y2="20"/><circle cx="18" cy="16" r="2.1"/>
  </svg>;
}
function IconImport(){
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="3" x2="12" y2="14"/><polyline points="7.5,10 12,14.5 16.5,10"/>
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>
  </svg>;
}
function IconSettings(){
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2.1"/>
    {[0,45,90,135,180,225,270,315].map(deg=>(
      <line key={deg} x1="12" y1="4.2" x2="12" y2="1.8" transform={`rotate(${deg} 12 12)`}/>
    ))}
  </svg>;
}

// ─── FONT ─────────────────────────────────────────────────────────────────────
// Down to exactly one -- the original DM Serif Display/DM Mono pairing -- with
// every other option removed, so there's no per-user Font picker/state
// anymore (same treatment THEMES got when it went down to two).
const FONT = { name:"DM Serif", heading:"'DM Serif Display', serif", body:"'DM Mono', monospace", google:"DM+Serif+Display:ital@0;1&family=DM+Mono:wght@400;500" } as const;

const GROUP_BY = { none:{name:"None",emoji:"--"}, subject:{name:"Subject",emoji:"▥"}, priority:{name:"Priority",emoji:"‼"}, dueDate:{name:"Due Date",emoji:"▦"} };
const DEFAULT_SUBJECTS = ["Math","English","Science","History","Art","PE"];
const DEFAULT_SUBJECT_COLORS: Record<string,string> = { Math:"#FF6B6B",English:"#FF9F43",Science:"#45B7D1",History:"#F7DC6F",Art:"#BB8FCE",PE:"#82E0AA" };
const SUBJECT_COLOR_PALETTE = ["#FF6B6B","#FF9F43","#45B7D1","#F7DC6F","#BB8FCE","#82E0AA","#C9E06C","#9CE06C","#6EE06C","#6CE0D2","#6C7DE0","#8D6CE0","#E06CCE","#E06C9E"];
const PRIORITY_COLORS: Record<Priority,string> = { high:"#FF4757",medium:"#FFA502",low:"#2ED573" };
// Fallback for every priority color/text when the "Urgency color coding" toggle
// (Options -> Looks) is off -- one neutral gray instead of red/orange/green, so
// urgency still reads through position/text ("Overdue!" etc.) without color.
const NEUTRAL_PRIORITY_COLOR = "#8a8a8a";
function priColor(pr:Priority,colorCode:boolean):string{ return colorCode?PRIORITY_COLORS[pr]:NEUTRAL_PRIORITY_COLOR; }
const REMINDER_OFFSETS = [
  { key:"1d", label:"1 day before", mins:1440 },
  { key:"3h", label:"3 hours before", mins:180 },
  { key:"1h", label:"1 hour before", mins:60 },
  { key:"0",  label:"At due time",   mins:0 },
] as const;
const QUESTIONS = [
  { key:"subject", label:"What subject?", type:"select" },
  { key:"dueDate", label:"When is it due?", type:"date" },
  { key:"estMins", label:"How long will it take?", type:"time" },
  { key:"recurrence", label:"Does this repeat?", type:"recurrence" },
];

interface Subtask { id:string; text:string; done:boolean; }
interface Task {
  id:number; title:string; subject:string; dueDate:string; dueTime:string; estMins:number; done:boolean; order:number;
  subtasks?: Subtask[];
  recurrence?: Recurrence;
  archived?: boolean;
  completedAt?: number | null; // ms timestamp, set when marked done, cleared (null, never undefined -- Firestore's setDoc throws on literal undefined) when un-marked -- drives archive timing + weekly/monthly stats
  tags?: string[]; // free-form, cross-cutting -- distinct from subject (one per task, these are many)
  priorityOverride?: Priority; // manual override for getPriority()'s auto-computed value, cleared to go back to "Auto"
}

// Reusable task shape -- local-only (localStorage), not synced to Firestore.
// Deliberate scope call: templates are a personal productivity convenience,
// not core data, and don't currently justify a second synced collection.
interface TaskTemplate { id:string; name:string; subject:string; estMins:number; recurrence?:Recurrence; subtasks?:{text:string}[]; }

const DEFAULT_TASKS: Task[] = [
  { id:1, title:"Chapter 5 Review", subject:"Math", dueDate:localDateStr(new Date(Date.now()+86400000)), dueTime:"", estMins:45, done:false, order:0 },
  { id:2, title:"Essay Draft", subject:"English", dueDate:localDateStr(new Date(Date.now()+3*86400000)), dueTime:"23:59", estMins:90, done:false, order:1 },
  { id:3, title:"Lab Report", subject:"Science", dueDate:localDateStr(new Date(Date.now()+5*86400000)), dueTime:"", estMins:60, done:false, order:2 },
  { id:4, title:"History Reading", subject:"History", dueDate:localDateStr(new Date(Date.now()+2*86400000)), dueTime:"09:00", estMins:30, done:false, order:3 },
];

async function fetchAISuggestion(tasks:Task[]):Promise<string> {
  // NOTE: this used to call api.anthropic.com directly from the browser with no
  // auth header, so it silently failed on every call. Calling a paid AI API from
  // client-side code isn't secure anyway (the key would be visible to anyone),
  // so this generates the suggestion locally from the task data instead.
  const pending=tasks.filter(t=>!t.done);
  if (pending.length===0) return "Nothing left to do -- great work!";
  if (pending.length===1) return `Just one task left: "${pending[0].title}". You've got this!`;
  const sorted=[...pending].sort((a,b)=>{
    const o:Record<string,number>={high:0,medium:1,low:2};
    const d=o[getPriority(a.dueDate,a.estMins,a.priorityOverride)]-o[getPriority(b.dueDate,b.estMins,b.priorityOverride)];
    return d!==0?d:(a.dueDate||"").localeCompare(b.dueDate||"");
  });
  const top=sorted[0];
  const days=daysUntil(top.dueDate);
  const timeStr=top.estMins>=60?`${Math.floor(top.estMins/60)}h${top.estMins%60?` ${top.estMins%60}m`:""}`:`${top.estMins}m`;
  const urgencyWord=days==="Overdue!"?"overdue":days==="Due today!"?"due today":days==="Due tomorrow"?"due tomorrow":days?days.replace(" days left","d left"):"no deadline";
  return `Start with "${top.title}"\n${urgencyWord}, ~${timeStr}`;
}

// ─── TASK SESSION MODAL ───────────────────────────────────────────────────────
// Defined at module scope (not nested in HomeworkPlanner) so its identity stays
// stable across renders -- otherwise the session timer's once-a-second tick
// would redefine this as a "new" component each time, forcing React to unmount
// and remount the whole modal (replaying its entrance animation) every second.
function TaskModal({task,T,F,subjectColors,colorCodeUrgency,sessionActive,sessionSecs,sessionHistory,allTags,onClose,onStartSession,onEndSession,onToggleDone,onDelete,onUpdateSubtasks,onArchive,onSetPriorityOverride,onSetTags,onSaveAsTemplate}:{
  task:Task; T:ThemeObj; F:typeof FONT; subjectColors:Record<string,string>; colorCodeUrgency:boolean;
  sessionActive:boolean; sessionSecs:number; sessionHistory:{mins:number;date:string}[];
  allTags:string[];
  onClose:()=>void; onStartSession:()=>void; onEndSession:()=>void; onToggleDone:()=>void; onDelete:()=>void;
  onUpdateSubtasks:(subtasks:Subtask[])=>void; onArchive:()=>void;
  onSetPriorityOverride:(override:Priority|null)=>void; onSetTags:(tags:string[])=>void;
  onSaveAsTemplate:(name:string)=>void;
}){
  const pr=getPriority(task.dueDate,task.estMins,task.priorityOverride);
  const sc=subjectColors[task.subject]||T.accent;
  const sm=Math.floor(sessionSecs/60); const ss=sessionSecs%60;
  const totalSessionMins=sessionHistory.reduce((a,b)=>a+b.mins,0);
  const subtasks=task.subtasks||[];
  const [newSubtaskText,setNewSubtaskText]=useState("");
  function addSubtask(){
    const text=newSubtaskText.trim();
    if(!text)return;
    onUpdateSubtasks([...subtasks,{id:String(nextId()),text,done:false}]);
    setNewSubtaskText("");
  }
  const tags=task.tags||[];
  const [newTagText,setNewTagText]=useState("");
  function addTag(){
    const t=newTagText.trim();
    if(!t||tags.includes(t))return;
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
  useEffect(()=>{
    const previouslyFocused=document.activeElement as HTMLElement|null;
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
  },[]);
  return(
    <div style={{position:"fixed",inset:0,background:"#00000088",zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"center",padding:"0 0 0 0"}} onClick={e=>{if(e.target===e.currentTarget&&!sessionActive)onClose();}}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={task.title} className="pop" style={{background:T.bg,borderRadius:"20px 20px 0 0",width:"100%",maxWidth:580,maxHeight:"90vh",overflowY:"auto",border:`1px solid ${T.border}`,borderBottom:"none"}}>
        {/* Handle */}
        <div style={{display:"flex",justifyContent:"center",padding:"12px 0 4px"}}>
          <div style={{width:36,height:4,borderRadius:999,background:T.border}}/>
        </div>
        <div style={{padding:"12px 20px 32px"}}>
          {/* Task header */}
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16}}>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:6}}>
                <span style={{background:sc+"22",color:sc,borderRadius:999,padding:"3px 10px",fontFamily:F.body,fontSize:11}}>{task.subject}</span>
                <span style={{background:priColor(pr,colorCodeUrgency)+"22",color:priColor(pr,colorCodeUrgency),borderRadius:999,padding:"3px 10px",fontFamily:F.body,fontSize:11}}>{pr} priority</span>
                {task.done&&<span style={{background:"#2ED57322",color:"#2ED573",borderRadius:999,padding:"3px 10px",fontFamily:F.body,fontSize:11}}>✓ done</span>}
              </div>
              <div style={{fontFamily:F.heading,fontSize:22,color:T.text,lineHeight:1.2}}>{task.title}</div>
            </div>
            {!sessionActive&&<button onClick={onClose} style={{background:"none",border:"none",color:T.textFaint,fontSize:22,cursor:"pointer",padding:"0 0 0 8px",lineHeight:1}}>×</button>}
          </div>

          {/* Info row */}
          <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
            <div style={{background:T.card,borderRadius:10,padding:"8px 14px",border:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontFamily:F.body,fontSize:12,color:T.textMuted}}>{formatDate(task.dueDate)}{task.dueTime?` at ${formatTime(task.dueTime)}`:""}</span>
            </div>
            <div style={{background:T.card,borderRadius:10,padding:"8px 14px",border:`1px solid ${T.accent}44`,display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontFamily:F.body,fontSize:12,color:T.accent,fontWeight:500}}>
                {task.estMins>=60?`${Math.floor(task.estMins/60)}h ${task.estMins%60?`${task.estMins%60}m`:""}`:` ${task.estMins}m`} estimated
              </span>
            </div>
            {totalSessionMins>0&&<div style={{background:"#2ED57322",borderRadius:10,padding:"8px 14px",border:"1px solid #2ED57344",display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:14}}>✓</span>
              <span style={{fontFamily:F.body,fontSize:12,color:"#2ED573"}}>{totalSessionMins}m spent today</span>
            </div>}
          </div>

          {/* Priority override */}
          <div style={{background:T.card,borderRadius:14,padding:"14px",border:`1px solid ${T.border}`,marginBottom:16}}>
            <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>Priority</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
              {([null,"low","medium","high"] as const).map(p=>{
                const active=p===null?!task.priorityOverride:task.priorityOverride===p;
                const label=p===null?"Auto":p[0].toUpperCase()+p.slice(1);
                const color=p===null?T.accent:priColor(p,colorCodeUrgency);
                return <button key={p??"auto"} onClick={()=>onSetPriorityOverride(p)}
                  style={{background:active?color+"22":T.surface,border:`1.5px solid ${active?color:T.border}`,borderRadius:9,padding:"8px 4px",cursor:"pointer",color:active?color:T.textMuted,fontFamily:F.body,fontSize:11}}>
                  {label}
                </button>;
              })}
            </div>
          </div>

          {/* Subtasks */}
          <div style={{background:T.card,borderRadius:14,padding:"14px",border:`1px solid ${T.border}`,marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:subtasks.length?10:0}}>
              <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em"}}>Subtasks</div>
              {subtasks.length>0&&<div style={{fontFamily:F.body,fontSize:11,color:T.textFaint}}>{subtasks.filter(s=>s.done).length}/{subtasks.length}</div>}
            </div>
            {subtasks.length>0&&<div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
              {subtasks.map(s=>(
                <div key={s.id} style={{display:"flex",alignItems:"center",gap:8}}>
                  <button onClick={()=>onUpdateSubtasks(subtasks.map(x=>x.id===s.id?{...x,done:!x.done}:x))} style={{background:s.done?"#2ED573":"none",border:`1.5px solid ${s.done?"#2ED573":T.textFaint}`,borderRadius:"50%",width:16,height:16,cursor:"pointer",flexShrink:0,padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {s.done&&<span style={{color:"#111",fontSize:9,fontWeight:"bold"}}>✓</span>}
                  </button>
                  <span style={{flex:1,fontFamily:F.body,fontSize:12,color:s.done?T.textFaint:T.text,textDecoration:s.done?"line-through":"none"}}>{s.text}</span>
                  <button onClick={()=>onUpdateSubtasks(subtasks.filter(x=>x.id!==s.id))} style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13,lineHeight:1,padding:"0 2px"}}>×</button>
                </div>
              ))}
            </div>}
            <div style={{display:"flex",gap:6}}>
              <input value={newSubtaskText} onChange={e=>setNewSubtaskText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addSubtask()} placeholder="Add a subtask..." style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,padding:"7px 10px",fontFamily:F.body,fontSize:12,outline:"none"}}/>
              <button onClick={addSubtask} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:8,padding:"7px 12px",cursor:"pointer",fontFamily:F.body,fontSize:12,fontWeight:500}}>+</button>
            </div>
          </div>

          {/* Tags */}
          <div style={{background:T.card,borderRadius:14,padding:"14px",border:`1px solid ${T.border}`,marginBottom:16}}>
            <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:tags.length?10:0}}>Tags</div>
            {tags.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
              {tags.map(tag=>(
                <span key={tag} style={{display:"flex",alignItems:"center",gap:4,background:T.accent+"22",color:T.accent,borderRadius:999,padding:"3px 4px 3px 10px",fontFamily:F.body,fontSize:11}}>
                  {tag}
                  <button onClick={()=>onSetTags(tags.filter(x=>x!==tag))} style={{background:"none",border:"none",color:T.accent,cursor:"pointer",fontSize:13,lineHeight:1,padding:"0 4px"}}>×</button>
                </span>
              ))}
            </div>}
            <div style={{display:"flex",gap:6}}>
              <input value={newTagText} onChange={e=>setNewTagText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTag()} placeholder="Add a tag..." style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,padding:"7px 10px",fontFamily:F.body,fontSize:12,outline:"none"}}/>
              <button onClick={addTag} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:8,padding:"7px 12px",cursor:"pointer",fontFamily:F.body,fontSize:12,fontWeight:500}}>+</button>
            </div>
            {allTags.filter(t=>!tags.includes(t)).length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
              {allTags.filter(t=>!tags.includes(t)).slice(0,8).map(t=>(
                <button key={t} onClick={()=>onSetTags([...tags,t])} style={{background:"none",border:`1px dashed ${T.border}`,borderRadius:999,padding:"3px 10px",fontFamily:F.body,fontSize:10,color:T.textFaint,cursor:"pointer"}}>+{t}</button>
              ))}
            </div>}
          </div>

          {/* Session timer */}
          <div style={{background:T.card,borderRadius:16,padding:"20px",border:`1px solid ${sessionActive?T.accent+"66":T.border}`,marginBottom:16,textAlign:"center",transition:"border-color 0.3s"}}>
            {sessionActive?(
              <>
                <div style={{fontFamily:F.body,fontSize:11,color:T.accent,marginBottom:8,letterSpacing:"0.1em",textTransform:"uppercase"}}>Session in progress</div>
                <div style={{fontFamily:F.heading,fontSize:52,color:T.text,lineHeight:1,marginBottom:4}}>
                  {String(sm).padStart(2,"0")}:{String(ss).padStart(2,"0")}
                </div>
                <div style={{fontFamily:F.body,fontSize:11,color:T.textFaint,marginBottom:18}}>keep going!</div>
                <button onClick={onEndSession} style={{background:"#FF4757",color:"#fff",border:"none",borderRadius:12,padding:"13px 32px",fontFamily:F.heading,fontSize:17,cursor:"pointer",width:"100%",boxShadow:"0 4px 20px #FF475744"}}>
                  ⏹ End Session
                </button>
              </>
            ):(
              <>
                <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginBottom:8,letterSpacing:"0.1em",textTransform:"uppercase"}}>Ready to work?</div>
                <div style={{fontFamily:F.heading,fontSize:52,color:T.textFaint,lineHeight:1,marginBottom:18}}>00:00</div>
                <button onClick={onStartSession} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:12,padding:"13px 32px",fontFamily:F.heading,fontSize:17,cursor:"pointer",width:"100%",boxShadow:`0 4px 20px ${T.accentGlow}`}}>
                  ▶ Start Session
                </button>
              </>
            )}
          </div>

          {/* Session history */}
          {sessionHistory.length>0&&(
            <div style={{background:T.card,borderRadius:12,padding:"12px 14px",border:`1px solid ${T.border}`,marginBottom:16}}>
              <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Sessions today</div>
              {sessionHistory.map((s,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:i<sessionHistory.length-1?`1px solid ${T.border}33`:"none"}}>
                  <span style={{fontFamily:F.body,fontSize:12,color:T.text}}>Session {i+1}</span>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <span style={{fontFamily:F.body,fontSize:11,color:T.textFaint}}>{s.date}</span>
                    <span style={{fontFamily:F.body,fontSize:12,color:T.accent,fontWeight:500}}>{s.mins}m</span>
                  </div>
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",marginTop:8,paddingTop:8,borderTop:`1px solid ${T.border}`}}>
                <span style={{fontFamily:F.body,fontSize:12,color:T.textMuted}}>Total</span>
                <span style={{fontFamily:F.heading,fontSize:16,color:T.accent}}>{totalSessionMins}m</span>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{display:"grid",gridTemplateColumns:task.done&&!task.archived?"1fr 1fr 1fr":"1fr 1fr",gap:8}}>
            <button onClick={onToggleDone}
              style={{background:task.done?"#FF475722":"#2ED57322",color:task.done?"#FF4757":"#2ED573",border:`1px solid ${task.done?"#FF475744":"#2ED57344"}`,borderRadius:11,padding:"11px",fontFamily:F.body,fontSize:12,cursor:"pointer"}}>
              {task.done?"↩ Mark undone":"✓ Mark done"}
            </button>
            {task.done&&!task.archived&&(
              <button onClick={onArchive}
                style={{background:T.surface,color:T.textMuted,border:`1px solid ${T.border}`,borderRadius:11,padding:"11px",fontFamily:F.body,fontSize:12,cursor:"pointer"}}>
                Archive
              </button>
            )}
            <button onClick={onDelete}
              style={{background:"#FF475711",color:"#FF4757",border:"1px solid #FF475733",borderRadius:11,padding:"11px",fontFamily:F.body,fontSize:12,cursor:"pointer"}}>
              Delete task
            </button>
          </div>
          <button onClick={()=>{const name=window.prompt("Name this template:",task.title);if(name&&name.trim())onSaveAsTemplate(name.trim());}}
            style={{width:"100%",marginTop:8,background:"none",border:`1px solid ${T.border}`,borderRadius:11,padding:"10px",color:T.textMuted,fontFamily:F.body,fontSize:11,cursor:"pointer"}}>
            Save as template
          </button>
        </div>
      </div>
    </div>
  );
}

// Defined at module scope for the same reason as TaskModal above: it's
// rendered from several places (toggles in the Settings tab) and stability
// matters so it isn't torn down and recreated on every unrelated re-render.
function Toggle({on,onChange,T}:{on:boolean;onChange:(v:boolean)=>void;T:ThemeObj}){
  const trackColor=on?T.accent:T.border;
  return <button className="tog" onClick={()=>onChange(!on)} style={{background:trackColor}}>
    <span style={{position:"absolute",top:3,left:on?21:3,width:14,height:14,borderRadius:"50%",background:contrastColor(trackColor),boxShadow:"0 1px 3px rgba(0,0,0,0.4)",transition:"left 0.2s",display:"block"}}/>
  </button>;
}

// ─── TASK CARD (base) ────────────────────────────────────────────────────────
// Also module scope (see TaskModal above) -- MiniCard is rendered in a loop
// for every visible task across every layout, so being redefined (and every
// instance's DOM torn down/recreated) on each unrelated render was the most
// consequential case of this pattern in the file.
function MiniCard({task,rank,reorderable,swipeable,T,F,subjectColors,colorCodeUrgency,dragTaskId,dragOffsetY,onOpen,onToggleDone,onDelete,swipeClickGuard,swipeHandlers,swipeContentStyle,renderSwipeReveal,startDrag,onDragMove,endDrag,selectionMode,isSelected,onToggleSelect}:{
  task:Task; rank:number; reorderable?:boolean; swipeable?:boolean;
  T:ThemeObj; F:typeof FONT; subjectColors:Record<string,string>; colorCodeUrgency:boolean;
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
}) {
  const pr=getPriority(task.dueDate,task.estMins,task.priorityOverride);
  const sc=subjectColors[task.subject]||T.accent;
  const dm=daysUntil(task.dueDate);
  const isTop=rank===0&&!task.done; const isNext=rank===1&&!task.done;
  const isDragging=dragTaskId===task.id;
  return(
    <div
      className="tc"
      data-task-id={task.id}
      onClick={selectionMode?()=>onToggleSelect?.(task.id):swipeClickGuard(()=>{if(dragTaskId==null){onOpen(task);}})}
      {...(swipeable&&!selectionMode?swipeHandlers(task.id):{})}
      style={{background:isTop?T.gradientCard:T.card,borderRadius:13,padding:"13px 15px",border:`1px solid ${isSelected?T.accent:isTop?T.accent+"44":task.done?"transparent":T.border}`,position:"relative",overflow:"hidden",cursor:"pointer",transform:isDragging?`translateY(${dragOffsetY}px) scale(1.02)`:"none",transition:isDragging?"none":undefined,boxShadow:isDragging?"0 8px 24px rgba(0,0,0,0.35)":undefined,zIndex:isDragging?10:undefined,touchAction:isDragging?"none":swipeable?"pan-y":undefined,pointerEvents:isDragging?"none":undefined}}>
      {swipeable&&!selectionMode&&renderSwipeReveal(task.id)}
      {!task.done&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:priColor(pr,colorCodeUrgency),borderRadius:"13px 0 0 13px"}}/>}
      <div style={{paddingLeft:8,display:"flex",alignItems:"flex-start",gap:9,...(swipeable?swipeContentStyle(task.id):{})}}>
        {reorderable&&!task.done&&!selectionMode&&(
          <div
            onClick={e=>e.stopPropagation()}
            onPointerDown={e=>{e.stopPropagation();startDrag(task.id,e);}}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{color:T.textFaint,cursor:isDragging?"grabbing":"grab",fontSize:14,lineHeight:1,marginTop:2,padding:"0 2px",touchAction:"none",flexShrink:0}}>
            ⠿
          </div>
        )}
        <button onClick={e=>{e.stopPropagation();if(selectionMode){onToggleSelect?.(task.id);}else{onToggleDone(task.id);}}} style={{background:selectionMode?(isSelected?T.accent:"none"):task.done?"#2ED573":"none",border:`2px solid ${selectionMode?(isSelected?T.accent:T.textFaint):task.done?"#2ED573":T.textFaint}`,borderRadius:selectionMode?4:"50%",width:19,height:19,cursor:"pointer",flexShrink:0,marginTop:2,display:"flex",alignItems:"center",justifyContent:"center",padding:0,transition:"all 0.2s"}}>
          {(selectionMode?isSelected:task.done)&&<span style={{color:selectionMode?contrastColor(T.accent):"#111",fontSize:10,fontWeight:"bold"}}>✓</span>}
        </button>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
            {isTop&&<span className="rb" style={{background:T.accent+"33",color:T.accent}}>do first</span>}
            {isNext&&<span className="rb" style={{background:T.text+"11",color:T.textMuted}}>next up</span>}
            <span style={{fontFamily:F.heading,fontSize:15,textDecoration:task.done?"line-through":"none",color:task.done?T.textFaint:T.text}}>{task.title}</span>
            {task.recurrence&&task.recurrence!=="none"&&<span title={`Repeats ${task.recurrence}`} style={{color:T.textMuted,fontSize:12}}>↻</span>}
            <span style={{background:sc+"22",color:sc,borderRadius:999,padding:"2px 8px",fontFamily:F.body,fontSize:10}}>{task.subject}</span>
            {task.priorityOverride&&<span title="Manually set priority" style={{color:T.textFaint,fontSize:10}}>•</span>}
            {task.tags?.map(tag=><span key={tag} style={{color:T.textMuted,fontFamily:F.body,fontSize:10}}>#{tag}</span>)}
          </div>
          <div style={{display:"flex",gap:12,marginTop:4,flexWrap:"wrap"}}>
            <span style={{fontFamily:F.body,fontSize:11,color:T.textMuted}}>{formatDate(task.dueDate)}{task.dueTime?` ${formatTime(task.dueTime)}`:""}</span>
            <span style={{fontFamily:F.body,fontSize:11,color:T.textMuted}}>{task.estMins>=60?`${Math.floor(task.estMins/60)}h${task.estMins%60?` ${task.estMins%60}m`:""}`:` ${task.estMins}m`}</span>
            {!task.done&&dm&&<span style={{fontFamily:F.body,fontSize:11,color:priColor(pr,colorCodeUrgency),fontWeight:500}}>{dm}</span>}
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
        {!selectionMode&&<button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:15,padding:"2px 5px",lineHeight:1}} onClick={e=>{e.stopPropagation();onDelete(task.id);}}>×</button>}
      </div>
    </div>
  );
}

// ─── PROFILE MODAL ────────────────────────────────────────────────────────────
// Also module scope (see TaskModal/MiniCard above) -- notably, this fixed a
// real bug on top of the perf/remount concern: the "Add a subject" field used
// to be an uncontrolled ref-based input, and since this component was being
// recreated on every unrelated parent re-render, a background update (a
// Firestore sync landing, etc.) while the user was mid-typing would silently
// wipe out the text. newSubjectText/setNewSubjectText are lifted to the
// parent specifically so they survive that; being hoisted now means this
// component itself is no longer being recreated in the first place either.
function ProfileModal({T,F,fbUser,signInError,syncError,visibleTasks,totalMins,subjects,subjectColors,colorCodeUrgency,themeName,newSubjectText,setNewSubjectText,profileTab,setProfileTab,setShowProfile,signInWithFirebase,signOutFirebase,addSubject,removeSubject}:{
  T:ThemeObj; F:typeof FONT;
  fbUser:User|null; signInError:string|null; syncError:string|null;
  visibleTasks:Task[]; totalMins:number;
  subjects:string[]; subjectColors:Record<string,string>; colorCodeUrgency:boolean;
  themeName:ThemeName;
  newSubjectText:string; setNewSubjectText:(v:string)=>void;
  profileTab:"profile"|"personalize"; setProfileTab:(v:"profile"|"personalize")=>void;
  setShowProfile:(v:boolean)=>void;
  signInWithFirebase:()=>Promise<void>;
  signOutFirebase:()=>Promise<void>;
  addSubject:(name:string)=>void;
  removeSubject:(name:string)=>void;
}) {
  const doneTasks=visibleTasks.filter(t=>t.done).length;
  const totalTasks=visibleTasks.length;
  const highPri=visibleTasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins,t.priorityOverride)==="high").length;
  const pct=totalTasks>0?Math.round(doneTasks/totalTasks*100):0;
  const subjectCounts=subjects.map(s=>({name:s,count:visibleTasks.filter(t=>t.subject===s).length,color:subjectColors[s]})).filter(s=>s.count>0).sort((a,b)=>b.count-a.count);

  if (!fbUser) return (
    // ── SIGN IN SCREEN (monkeytype-style) ─────────────────────────────────────
    <div style={{position:"fixed",inset:0,background:T.bg,zIndex:1000,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px"}}>
      <button onClick={()=>setShowProfile(false)} style={{position:"absolute",top:20,right:20,background:"none",border:"none",color:T.textFaint,fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>
      {/* Logo */}
      <div style={{marginBottom:40,textAlign:"center"}}>
        <div style={{fontFamily:F.heading,fontSize:42,color:T.accent,lineHeight:1}}>Due<span style={{color:T.text}}>Planner</span></div>
        <div style={{fontFamily:F.body,fontSize:12,color:T.textFaint,marginTop:6}}>due. studios · sync across devices</div>
      </div>
      {/* Sign in box */}
      <div style={{width:"100%",maxWidth:340}}>
        <button onClick={signInWithFirebase}
          style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:12,background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px 20px",cursor:"pointer",marginBottom:12,transition:"all 0.15s"}}>
          {/* Google icon */}
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/></svg>
          <span style={{fontFamily:F.body,fontSize:13,color:T.text}}>Continue with Google</span>
        </button>
        {signInError&&<div style={{textAlign:"center",fontFamily:F.body,fontSize:11,color:"#FF4757",marginBottom:12,lineHeight:1.5}}>{signInError}</div>}
        <div style={{textAlign:"center",fontFamily:F.body,fontSize:11,color:T.textFaint,lineHeight:1.6}}>
          By signing in you agree to have your homework data synced across your devices. No data is shared with third parties.
        </div>
      </div>
      {/* Bookmark button */}
      <button onClick={()=>{
        if(navigator.share){navigator.share({title:"DuePlanner",url:window.location.href}).catch(()=>{});}
        else{navigator.clipboard?.writeText(window.location.href);alert("Link copied! Open Safari and paste, then Share → Add to Home Screen.");}
      }} style={{width:"100%",maxWidth:340,background:"none",border:`1px solid ${T.border}`,borderRadius:12,padding:"12px",fontFamily:F.body,fontSize:12,color:T.textMuted,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginTop:12}}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 2L12 16M12 2L7 7M12 2L17 7" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 16V20C3 21.1 3.9 22 5 22H19C20.1 22 21 21.1 21 20V16" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round"/></svg>
        Add to Home Screen
      </button>
      {/* Decorative divider */}
      <div style={{position:"absolute",bottom:40,display:"flex",alignItems:"center",gap:12}}>
        <div style={{height:1,width:60,background:T.border}}/>
        <span style={{fontFamily:F.body,fontSize:10,color:T.textFaint}}>due. studios</span>
        <div style={{height:1,width:60,background:T.border}}/>
      </div>
    </div>
  );

  // ── PROFILE SCREEN (signed in) ─────────────────────────────────────────────
  return (
    <div style={{position:"fixed",inset:0,background:T.bg,zIndex:1000,overflowY:"auto"}}>
      <div style={{maxWidth:560,margin:"0 auto",padding:"20px 16px 40px"}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div style={{fontFamily:F.heading,fontSize:22,color:T.accent}}>profile</div>
          <button onClick={()=>{setShowProfile(false);setProfileTab("profile");setNewSubjectText("");}} style={{background:"none",border:"none",color:T.textFaint,fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:4,marginBottom:24,background:T.surface,borderRadius:11,padding:3}}>
          {(["profile","personalize"] as const).map(id=>{
            const labels:Record<string,string>={profile:"Profile",personalize:"Personalization"};
            return <button key={id} onClick={()=>setProfileTab(id)} style={{flex:1,background:profileTab===id?T.card:"transparent",color:profileTab===id?T.text:T.textMuted,fontFamily:F.body,fontSize:11,border:"none",borderRadius:9,padding:"8px 6px",cursor:"pointer",transition:"all 0.15s",fontWeight:profileTab===id?"500":"normal"}}>{labels[id]}</button>;
          })}
        </div>

        {profileTab==="personalize"&&(
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:2}}>Subjects</div>
            {subjects.map(s=>{
              const isDefault=(DEFAULT_SUBJECTS as string[]).includes(s);
              return (
                <div key={s} style={{display:"flex",alignItems:"center",gap:10,background:T.card,borderRadius:12,padding:"11px 14px",border:`1px solid ${T.border}`}}>
                  <div style={{width:12,height:12,borderRadius:"50%",background:subjectColors[s]||T.accent,flexShrink:0}}/>
                  <span style={{flex:1,fontFamily:F.body,fontSize:13,color:T.text}}>{s}</span>
                  {isDefault&&<span style={{fontFamily:F.body,fontSize:9,color:T.textFaint,textTransform:"uppercase",letterSpacing:"0.05em"}}>default</span>}
                  <button onClick={()=>{if(window.confirm(`Delete "${s}"? This won't remove it from tasks that already use it.`))removeSubject(s);}} style={{background:"none",border:"none",color:T.textFaint,fontSize:16,cursor:"pointer",lineHeight:1,padding:"0 4px"}}>×</button>
                </div>
              );
            })}
            <form onSubmit={e=>{e.preventDefault();addSubject(newSubjectText);setNewSubjectText("");}} style={{display:"flex",gap:8,marginTop:8}}>
              <input value={newSubjectText} onChange={e=>setNewSubjectText(e.target.value)} placeholder="Add a subject..." style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,color:T.text,padding:"10px 13px",fontFamily:F.body,fontSize:13,outline:"none"}}/>
              <button type="submit" style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:10,padding:"10px 16px",cursor:"pointer",fontWeight:500}}>Add</button>
            </form>
          </div>
        )}

        {profileTab==="profile"&&(<>
        {/* Avatar + name */}
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:32}}>
          <div style={{position:"relative",marginBottom:14}}>
            {fbUser.photoURL
              ? <img src={fbUser.photoURL} alt="" style={{width:80,height:80,borderRadius:"50%",objectFit:"cover",border:`3px solid ${T.accent}`}}/>
              : <div style={{width:80,height:80,borderRadius:"50%",background:T.surface,border:`3px solid ${T.accent}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill={T.textMuted}/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round"/></svg>
                </div>
            }
            <div style={{position:"absolute",bottom:2,right:2,width:16,height:16,borderRadius:"50%",background:"#2ED573",border:`2px solid ${T.bg}`}}/>
          </div>
          <div style={{fontFamily:F.heading,fontSize:24,color:T.text,marginBottom:4}}>{fbUser.displayName}</div>
          <div style={{fontFamily:F.body,fontSize:12,color:T.textFaint,marginBottom:8}}>{fbUser.email}</div>
          <div style={{display:"flex",alignItems:"center",gap:6,background:syncError?"#FF475722":"#2ED57322",borderRadius:999,padding:"4px 12px",border:`1px solid ${syncError?"#FF475744":"#2ED57344"}`}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:syncError?"#FF4757":"#2ED573"}}/>
            <span style={{fontFamily:F.body,fontSize:11,color:syncError?"#FF4757":"#2ED573"}}>{syncError?"Sync issue":"Synced across devices"}</span>
          </div>
          {syncError&&<div style={{fontFamily:F.body,fontSize:11,color:"#FF4757",marginTop:8,textAlign:"center",maxWidth:280,lineHeight:1.5}}>{syncError}</div>}
        </div>

        {/* Progress ring + stats */}
        <div style={{background:T.card,borderRadius:16,padding:"20px",border:`1px solid ${T.border}`,marginBottom:14,display:"flex",alignItems:"center",gap:20}}>
          {/* Ring */}
          <div style={{position:"relative",width:80,height:80,flexShrink:0}}>
            <svg width="80" height="80" style={{transform:"rotate(-90deg)"}}>
              <circle cx="40" cy="40" r="33" fill="none" stroke={T.border} strokeWidth="7"/>
              <circle cx="40" cy="40" r="33" fill="none" stroke={T.accent} strokeWidth="7" strokeDasharray="207" strokeDashoffset={207*(1-pct/100)} strokeLinecap="round" style={{transition:"stroke-dashoffset 0.8s"}}/>
            </svg>
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{fontFamily:F.heading,fontSize:18,color:T.text}}>{pct}%</span>
            </div>
          </div>
          <div style={{flex:1}}>
            <div style={{fontFamily:F.heading,fontSize:13,color:T.textMuted,marginBottom:10}}>completion</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[{l:"Total",v:totalTasks,c:T.text},{l:"Done",v:doneTasks,c:"#2ED573"},{l:"Pending",v:totalTasks-doneTasks,c:T.accent},{l:"Urgent",v:highPri,c:priColor("high",colorCodeUrgency)}].map(s=>(
                <div key={s.l}>
                  <div style={{fontFamily:F.heading,fontSize:20,color:s.c}}>{s.v}</div>
                  <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint}}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Time stats */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
          <div style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.border}`}}>
            <div style={{fontFamily:F.heading,fontSize:26,color:T.accent}}>{(totalMins/60).toFixed(1)}h</div>
            <div style={{fontFamily:F.body,fontSize:11,color:T.textFaint,marginTop:2}}>estimated left</div>
          </div>
          <div style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.border}`}}>
            <div style={{fontFamily:F.heading,fontSize:26,color:"#4ECDC4"}}>{visibleTasks.filter(t=>t.done).reduce((a,b)=>a+(b.estMins||0),0)}m</div>
            <div style={{fontFamily:F.body,fontSize:11,color:T.textFaint,marginTop:2}}>completed work</div>
          </div>
        </div>

        {/* Subject breakdown */}
        {subjectCounts.length>0&&(
          <div style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.border}`,marginBottom:14}}>
            <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:12}}>By subject</div>
            {subjectCounts.map(s=>(
              <div key={s.name} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontFamily:F.body,fontSize:12,color:T.text}}>{s.name}</span>
                  <span style={{fontFamily:F.body,fontSize:11,color:T.textFaint}}>{s.count} task{s.count!==1?"s":""}</span>
                </div>
                <div style={{height:5,background:T.border,borderRadius:999}}>
                  <div style={{width:`${Math.round(s.count/totalTasks*100)}%`,height:"100%",background:s.color,borderRadius:999,transition:"width 0.5s"}}/>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Theme + font info */}
        <div style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.border}`,marginBottom:20}}>
          <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:12}}>Current setup</div>
          <div style={{display:"flex",gap:10}}>
            <div style={{flex:1,background:T.surface,borderRadius:10,padding:"10px 12px"}}>
              <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginBottom:3}}>Theme</div>
              <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:10,height:10,borderRadius:"50%",background:T.accent}}/><span style={{fontFamily:F.body,fontSize:12,color:T.text}}>{THEMES[themeName].name}</span></div>
            </div>
            <div style={{flex:1,background:T.surface,borderRadius:10,padding:"10px 12px"}}>
              <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginBottom:3}}>Font</div>
              <span style={{fontFamily:F.heading,fontSize:12,color:T.text}}>{FONT.name}</span>
            </div>
          </div>
        </div>

        {/* Sign out */}
        <button onClick={async()=>{await signOutFirebase();setShowProfile(false);}}
          style={{width:"100%",background:"none",border:`1px solid #FF475744`,borderRadius:12,padding:"13px",color:"#FF4757",fontFamily:F.body,fontSize:13,cursor:"pointer"}}>
          Sign out
        </button>
        </>)}
      </div>
    </div>
  );
}

export default function HomeworkPlanner() {
  const [tasks,setTasks]=useState<Task[]>(()=>{
    try{
      const s=localStorage.getItem("hw-tasks");
      const loaded:Task[]=s?JSON.parse(s):DEFAULT_TASKS;
      // Backfill order for tasks saved before drag-to-reorder existed.
      return loaded.map((t,i)=>t.order===undefined?{...t,order:i}:t);
    }catch{return DEFAULT_TASKS;}
  });
  const [selectedTask,setSelectedTask]=useState<Task|null>(null);
  const [themeMode,setThemeMode]=usePersistedState<"light"|"dark"|"auto">("hw-thememode","auto");
  const [systemPrefersDark,setSystemPrefersDark]=useState(()=>typeof window!=="undefined"&&!!window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(()=>{
    if(typeof window==="undefined"||!window.matchMedia)return;
    const mq=window.matchMedia("(prefers-color-scheme: dark)");
    const handler=(e:MediaQueryListEvent)=>setSystemPrefersDark(e.matches);
    mq.addEventListener("change",handler);
    return()=>mq.removeEventListener("change",handler);
  },[]);
  const effectiveThemeMode:"light"|"dark"=themeMode==="auto"?(systemPrefersDark?"dark":"light"):themeMode;
  // There's exactly one theme per light/dark category (Stealth / Stealth Light),
  // so the theme is fully determined by effectiveThemeMode -- no independent
  // theme choice, no per-category "last picked" memory, and nothing to correct
  // when the mode changes.
  const themeName:ThemeName=effectiveThemeMode==="light"?"stealthLight":"stealth";
  const [layout,setLayout]=usePersistedState<LayoutName>("hw-layout","list");
  const [groupBy,setGroupBy]=usePersistedState("hw-group","none");
  const [showDone,setShowDone]=usePersistedState("hw-showdone",true);
  const [showSuggestion,setShowSuggestion]=usePersistedState("hw-showsuggestion",true);
  // 0 = never auto-archive. Otherwise the number of days after completion before
  // a done task is automatically archived (checked once on load).
  const [autoArchiveDays,setAutoArchiveDays]=usePersistedState("hw-autoarchive",7);
  // Auto-archive: re-checked whenever tasks (local edits, or a Firestore sync
  // landing) or the setting change. Idempotent -- once a task is archived this
  // finds nothing new to do and no-ops, so it can't loop or fight manual unarchive.
  // This is a genuine side effect (archiving based on wall-clock time having
  // passed, not on a prop mirroring another prop), so it belongs in a useEffect
  // per React's own guidance -- react-hooks/set-state-in-effect's heuristic
  // doesn't distinguish that from the "adjusting state" anti-pattern it targets.
  useEffect(()=>{
    if(autoArchiveDays<=0)return;
    const cutoff=Date.now()-autoArchiveDays*86400000;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTasks(prev=>{
      let changed=false;
      const next=prev.map(t=>{
        if(t.done&&!t.archived&&t.completedAt&&t.completedAt<cutoff){changed=true;return {...t,archived:true};}
        return t;
      });
      return changed?next:prev;
    });
  },[tasks,autoArchiveDays]);

  // Due date reminders. NOTE: this is Notification API only, no service worker --
  // it only fires while the tab is open (or gets reopened/refocused), never as
  // true background push when the tab/browser is fully closed.
  const [notificationsEnabled,setNotificationsEnabled]=usePersistedState("hw-notifications",false);
  const [notificationNote,setNotificationNote]=useState<string|null>(null);
  async function toggleNotifications(next:boolean){
    if(!next){ setNotificationsEnabled(false); setNotificationNote(null); return; }
    if(!("Notification" in window)){ setNotificationNote("Notifications aren't supported in this browser."); setNotificationsEnabled(false); return; }
    const perm=await Notification.requestPermission();
    if(perm==="granted"){ setNotificationsEnabled(true); setNotificationNote(null); }
    else { setNotificationsEnabled(false); setNotificationNote("Notifications were blocked -- allow them for this site in your browser settings to turn this on."); }
  }
  // Multiple, independently-toggleable lead times for tasks that have a
  // specific due TIME (not just a date) -- e.g. both "1 day before" and
  // "1 hour before" can be on at once. Tasks without a due time fall back to
  // the plain once-daily due/overdue summary below, since there's no time to
  // offset from.
  const [enabledOffsets,setEnabledOffsets]=usePersistedState<string[]>("hw-reminder-offsets",["0"]);
  function toggleOffset(key:string){
    setEnabledOffsets(prev=>prev.includes(key)?prev.filter(k=>k!==key):[...prev,key]);
  }
  useEffect(()=>{
    if(!notificationsEnabled)return;
    if(!("Notification" in window)||Notification.permission!=="granted")return;
    function checkDue(){
      if(document.hidden)return;
      const today=todayISO();
      if(localStorage.getItem("hw-last-notified")!==today){
        const due=tasks.filter(t=>!t.done&&!t.archived&&t.dueDate&&t.dueDate<=today);
        if(due.length>0){
          localStorage.setItem("hw-last-notified",today);
          const title=due.length===1?`"${due[0].title}" is due`:`${due.length} tasks due or overdue`;
          new Notification(title,{body:due.slice(0,3).map(t=>t.title).join(", ")});
        }
      }
      // Offset-based reminders, only for tasks with a specific due time --
      // fires once per (task, offset, due-datetime) combo, tracked so
      // editing a task's due date/time naturally resets which reminders
      // are still owed for it.
      if(enabledOffsets.length===0)return;
      let sent:Record<string,true>={};
      try{sent=JSON.parse(localStorage.getItem("hw-sent-reminders")||"{}");}catch{/* ignore */}
      const now=Date.now();
      let changed=false;
      for(const t of tasks){
        if(t.done||t.archived||!t.dueDate||!t.dueTime)continue;
        const dueAt=new Date(`${t.dueDate}T${t.dueTime}`).getTime();
        for(const offset of REMINDER_OFFSETS){
          if(!enabledOffsets.includes(offset.key))continue;
          const remindAt=dueAt-offset.mins*60000;
          const sentKey=`${t.id}-${offset.key}-${t.dueDate}T${t.dueTime}`;
          if(now>=remindAt&&now<dueAt&&!sent[sentKey]){
            new Notification(`"${t.title}" is due ${offset.mins===0?"now":`in ${offset.label.replace(" before","")}`}`,{body:`${formatDate(t.dueDate)} at ${formatTime(t.dueTime)}`});
            sent[sentKey]=true;
            changed=true;
          }
        }
      }
      if(changed)localStorage.setItem("hw-sent-reminders",JSON.stringify(sent));
    }
    checkDue();
    document.addEventListener("visibilitychange",checkDue);
    // Offset reminders need to fire close to a specific time, not just when
    // the tab regains focus, so also re-check periodically while it's open.
    const interval=setInterval(checkDue,60000);
    return ()=>{document.removeEventListener("visibilitychange",checkDue);clearInterval(interval);};
  },[notificationsEnabled,tasks,enabledOffsets]);

  // Desktop layout: "narrow" (default, current single-column look), "wide" (roomier
  // center column), "sidebar" (tabs move into a persistent left nav column). All of
  // these only kick in above a min-width via CSS media queries, so phones/tablets
  // always render the same single narrow column regardless of this setting.
  const [desktopLayout,setDesktopLayout]=usePersistedState("hw-desktoplayout","narrow");
  // Red/orange/green priority coloring, toggleable off in favor of one neutral
  // gray (NEUTRAL_PRIORITY_COLOR) everywhere urgency is shown -- default on.
  const [colorCodeUrgency,setColorCodeUrgency]=usePersistedState("hw-colorcode-urgency",true);
  const [subjects,setSubjects]=usePersistedState<string[]>("hw-subjects",DEFAULT_SUBJECTS);
  const [subjectColors,setSubjectColors]=useState<Record<string,string>>(()=>{try{const s=localStorage.getItem("hw-subjectcolors");return {...DEFAULT_SUBJECT_COLORS,...(s?JSON.parse(s):{})};}catch{return DEFAULT_SUBJECT_COLORS;}});
  useEffect(()=>{localStorage.setItem("hw-subjectcolors",JSON.stringify(subjectColors));},[subjectColors]);
  const [templates,setTemplates]=usePersistedState<TaskTemplate[]>("hw-templates",[]);
  function saveAsTemplate(task:Task,name:string){
    setTemplates(prev=>[...prev,{id:String(nextId()),name,subject:task.subject,estMins:task.estMins,recurrence:task.recurrence,subtasks:(task.subtasks||[]).map(s=>({text:s.text}))}]);
  }
  function deleteTemplate(id:string){
    setTemplates(prev=>prev.filter(t=>t.id!==id));
  }
  // Scratchpad: the textarea itself is fully responsive (plain local state), but
  // what gets written to localStorage/Firestore is debounced ~500ms behind it so
  // typing doesn't fire a write (and a Firestore sync) on every keystroke.
  const [scratchpad,setScratchpad]=useState(()=>localStorage.getItem("hw-scratchpad")||"");
  const [scratchpadSynced,setScratchpadSynced]=useState(scratchpad);
  const scratchpadTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  function updateScratchpad(val:string){
    setScratchpad(val);
    clearTimeout(scratchpadTimer.current);
    scratchpadTimer.current=setTimeout(()=>setScratchpadSynced(val),500);
  }
  useEffect(()=>{localStorage.setItem("hw-scratchpad",scratchpadSynced);},[scratchpadSynced]);
  function addSubject(name:string){
    const trimmed=name.trim();
    if(!trimmed||subjects.includes(trimmed))return;
    const used=new Set(Object.values(subjectColors));
    const color=SUBJECT_COLOR_PALETTE.find(c=>!used.has(c))||SUBJECT_COLOR_PALETTE[subjects.length%SUBJECT_COLOR_PALETTE.length];
    setSubjects(prev=>[...prev,trimmed]);
    setSubjectColors(prev=>({...prev,[trimmed]:color}));
  }
  function removeSubject(name:string){
    setSubjects(prev=>prev.filter(s=>s!==name));
    setSubjectColors(prev=>{const next={...prev};delete next[name];return next;});
  }

  useEffect(()=>{localStorage.setItem("hw-tasks",JSON.stringify(tasks));},[tasks]);
  // Clears any stale custom-accent override from before this feature was removed,
  // so a leftover value can't silently hijack T.accent away from the active
  // theme's own black/white accent (this is what caused text using color:T.accent
  // to render invisible against a background it was never designed for).
  useEffect(()=>{localStorage.removeItem("hw-accent");},[]);
  // Clears any stale per-user font choice from before the Font picker was
  // removed (down to exactly one font now, same treatment as hw-accent above).
  useEffect(()=>{localStorage.removeItem("hw-font");},[]);

  // ── FIREBASE AUTH ─────────────────────────────────────────────────────────────
  const [fbUser,setFbUser]=useState<User|null>(null);
  const [fbLoading,setFbLoading]=useState(true);
  const [signInError,setSignInError]=useState<string|null>(null);
  // Surfaces a failure from either half of the Firestore sync (read or write)
  // -- previously both failed completely silently, so a permission error or
  // dropped connection meant edits just never reached the cloud with no way
  // for the user to know their data wasn't actually syncing.
  const [syncError,setSyncError]=useState<string|null>(null);
  const isSyncingProfile=useRef(false);
  const isSyncingTasks=useRef(false);
  // Guards each "save TO Firestore" effect below from firing before we've
  // heard back from Firestore, for THIS uid specifically, even once. Without
  // this, signing in on a device that still has different local/default data
  // races the outbound save against the inbound read -- if the save's
  // isSyncing window covers the moment the real snapshot arrives, that
  // snapshot gets dropped and the stale local data gets written over the
  // user's actual cloud data instead of the other way around. Storing the uid
  // we've synced (not just a boolean) means a direct switch from one
  // signed-in account to another -- or a sign-out/sign-back-in as the same
  // account -- can't leave a stale "synced" flag pointing at the wrong (or
  // now-outdated) snapshot. Reactive state, not a ref -- an empty result
  // (nothing to apply) still needs to flip this via a re-render, and a ref
  // mutation alone wouldn't trigger that.
  const [profileSyncedForUid,setProfileSyncedForUid]=useState<string|null>(null);
  const [tasksSyncedForUid,setTasksSyncedForUid]=useState<string|null>(null);
  // What's currently believed to be in the tasks subcollection (from the last
  // read OR the last successful write), keyed by task id -- lets the "save
  // tasks" effect below write only what actually changed instead of
  // overwriting every task on every edit. This is the entire point of tasks
  // living in a subcollection instead of one array field: see
  // migrateLegacyTasks below for the old shape this replaces, and why it
  // stopped scaling (every edit, however small, rewrote every task ever
  // created, and the whole document could hit Firestore's 1MB size limit for
  // a long-time user).
  const lastSyncedTasksRef=useRef<Map<number,Task>>(new Map());
  // Gates both live listeners below until any one-time legacy-data migration
  // for this uid has been checked (and, if needed, completed) -- see
  // migrateLegacyTasks. Without this, the tasks-subcollection listener could
  // see "genuinely empty" on a pre-migration existing account (wiping local
  // tasks the instant it fires) before the migration's own write has a chance
  // to land.
  const [readyForUid,setReadyForUid]=useState<string|null>(null);
  // Whether THIS uid had no profile document at all the moment migration was
  // checked -- i.e. a genuinely first-ever sign-in, never synced before. An
  // empty tasks subcollection is ambiguous on its own (brand new account with
  // nothing to sync down yet, vs. a returning account that legitimately has
  // zero tasks right now); this disambiguates it so the tasks-FROM listener
  // knows not to apply an empty result -- and so wipe local state -- for a
  // brand-new account, while still respecting a real "zero tasks" for anyone
  // who has synced before.
  const [isNewAccountForUid,setIsNewAccountForUid]=useState<string|null>(null);

  // Listen for auth state
  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,user=>{
      setFbUser(user);
      setFbLoading(false);
      if(user) localStorage.removeItem("hw-signin-redirect-pending");
      else { setProfileSyncedForUid(null); setTasksSyncedForUid(null); setReadyForUid(null); setIsNewAccountForUid(null); }
    });
    // Only relevant if signInWithFirebase had to fall back to the redirect
    // method below (e.g. a browser that blocks/mishandles the popup) -- this
    // is where any error from THAT flow surfaces, since there's no popup
    // promise to catch in that case.
    getRedirectResult(auth).then(result=>{
      const pending=localStorage.getItem("hw-signin-redirect-pending");
      if(!result&&pending&&Date.now()-Number(pending)<5*60*1000){
        // A redirect sign-in was started but Firebase came back with no user
        // and no thrown error -- this is one of two ways storage-blocking
        // shows up; see isStorageBlockedError above for the other (thrown)
        // shape, caught below.
        setSignInError(STORAGE_BLOCKED_MESSAGE);
      }
      localStorage.removeItem("hw-signin-redirect-pending");
    }).catch(e=>{
      console.error(e);
      if(isStorageBlockedError(e)){
        setSignInError(STORAGE_BLOCKED_MESSAGE);
      } else {
        const code=(e as {code?:string})?.code||"unknown";
        setSignInError(`Sign-in didn't go through (${code}). Please try again.`);
      }
      localStorage.removeItem("hw-signin-redirect-pending");
    });
    return unsub;
  },[]);

  // One-time-per-uid: move any pre-existing "tasks" array field from the old
  // single-document shape into the users/{uid}/tasks subcollection, then
  // remove it. Runs to completion (readyForUid gates both live listeners
  // below) before either one attaches, so there's no window where the
  // subcollection listener could see "genuinely empty" on an account that
  // actually still has legacy data waiting to move.
  useEffect(()=>{
    // Sign-out already resets readyForUid (and the other uid-keyed sync
    // state) from the auth-listener's callback above, so nothing to do here.
    if(!fbUser)return;
    let cancelled=false;
    (async()=>{
      try{
        const profileRef=doc(db,"users",fbUser.uid);
        const snap=await getDoc(profileRef);
        const isNew=!snap.exists();
        const data=snap.exists()?snap.data():null;
        if(data&&Array.isArray(data.tasks)){
          const tasksCol=collection(db,"users",fbUser.uid,"tasks");
          const existing=await getDocs(tasksCol);
          if(existing.empty&&data.tasks.length>0){
            const batch=writeBatch(db);
            for(const t of data.tasks as Task[]) batch.set(doc(tasksCol,String(t.id)),t);
            // Only commit the new docs, then clear the legacy field, after
            // confirming the subcollection is actually empty -- if anything
            // here throws, the legacy field is left in place so the next
            // load just retries the whole check from scratch.
            await batch.commit();
          }
          await updateDoc(profileRef,{tasks:deleteField()});
        }
        if(!cancelled) setIsNewAccountForUid(isNew?fbUser.uid:null);
      }catch(err){
        console.error(err);
        if(!cancelled) setSyncError("Couldn't prepare cloud sync. Please try again.");
      }finally{
        if(!cancelled) setReadyForUid(fbUser.uid);
      }
    })();
    return ()=>{cancelled=true;};
  },[fbUser]);

  // Sync the small "profile" fields (not tasks -- those live in their own
  // subcollection, synced separately below) FROM Firestore.
  useEffect(()=>{
    if(!fbUser||readyForUid!==fbUser.uid)return;
    const ref=doc(db,"users",fbUser.uid);
    const unsub=onSnapshot(ref,snap=>{
      if(snap.exists()&&!isSyncingProfile.current){
        const data=snap.data();
        // Firestore data is untyped (DocumentData) -- a malformed or legacy
        // document (e.g. from an older buggy version, or a manual edit in the
        // console) could otherwise inject a wrong-shaped value straight into
        // state and crash a render. Cheap shape checks before applying.
        if(typeof data.layout==="string"&&data.layout in LAYOUTS) setLayout(data.layout as LayoutName);
        if(typeof data.scratchpad==="string"){ setScratchpad(data.scratchpad); setScratchpadSynced(data.scratchpad); }
      }
      setProfileSyncedForUid(fbUser.uid);
      setSyncError(null);
    },err=>{
      console.error(err);
      setSyncError("Couldn't sync with the cloud -- your changes are saved on this device, but may not reach your other devices until this is resolved.");
    });
    return unsub;
  },[fbUser,readyForUid,setLayout]);

  // Save the profile fields TO Firestore whenever they change. Gated on
  // profileSyncedForUid matching the current user so the very first write
  // can't fire before we know what's actually in the user's cloud doc.
  useEffect(()=>{
    if(!fbUser||profileSyncedForUid!==fbUser.uid)return;
    isSyncingProfile.current=true;
    const ref=doc(db,"users",fbUser.uid);
    setDoc(ref,{layout,scratchpad:scratchpadSynced},{merge:true})
      .then(()=>setSyncError(null))
      .catch(err=>{
        console.error(err);
        setSyncError("Couldn't save to the cloud -- your changes are safe on this device, but won't reach your other devices until this is resolved.");
      })
      .finally(()=>{isSyncingProfile.current=false;});
  },[layout,scratchpadSynced,fbUser,profileSyncedForUid]);

  // Sync tasks FROM the tasks subcollection.
  useEffect(()=>{
    if(!fbUser||readyForUid!==fbUser.uid)return;
    const tasksCol=collection(db,"users",fbUser.uid,"tasks");
    const unsub=onSnapshot(tasksCol,snap=>{
      if(!isSyncingTasks.current){
        // An empty subcollection is ambiguous on its own: a brand-new account
        // with nothing synced yet vs. a returning account that legitimately
        // has zero tasks right now. isNewAccountForUid (set by the migration
        // effect above, from whether a profile doc existed at all) tells
        // them apart -- for a genuinely new account, leave local state (e.g.
        // DEFAULT_TASKS) alone so the save effect below pushes it up as the
        // first write, instead of wiping it with this empty read.
        if(!(snap.empty&&isNewAccountForUid===fbUser.uid)){
          const loaded=snap.docs
            .map(d=>d.data())
            .filter((t):t is Task=>typeof t.id==="number"&&typeof t.title==="string"); // shape guard, see profile sync above
          setTasks(loaded);
          lastSyncedTasksRef.current=new Map(loaded.map(t=>[t.id,t]));
        }
      }
      setTasksSyncedForUid(fbUser.uid);
      setSyncError(null);
    },err=>{
      console.error(err);
      setSyncError("Couldn't sync with the cloud -- your changes are saved on this device, but may not reach your other devices until this is resolved.");
    });
    return unsub;
  },[fbUser,readyForUid,isNewAccountForUid]);

  // Save tasks TO the tasks subcollection whenever they change -- but only
  // the individual tasks that actually changed (added, edited, or removed),
  // diffed against lastSyncedTasksRef, rather than overwriting the whole
  // collection. This is the entire point of tasks living in a subcollection
  // instead of one array field: toggling a single task no longer rewrites
  // every other task along with it.
  //
  // Debounced (like the scratchpad above) so a burst of rapid local changes
  // collapses into one write instead of one per change -- most notably,
  // drag-to-reorder calls setTasks() on every card the dragged item passes
  // over, which without this would fire a separate Firestore batch write per
  // intermediate step of a single drag gesture instead of just one at the
  // end. Local state (and localStorage) still update instantly either way --
  // only the outbound cloud write is delayed.
  const tasksSaveTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>{
    if(!fbUser||tasksSyncedForUid!==fbUser.uid)return;
    clearTimeout(tasksSaveTimer.current);
    tasksSaveTimer.current=setTimeout(()=>{
      const prevMap=lastSyncedTasksRef.current;
      const currentMap=new Map(tasks.map(t=>[t.id,t]));
      const toWrite=tasks.filter(t=>JSON.stringify(prevMap.get(t.id))!==JSON.stringify(t));
      const toDelete=[...prevMap.keys()].filter(id=>!currentMap.has(id));
      if(toWrite.length===0&&toDelete.length===0)return;
      isSyncingTasks.current=true;
      const tasksCol=collection(db,"users",fbUser.uid,"tasks");
      const batch=writeBatch(db);
      for(const t of toWrite) batch.set(doc(tasksCol,String(t.id)),t);
      for(const id of toDelete) batch.delete(doc(tasksCol,String(id)));
      batch.commit()
        .then(()=>{ lastSyncedTasksRef.current=currentMap; setSyncError(null); })
        .catch(err=>{
          console.error(err);
          setSyncError("Couldn't save to the cloud -- your changes are safe on this device, but won't reach your other devices until this is resolved.");
        })
        .finally(()=>{isSyncingTasks.current=false;});
    },400);
    return ()=>clearTimeout(tasksSaveTimer.current);
  },[tasks,fbUser,tasksSyncedForUid]);

  async function signInWithFirebase(){
    setSignInError(null);
    try{
      await signInWithPopup(auth,googleProvider);
    } catch(e){
      console.error(e);
      const code=(e as {code?:string})?.code||"unknown";
      if(code==="auth/popup-closed-by-user"||code==="auth/cancelled-popup-request"){
        return; // the user closed it (or a second attempt overlapped) -- not a real failure, nothing to show
      }
      if(code==="auth/operation-not-supported-in-this-environment"){
        // The one case where popup genuinely isn't an option at all (some
        // embedded/in-app webviews) -- redirect is the only path here,
        // despite its own known issues (see isStorageBlockedError below).
        try{
          localStorage.setItem("hw-signin-redirect-pending",String(Date.now()));
          await signInWithRedirect(auth,googleProvider);
        } catch(e2){
          localStorage.removeItem("hw-signin-redirect-pending");
          console.error(e2);
          if(isStorageBlockedError(e2)){ setSignInError(STORAGE_BLOCKED_MESSAGE); }
          else { const code2=(e2 as {code?:string})?.code||"unknown"; setSignInError(`Sign-in didn't go through (${code2}). Please try again.`); }
        }
        return;
      }
      // Everything else here (most commonly auth/popup-blocked) means the
      // browser's popup blocker stepped in. Popup-based sign-in doesn't
      // depend on sessionStorage surviving a full page navigation the way
      // signInWithRedirect does (the result comes back via postMessage
      // between two windows that stay open at the same time), so it's
      // markedly more reliable in browsers with strict storage partitioning
      // -- notably Firefox's Enhanced Tracking Protection, which reliably
      // breaks the redirect method regardless of per-site exceptions, since
      // the actual storage access happens on Firebase's authDomain (a
      // different origin from this site) during the round trip, not on this
      // site's own origin. Asking the user to allow popups and retry with
      // the *more* reliable method beats silently falling back to the one
      // that's known to fail here.
      setSignInError("Your browser blocked the sign-in popup. Please allow popups for this site, then try again -- that's more reliable here than the alternative full-page redirect method.");
    }
  }
  async function signOutFirebase(){
    await fbSignOut(auth);
    setFbUser(null);
  }
  const [showDeleteAccountConfirm,setShowDeleteAccountConfirm]=useState(false);
  const [deleteConfirmText,setDeleteConfirmText]=useState("");
  const [deleteAccountBusy,setDeleteAccountBusy]=useState(false);
  const [deleteAccountError,setDeleteAccountError]=useState<string|null>(null);
  // Deletes the Firestore profile doc + every doc in the tasks subcollection,
  // then the Auth account itself, then wipes local data too -- "delete my
  // data" should mean all of it, not just the cloud copy. Not chunked into
  // multiple batches past Firestore's 500-op limit, matching the existing
  // tasks-sync effect's writeBatch usage elsewhere in this file.
  async function deleteAccountForever(){
    if(!fbUser)return;
    setDeleteAccountBusy(true);
    setDeleteAccountError(null);
    try{
      const tasksCol=collection(db,"users",fbUser.uid,"tasks");
      const snap=await getDocs(tasksCol);
      const batch=writeBatch(db);
      snap.docs.forEach(d=>batch.delete(d.ref));
      batch.delete(doc(db,"users",fbUser.uid));
      await batch.commit();
      await deleteUser(fbUser);
      Object.keys(localStorage).filter(k=>k.startsWith("hw-")).forEach(k=>localStorage.removeItem(k));
      window.location.reload();
    } catch(e){
      console.error(e);
      const code=(e as {code?:string})?.code||"unknown";
      setDeleteAccountError(
        code==="auth/requires-recent-login"
          ? "For your security, please sign out, sign back in, and try again."
          : `Couldn't delete your account (${code}). Please try again.`
      );
    } finally {
      setDeleteAccountBusy(false);
    }
  }

  const [adding,setAdding]=useState(false);
  const [focusMode,setFocusMode]=useState(false); // transient by design -- no persistence needed
  const [step,setStep]=useState(0);
  const [newTask,setNewTask]=useState<Partial<Task>>({title:"",subject:"",dueDate:"",dueTime:"",estMins:30});
  const [pendingDueDate,setPendingDueDate]=useState<string|null>(null);
  const [usingTemplate,setUsingTemplate]=useState(false);
  const [templateSubtasks,setTemplateSubtasks]=useState<{text:string}[]|null>(null);
  const inputValRef=useRef("");
  const [filter,setFilter]=useState("all");
  const [searchQuery,setSearchQuery]=useState("");
  const [suggestion,setSuggestion]=useState("");
  const [suggestionLoading,setSuggestionLoading]=useState(false);
  const [activeTab,setActiveTab]=useState("tasks");
  const [titleMenuOpen,setTitleMenuOpen]=useState(false);
  const titleMenuRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!titleMenuOpen)return;
    function onPointerDown(e:PointerEvent){if(titleMenuRef.current&&!titleMenuRef.current.contains(e.target as Node))setTitleMenuOpen(false);}
    function onKeyDown(e:KeyboardEvent){if(e.key==="Escape")setTitleMenuOpen(false);}
    document.addEventListener("pointerdown",onPointerDown);
    document.addEventListener("keydown",onKeyDown);
    return ()=>{document.removeEventListener("pointerdown",onPointerDown);document.removeEventListener("keydown",onKeyDown);};
  },[titleMenuOpen]);
  const [looksOpen,setLooksOpen]=useState(false);
  const [activeSubject,setActiveSubject]=useState("all");
  // Syllabus import: transient by design (a paste-and-review staging area, not
  // something worth persisting across reloads like tasks/scratchpad are).
  const [importText,setImportText]=useState("");
  const [importSubject,setImportSubject]=useState<string|null>(null);
  const [importPreview,setImportPreview]=useState<{title:string;dueDate:string;checked:boolean}[]|null>(null);
  const [importedCount,setImportedCount]=useState<number|null>(null);
  function scanSyllabus(){
    const found=parseSyllabus(importText);
    setImportPreview(found.map(f=>({...f,checked:true})));
    setImportedCount(null);
  }
  function toggleImportItem(idx:number){
    setImportPreview(prev=>prev&&prev.map((it,i)=>i===idx?{...it,checked:!it.checked}:it));
  }
  function commitImport(){
    if(!importPreview)return;
    const subject=importSubject||subjects[0]||"Other";
    const toAdd=importPreview.filter(it=>it.checked);
    if(toAdd.length===0)return;
    setTasks(prev=>[
      ...prev,
      ...toAdd.map((it,i):Task=>({id:nextId(),title:it.title,subject,dueDate:it.dueDate,dueTime:"",estMins:30,done:false,order:prev.length+i})),
    ]);
    setImportedCount(toAdd.length);
    setImportText("");
    setImportPreview(null);
  }
  const [pomodoroActive,setPomodoroActive]=useState(false);
  const [pomodoroSecs,setPomodoroSecs]=useState(25*60);
  const [timeHours,setTimeHours]=useState(0);
  const [timeMins,setTimeMins]=useState(30);
  const [timeSecs,setTimeSecs]=useState(0);
  const [showProfile,setShowProfile]=useState(false);
  const [profileTab,setProfileTab]=useState<"profile"|"personalize">("profile");
  const [sessionActive,setSessionActive]=useState(false);
  const [sessionSecs,setSessionSecs]=useState(0);
  const [sessionHistory,setSessionHistory]=useState<{mins:number;date:string}[]>([]);
  const sessionInterval=useRef<ReturnType<typeof setInterval>|undefined>(undefined);
  const inputRef=useRef<HTMLInputElement>(null);
  // Controlled (not ref+uncontrolled) specifically because ProfileModal is a
  // component defined inside this render body, so it gets torn down and
  // recreated -- along with any of its own uncontrolled DOM inputs -- on every
  // unrelated re-render of HomeworkPlanner while it's open (a Firestore sync
  // landing, etc). State that lives up here in the parent
  // survives that; an uncontrolled input's typed text would silently vanish.
  const [newSubjectText,setNewSubjectText]=useState("");
  // Drag-to-reorder (default list layout, pending tasks only)
  const [dragTaskId,setDragTaskId]=useState<number|null>(null);
  const [dragOffsetY,setDragOffsetY]=useState(0);
  const dragStartY=useRef(0);
  const dragOrderIds=useRef<number[]>([]);
  // Swipe gestures (List/Compact/Checklist layouts): left deletes, right toggles
  // done. Direction is locked on the first few px of movement so a mostly-vertical
  // drag (page scroll) is left alone instead of being hijacked as a swipe.
  const [swipeId,setSwipeId]=useState<number|null>(null);
  const [swipeX,setSwipeX]=useState(0);
  const swipeStart=useRef({x:0,y:0});
  const swipeLocked=useRef(false);
  const swipeMoved=useRef(false);
  const SWIPE_THRESHOLD=90;
  // Undo/redo action history -- deletion happens immediately (so Firestore sync,
  // which just diffs against `tasks`, doesn't need special-casing), and the
  // deleted task is kept here instead so it can be restored. Scoped to just
  // "delete" for now; other action types (edit, complete, ...) can join the
  // same union later. A new action always clears redoStack, same as any
  // standard undo/redo history.
  const [undoStack,setUndoStack]=useState<{type:"delete";task:Task}[]>([]);
  const [redoStack,setRedoStack]=useState<{type:"delete";task:Task}[]>([]);
  const [deleteToast,setDeleteToast]=useState<string|null>(null);
  const deleteToastTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  // Bulk edit / multi-select. Scoped to the default list layout (MiniCard) --
  // the other 11 layouts each render their own custom task row markup, so
  // extending selection to all of them is a much bigger job than the value
  // justifies right now.
  const [selectionMode,setSelectionMode]=useState(false);
  const [selectedIds,setSelectedIds]=useState<number[]>([]);
  function toggleSelected(id:number){
    setSelectedIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
  }
  function exitSelectionMode(){ setSelectionMode(false); setSelectedIds([]); }

  const base=THEMES[themeName];
  const T:ThemeObj={...base,accentGlow:base.accent+"44",gradientCard:`linear-gradient(135deg,${base.cardAlt},${base.card})`,accent:base.accent as typeof base.accent};
  // Mirrors just the resolved background color (not the whole theme) to its own
  // key, read synchronously by a tiny inline script in index.html before React
  // hydrates -- prevents a flash of the browser's default white background for
  // returning dark-theme users, without duplicating the THEMES palette there.
  useEffect(()=>{try{localStorage.setItem("hw-bg",T.bg);}catch{/* storage unavailable */}},[T.bg]);

  // Canonical "fetch data when a dependency changes" effect (React's own docs
  // list this as a case an Effect genuinely is for) -- the immediate setState
  // calls here start/reset the loading state around the fetch, not "adjust
  // state to mirror a prop", so react-hooks/set-state-in-effect's heuristic is
  // a false positive on this specific shape.
  useEffect(()=>{
    const pending=tasks.filter(t=>!t.done);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if(pending.length===0){setSuggestion("Nothing left -- you're all done!");return;}
    setSuggestionLoading(true);setSuggestion("");
    const t=setTimeout(()=>{fetchAISuggestion(tasks).then(s=>{setSuggestion(s);setSuggestionLoading(false);}).catch(()=>{setSuggestion("Start with your most urgent assignment!");setSuggestionLoading(false);});},700);
    return()=>clearTimeout(t);
  },[tasks]);

  // focus input when adding starts
  useEffect(()=>{if(adding){setTimeout(()=>inputRef.current?.focus(),50);}},[adding,step]);

  // Pomodoro timer
  useEffect(()=>{if(!pomodoroActive)return;const t=setInterval(()=>setPomodoroSecs(s=>{if(s<=1){setPomodoroActive(false);return 25*60;}return s-1;}),1000);return()=>clearInterval(t);},[pomodoroActive]);

  const visibleTasks=tasks;
  // Every tag used on any task, deduplicated -- powers the "quick add" suggestion
  // chips in TaskModal's tag editor instead of retyping tags you've already used.
  const allTags=[...new Set(tasks.flatMap(t=>t.tags||[]))].sort();
  // Pending tasks sort by their manual drag order; done tasks always sink to the bottom.
  const allSorted=[...visibleTasks].sort((a,b)=>{
    if(a.done!==b.done)return a.done?1:-1;
    return a.order-b.order;
  });
  const searchLower=searchQuery.trim().toLowerCase();
  const matchesSearch=(t:Task)=>!searchLower||t.title.toLowerCase().includes(searchLower)||t.subject.toLowerCase().includes(searchLower);
  const filteredTasks=allSorted.filter(t=>{
    if(filter==="archived")return !!t.archived;
    if(t.archived)return false; // archived tasks never show in all/pending/done, only the dedicated view
    if(filter==="inbox")return !t.done&&(!t.dueDate||!t.subject);
    if(filter==="done")return t.done;
    if(filter==="pending")return !t.done;
    return showDone?true:!t.done;
  }).filter(matchesSearch);
  // Untriaged -- tasks whose due date and/or subject were skipped rather than answered
  // (see the add-wizard's skip arrow), surfaced via the title menu's Inbox entry.
  const inboxCount=visibleTasks.filter(t=>!t.done&&!t.archived&&(!t.dueDate||!t.subject)).length;
  const topTask=allSorted.find(t=>!t.done&&!t.archived);
  const totalMins=visibleTasks.filter(t=>!t.done&&!t.archived).reduce((s,t)=>s+(t.estMins||0),0);

  // Stats (Tools tab). Archived tasks still count here -- archiving is just a
  // view filter, it doesn't erase completion history.
  const startOfWeek=(()=>{const d=new Date();d.setDate(d.getDate()-d.getDay());d.setHours(0,0,0,0);return d.getTime();})();
  const startOfMonth=(()=>{const d=new Date();d.setDate(1);d.setHours(0,0,0,0);return d.getTime();})();
  const tasksThisWeek=tasks.filter(t=>t.completedAt&&t.completedAt>=startOfWeek).length;
  const tasksThisMonth=tasks.filter(t=>t.completedAt&&t.completedAt>=startOfMonth).length;

  function startAdding(){
    setAdding(true);setStep(-1);
    setNewTask({title:"",subject:"",dueDate:"",dueTime:"",estMins:30});
    setPendingDueDate(null);
    setTimeHours(0);setTimeMins(30);setTimeSecs(0);
    setUsingTemplate(false);setTemplateSubtasks(null);
    inputValRef.current="";
    if(inputRef.current) inputRef.current.value="";
  }
  // Skips straight to the due-date question, since everything else a template
  // covers (subject/estimate/recurrence/subtasks) is already decided --
  // confirmDueTime and finishTask below check usingTemplate/templateSubtasks
  // to finish immediately after the date instead of asking the remaining
  // normally-sequential questions.
  function startFromTemplate(tpl:TaskTemplate){
    setAdding(true);
    setNewTask({title:tpl.name,subject:tpl.subject,dueDate:"",dueTime:"",estMins:tpl.estMins,recurrence:tpl.recurrence});
    setPendingDueDate(null);
    setUsingTemplate(true);setTemplateSubtasks(tpl.subtasks||null);
    setStep(1);
  }
  function handleTitleSubmit(e:React.FormEvent){
    e.preventDefault();
    const val=inputRef.current?.value||"";
    if(!val.trim())return;
    setNewTask(t=>({...t,title:val.trim()}));
    inputValRef.current="";
    if(inputRef.current) inputRef.current.value="";
    setStep(0);
  }
  function handleAnswer(val:string){
    const q=QUESTIONS[step];
    const value = q.type==="time" ? parseInt(val) : val;
    const updated={...newTask,[q.key]:value};setNewTask(updated);
    inputValRef.current="";
    if(inputRef.current) inputRef.current.value="";
    setTimeout(()=>{if(step<QUESTIONS.length-1){setStep(s=>s+1);}else finishTask(updated as Task);},100);
  }
  function goBackStep(){
    if(QUESTIONS[step]?.type==="date"&&pendingDueDate!==null){setPendingDueDate(null);return;}
    if(step>-1)setStep(s=>s-1);
  }
  function goForwardStep(){
    if(QUESTIONS[step]?.type==="date"&&pendingDueDate!==null){confirmDueTime("");return;}
    if(step<QUESTIONS.length-1){setStep(s=>s+1);}else finishTask(newTask as Task);
  }
  function handleDateInput(val:string){
    setPendingDueDate(val);
    inputValRef.current="";
    if(inputRef.current) inputRef.current.value="";
  }
  function confirmDueTime(time:string){
    const updated={...newTask,dueDate:pendingDueDate||"",dueTime:time};setNewTask(updated);
    setPendingDueDate(null);
    inputValRef.current="";
    if(inputRef.current) inputRef.current.value="";
    if(usingTemplate){
      setTimeout(()=>finishTask(updated as Task),100);
    } else {
      setTimeout(()=>{if(step<QUESTIONS.length-1){setStep(s=>s+1);}else finishTask(updated as Task);},100);
    }
  }
  function finishTask(task:Task){
    const subtasks=templateSubtasks?templateSubtasks.map(s=>({id:String(nextId()),text:s.text,done:false})):undefined;
    setTasks(prev=>[...prev,{...task,id:nextId(),done:false,order:prev.length,...(subtasks?{subtasks}:{})}]);
    setAdding(false);setStep(0);
    setUsingTemplate(false);setTemplateSubtasks(null);
  }
  function toggleDone(id:number){
    const task=tasks.find(t=>t.id===id);
    if(!task)return;
    const nowDone=!task.done;
    setTasks(prev=>{
      let next=prev.map(t=>t.id===id?{...t,done:nowDone,completedAt:nowDone?Date.now():null}:t);
      if(nowDone&&task.recurrence&&task.recurrence!=="none"){
        const newDue=advanceDate(task.dueDate,task.recurrence);
        next=[...next,{...task,id:nextId(),done:false,completedAt:null,archived:false,dueDate:newDue,order:prev.length}];
      }
      return next;
    });
  }
  function deleteTask(id:number){
    const task=tasks.find(t=>t.id===id);
    if(!task)return;
    setTasks(prev=>prev.filter(t=>t.id!==id));
    setUndoStack(prev=>[...prev,{type:"delete",task}]);
    setRedoStack([]);
    setDeleteToast(task.title);
    clearTimeout(deleteToastTimer.current);
    deleteToastTimer.current=setTimeout(()=>setDeleteToast(null),5000);
  }
  // Undo/redo currently only understand the "delete" action type -- each
  // branch below is where a future action type (edit, complete, ...) would
  // add its own reversal.
  function undo(){
    if(undoStack.length===0)return;
    const action=undoStack[undoStack.length-1];
    if(action.type==="delete")setTasks(prev=>[...prev,action.task]);
    setUndoStack(prev=>prev.slice(0,-1));
    setRedoStack(prev=>[...prev,action]);
    setDeleteToast(null);
  }
  function redo(){
    if(redoStack.length===0)return;
    const action=redoStack[redoStack.length-1];
    if(action.type==="delete")setTasks(prev=>prev.filter(t=>t.id!==action.task.id));
    setRedoStack(prev=>prev.slice(0,-1));
    setUndoStack(prev=>[...prev,action]);
  }
  function updateSubtasks(id:number,subtasks:Subtask[]){
    setTasks(prev=>prev.map(t=>t.id===id?{...t,subtasks}:t));
  }
  function setPriorityOverride(id:number,override:Priority|null){
    setTasks(prev=>prev.map(t=>t.id===id?{...t,priorityOverride:override??undefined}:t));
  }
  function setTaskTags(id:number,tags:string[]){
    setTasks(prev=>prev.map(t=>t.id===id?{...t,tags}:t));
  }
  function archiveTask(id:number){
    setTasks(prev=>prev.map(t=>t.id===id?{...t,archived:true}:t));
  }
  function bulkMarkDone(ids:number[]){
    setTasks(prev=>prev.map(t=>ids.includes(t.id)&&!t.done?{...t,done:true,completedAt:Date.now()}:t));
    exitSelectionMode();
  }
  function bulkArchive(ids:number[]){
    setTasks(prev=>prev.map(t=>ids.includes(t.id)?{...t,archived:true}:t));
    exitSelectionMode();
  }
  function bulkDelete(ids:number[]){
    if(!window.confirm(`Delete ${ids.length} task${ids.length===1?"":"s"}? This can't be undone.`))return;
    setTasks(prev=>prev.filter(t=>!ids.includes(t.id)));
    exitSelectionMode();
  }
  function bulkSetSubject(ids:number[],subject:string){
    setTasks(prev=>prev.map(t=>ids.includes(t.id)?{...t,subject}:t));
    exitSelectionMode();
  }
  function exportAllDataJSON(){
    const data={
      exportedAt:new Date().toISOString(),
      tasks,subjects,subjectColors,templates,
      themeName,layout,groupBy,
      scratchpad,
    };
    downloadFile(`dueplanner-export-${todayISO()}.json`,JSON.stringify(data,null,2),"application/json");
  }
  function exportTasksCSV(){
    const headers=["title","subject","dueDate","dueTime","estMins","done","priority","tags","recurrence"];
    const rows=tasks.map(t=>[
      t.title,t.subject,t.dueDate,t.dueTime,t.estMins,t.done?"yes":"no",
      getPriority(t.dueDate,t.estMins,t.priorityOverride),
      (t.tags||[]).join("; "),t.recurrence||"none",
    ].map(csvField).join(","));
    downloadFile(`dueplanner-tasks-${todayISO()}.csv`,[headers.join(","),...rows].join("\n"),"text/csv");
  }

  // Drag-to-reorder: pointer capture keeps move/up events on the handle even as
  // the finger/cursor leaves it, so no window-level listeners are needed. While
  // dragging, whichever pending card the pointer is currently over gets swapped
  // with the dragged one, live, by reassigning their `order` values.
  function startDrag(id:number,e:React.PointerEvent){
    dragOrderIds.current=allSorted.filter(t=>!t.done).map(t=>t.id);
    dragStartY.current=e.clientY;
    setDragTaskId(id);
    setDragOffsetY(0);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDragMove(e:React.PointerEvent){
    if(dragTaskId==null)return;
    setDragOffsetY(e.clientY-dragStartY.current);
    const el=document.elementFromPoint(e.clientX,e.clientY) as HTMLElement|null;
    const cardEl=el?.closest("[data-task-id]") as HTMLElement|null;
    if(!cardEl)return;
    const overId=Number(cardEl.dataset.taskId);
    if(!overId||overId===dragTaskId)return;
    const ids=dragOrderIds.current;
    const from=ids.indexOf(dragTaskId), to=ids.indexOf(overId);
    if(from===-1||to===-1||from===to)return;
    const next=[...ids];
    next.splice(from,1);
    next.splice(to,0,dragTaskId);
    dragOrderIds.current=next;
    const orderMap=new Map(next.map((tid,idx)=>[tid,idx]));
    setTasks(prev=>prev.map(t=>orderMap.has(t.id)?{...t,order:orderMap.get(t.id)!}:t));
    dragStartY.current=e.clientY;
    setDragOffsetY(0);
  }
  function endDrag(){setDragTaskId(null);setDragOffsetY(0);}

  // Tracks which row a pointer is currently down on, purely via refs, so a plain
  // tap causes zero state updates -- MiniCard is a nested component (recreated
  // every parent render), so a setState on pointerdown would remount the pressed
  // row mid-gesture and silently swallow the browser's native click event. State
  // (swipeId/swipeX) only gets touched once a gesture actually locks in as a swipe.
  const swipeActiveId=useRef<number|null>(null);
  function onSwipeStart(id:number,e:React.PointerEvent){
    swipeActiveId.current=id;
    swipeStart.current={x:e.clientX,y:e.clientY};
    swipeLocked.current=false;
    swipeMoved.current=false;
  }
  function onSwipeMove(id:number,e:React.PointerEvent){
    if(swipeActiveId.current!==id)return;
    const dx=e.clientX-swipeStart.current.x;
    const dy=e.clientY-swipeStart.current.y;
    if(!swipeLocked.current){
      if(Math.abs(dx)>8&&Math.abs(dx)>Math.abs(dy)*1.5){
        swipeLocked.current=true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setSwipeId(id);
      } else if(Math.abs(dy)>8){
        swipeActiveId.current=null; // vertical intent -- let the page scroll instead
        return;
      } else return;
    }
    swipeMoved.current=true;
    setSwipeX(Math.max(-140,Math.min(140,dx)));
  }
  function onSwipeEnd(id:number){
    if(swipeActiveId.current!==id)return;
    swipeActiveId.current=null;
    const wasLocked=swipeLocked.current;
    swipeLocked.current=false;
    if(!wasLocked)return;
    const dx=swipeX;
    setSwipeId(null);
    setSwipeX(0);
    if(dx<=-SWIPE_THRESHOLD)deleteTask(id);
    else if(dx>=SWIPE_THRESHOLD)toggleDone(id);
  }
  function onSwipeCancel(id:number){
    if(swipeActiveId.current!==id)return;
    swipeActiveId.current=null;
    const wasLocked=swipeLocked.current;
    swipeLocked.current=false;
    // Always clear this, even if not locked -- otherwise a swipe that locked in
    // and then got interrupted (pointercancel) leaves it stuck true, silently
    // swallowing the user's very next tap anywhere in the swipeable list.
    swipeMoved.current=false;
    if(!wasLocked)return;
    setSwipeId(null);
    setSwipeX(0);
  }
  function swipeHandlers(id:number){
    return {
      onPointerDown:(e:React.PointerEvent)=>onSwipeStart(id,e),
      onPointerMove:(e:React.PointerEvent)=>onSwipeMove(id,e),
      onPointerUp:()=>onSwipeEnd(id),
      onPointerCancel:()=>onSwipeCancel(id),
    };
  }
  function swipeContentStyle(id:number):React.CSSProperties{
    const active=swipeId===id;
    const dx=active?swipeX:0;
    return {transform:dx?`translateX(${dx}px)`:undefined,transition:active?"none":"transform 0.25s cubic-bezier(.34,1.4,.64,1)",touchAction:"pan-y"};
  }
  function swipeClickGuard(onOpen:()=>void){
    return ()=>{ if(swipeMoved.current){swipeMoved.current=false;return;} onOpen(); };
  }
  function renderSwipeReveal(id:number){
    if(swipeId!==id||swipeX===0)return null;
    const isRight=swipeX>0;
    return <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:isRight?"flex-start":"flex-end",padding:"0 20px",background:isRight?"#2ED57333":"#FF475733",pointerEvents:"none"}}>
      <span style={{fontFamily:F.body,fontSize:13,fontWeight:600,color:isRight?"#2ED573":"#FF4757"}}>{isRight?"✓ Mark done":"Delete"}</span>
    </div>;
  }
  const currentQ=step>=0?QUESTIONS[step]:null;

  const F = FONT;

  // Memoized on the actual primitives used below (not on T/F themselves --
  // those are fresh object literals every render) so this multi-hundred-line
  // stylesheet string, injected via <style>{css}</style>, only gets rebuilt
  // (and reparsed by the browser) when the theme or font actually changes,
  // not on every task edit, scratchpad keystroke, or other unrelated render.
  const css=useMemo(()=>`
    @import url('https://fonts.googleapis.com/css2?family=${F.google}&display=swap');
    *{box-sizing:border-box;}
    body{margin:0;background:${T.bg};transition:background 0.4s;font-family:${F.body};}
    html{background:${T.bg};}
    .app-shell{min-height:100svh;min-height:100dvh;}
    .tc{transition:all 0.22s cubic-bezier(.34,1.2,.64,1);}
    .tc:hover{transform:translateY(-2px);filter:brightness(1.05);}
    .pop{animation:pop 0.28s cubic-bezier(.34,1.4,.64,1) forwards;}
    @keyframes pop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
    .sli{animation:sli 0.22s ease forwards;}
    @keyframes sli{from{opacity:0;transform:translateX(-5px)}to{opacity:1;transform:none}}
    .chip{cursor:pointer;border:none;border-radius:999px;padding:7px 15px;font-family:'DM Mono',monospace;font-size:12px;transition:all 0.13s;}
    .chip:hover{transform:scale(1.05);filter:brightness(1.1);}
    .chip:active{transform:scale(.97);}
    input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.6);}
    .shim{background:linear-gradient(90deg,${T.card} 25%,${T.cardAlt} 50%,${T.card} 75%);background-size:200% 100%;animation:shim 1.4s infinite;border-radius:6px;}
    @keyframes shim{0%{background-position:200% 0}100%{background-position:-200% 0}}
    .rb{font-family:'DM Mono',monospace;font-size:10px;font-weight:500;border-radius:999px;padding:2px 8px;}
    .tog{width:38px;height:20px;border-radius:999px;border:none;cursor:pointer;transition:background 0.2s;position:relative;flex-shrink:0;}
    .sl{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding:10px 0 6px;opacity:0.45;}
    ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${T.border};border-radius:99px}
    .sticky-note{transition:all 0.2s;cursor:default;}
    .sticky-note:hover{transform:rotate(0deg) scale(1.03);}
    .pomo-ring{animation:ring 1s linear infinite;}
    @keyframes ring{from{stroke-dashoffset:0}to{stroke-dashoffset:283}}
    .app-inner{max-width:580px;margin:0 auto;padding:20px 14px;width:100%;box-sizing:border-box;}
    @media (min-width:900px){
      .dl-wide .app-inner{max-width:920px;}
      .dl-sidebar .app-inner{max-width:1080px;padding:24px 28px;}
      .dl-sidebar .app-body{display:flex;align-items:flex-start;gap:24px;}
      .dl-sidebar .app-sidebar{width:168px;flex-shrink:0;position:sticky;top:24px;}
      .dl-sidebar .app-main{flex:1;min-width:0;}
      .dl-sidebar .app-sidebar .tab-bar{flex-direction:column;background:none!important;border:none!important;padding:0!important;gap:6px!important;}
      .dl-sidebar .app-sidebar .tab-bar button{flex:none!important;justify-content:center!important;padding:12px!important;}
    }
    @media (max-width:600px){
      input,textarea{font-size:16px!important;}
    }
  `,[T.bg,T.card,T.cardAlt,T.border,F.google,F.body]);

  // Session timer
  useEffect(()=>{
    if(sessionActive){
      sessionInterval.current=setInterval(()=>setSessionSecs(s=>s+1),1000);
    } else {
      clearInterval(sessionInterval.current);
    }
    return()=>clearInterval(sessionInterval.current);
  },[sessionActive]);

  function startSession(){setSessionSecs(0);setSessionActive(true);}
  function endSession(){
    setSessionActive(false);
    if(!selectedTask||sessionSecs<5)return;
    const mins=Math.max(1,Math.round(sessionSecs/60));
    setSessionHistory(h=>[...h,{mins,date:new Date().toLocaleTimeString()}]);
    setSessionSecs(0);
  }

  // ─── LAYOUT RENDERERS ─────────────────────────────────────────────────────────
  function renderTasks(tasks:Task[]) {
    const pending=allSorted.filter(t=>!t.done);
    // Shared props for the (module-scope) MiniCard -- spread at each call site
    // below instead of repeating this whole list three times.
    const miniCardProps={T,F,subjectColors,colorCodeUrgency,dragTaskId,dragOffsetY,
      onOpen:(t:Task)=>{setSelectedTask(t);setSessionHistory([]);},
      onToggleDone:toggleDone,onDelete:deleteTask,
      swipeClickGuard,swipeHandlers,swipeContentStyle,renderSwipeReveal,
      startDrag,onDragMove,endDrag,
      selectionMode,onToggleSelect:toggleSelected};

    if (layout==="minimal") return (
      <div style={{display:"flex",flexDirection:"column",gap:2}}>
        {tasks.map(t=>{const pr=getPriority(t.dueDate,t.estMins,t.priorityOverride);const sc=subjectColors[t.subject]||T.accent;return(
          <div key={t.id} className="tc" onClick={()=>{setSelectedTask(t);setSessionHistory([]);}} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 4px",borderBottom:`1px solid ${T.border}22`,cursor:"pointer"}}>
            <button onClick={e=>{e.stopPropagation();toggleDone(t.id);}} style={{background:t.done?"#2ED573":"none",border:`1.5px solid ${t.done?"#2ED573":T.textFaint}`,borderRadius:"50%",width:15,height:15,cursor:"pointer",flexShrink:0,padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
              {t.done&&<span style={{color:"#111",fontSize:8,fontWeight:"bold"}}>✓</span>}
            </button>
            <div style={{width:6,height:6,borderRadius:"50%",background:priColor(pr,colorCodeUrgency),flexShrink:0}}/>
            <span style={{fontFamily:F.body,fontSize:13,flex:1,textDecoration:t.done?"line-through":"none",color:t.done?T.textFaint:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</span>
            <span style={{color:sc,fontFamily:F.body,fontSize:10,flexShrink:0}}>{t.subject}</span>
            <span style={{fontFamily:F.body,fontSize:10,color:T.textFaint,flexShrink:0}}>{daysUntil(t.dueDate)}</span>
            <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13,lineHeight:1,padding:"0 3px"}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>
          </div>
        );})}
      </div>
    );

    if (layout==="checklist") return (
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {tasks.map((t,i)=>{const pr=getPriority(t.dueDate,t.estMins,t.priorityOverride);return(
          <div key={t.id} style={{position:"relative",overflow:"hidden",borderRadius:10}}>
            {renderSwipeReveal(t.id)}
            <div className="tc" onClick={swipeClickGuard(()=>{setSelectedTask(t);setSessionHistory([]);})} {...swipeHandlers(t.id)} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",background:T.card,borderRadius:10,border:`1px solid ${T.border}`,cursor:"pointer",...swipeContentStyle(t.id)}}>
              <span style={{fontFamily:F.body,fontSize:11,color:T.textFaint,minWidth:18}}>{String(i+1).padStart(2,"0")}</span>
              <button onClick={e=>{e.stopPropagation();toggleDone(t.id);}} style={{width:20,height:20,border:`2px solid ${t.done?T.accent:T.textFaint}`,borderRadius:4,background:t.done?T.accent:"none",cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",padding:0,transition:"all 0.2s"}}>
                {t.done&&<span style={{color:contrastColor(T.accent),fontSize:11,fontWeight:"bold"}}>✓</span>}
              </button>
              <span style={{fontFamily:F.body,fontSize:13,flex:1,textDecoration:t.done?"line-through":"none",color:t.done?T.textFaint:T.text}}>{t.title}</span>
              <span style={{fontFamily:F.body,fontSize:10,color:priColor(pr,colorCodeUrgency)}}>{daysUntil(t.dueDate)}</span>
              <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:14,lineHeight:1}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>
            </div>
          </div>
        );})}
      </div>
    );

    if (layout==="compact") return (
      <div style={{display:"flex",flexDirection:"column",gap:5}}>
        {tasks.map(t=>{const pr=getPriority(t.dueDate,t.estMins,t.priorityOverride);const sc=subjectColors[t.subject]||T.accent;const dm=daysUntil(t.dueDate);return(
          <div key={t.id} style={{position:"relative",overflow:"hidden",borderRadius:9}}>
            {renderSwipeReveal(t.id)}
            <div className="tc" onClick={swipeClickGuard(()=>{setSelectedTask(t);setSessionHistory([]);})} {...swipeHandlers(t.id)} style={{background:T.card,borderRadius:9,padding:"8px 11px",border:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:8,position:"relative",cursor:"pointer",...swipeContentStyle(t.id)}}>
              <div style={{position:"absolute",left:0,top:0,bottom:0,width:2.5,background:priColor(pr,colorCodeUrgency)}}/>
              <button onClick={e=>{e.stopPropagation();toggleDone(t.id);}} style={{background:t.done?"#2ED573":"none",border:`2px solid ${t.done?"#2ED573":T.textFaint}`,borderRadius:"50%",width:15,height:15,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                {t.done&&<span style={{color:"#111",fontSize:8,fontWeight:"bold"}}>✓</span>}
              </button>
              <span style={{fontFamily:F.body,fontSize:13,textDecoration:t.done?"line-through":"none",color:t.done?T.textFaint:T.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</span>
              <span style={{color:sc,fontFamily:F.body,fontSize:10,flexShrink:0}}>{t.subject}</span>
              {dm&&!t.done&&<span style={{fontFamily:F.body,fontSize:10,color:priColor(pr,colorCodeUrgency),flexShrink:0}}>{dm}</span>}
              <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13,lineHeight:1}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>
            </div>
          </div>
        );})}
      </div>
    );

    if (layout==="board") return (
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(165px,1fr))",gap:10}}>
        {tasks.map(t=>{const pr=getPriority(t.dueDate,t.estMins,t.priorityOverride);const sc=subjectColors[t.subject]||T.accent;return(
          <div key={t.id} className="tc" onClick={()=>{setSelectedTask(t);setSessionHistory([]);}} style={{background:T.card,borderRadius:12,padding:"13px",border:`1px solid ${T.border}`,position:"relative",overflow:"hidden",display:"flex",flexDirection:"column",gap:7,cursor:"pointer"}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:priColor(pr,colorCodeUrgency),borderRadius:"12px 12px 0 0"}}/>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{background:sc+"22",color:sc,borderRadius:999,padding:"2px 8px",fontFamily:F.body,fontSize:10}}>{t.subject}</span>
              <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13,lineHeight:1}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>
            </div>
            <div style={{fontFamily:F.heading,fontSize:14,color:t.done?T.textFaint:T.text,textDecoration:t.done?"line-through":"none",lineHeight:1.3}}>{t.title}</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:"auto"}}>
              <span style={{fontFamily:F.body,fontSize:10,color:T.textMuted}}>{t.estMins}m</span>
              <button onClick={e=>{e.stopPropagation();toggleDone(t.id);}} style={{background:t.done?"#2ED573":"none",border:`2px solid ${t.done?"#2ED573":T.textFaint}`,borderRadius:"50%",width:17,height:17,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                {t.done&&<span style={{color:"#111",fontSize:8,fontWeight:"bold"}}>✓</span>}
              </button>
            </div>
          </div>
        );})}
      </div>
    );

    if (layout==="sticky") return (
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(155px,1fr))",gap:12}}>
        {tasks.map((t,i)=>{
          const sc=subjectColors[t.subject]||T.accent;
          const rotations=[-2,-1,0,1,2]; const rot=rotations[i%rotations.length];
          const stickyColors=["#fef08a","#bfdbfe","#bbf7d0","#fed7aa","#f5d0fe","#fecdd3"];
          const bg=stickyColors[i%stickyColors.length];
          return(
            <div key={t.id} className="sticky-note" onClick={()=>{setSelectedTask(t);setSessionHistory([]);}} style={{background:bg,borderRadius:3,padding:"14px 12px",transform:`rotate(${rot}deg)`,boxShadow:"2px 3px 10px #00000033",minHeight:120,display:"flex",flexDirection:"column",gap:6,opacity:t.done?0.5:1,cursor:"pointer"}}>
              <div style={{fontFamily:F.heading,fontSize:14,color:"#1a1a1a",textDecoration:t.done?"line-through":"none",lineHeight:1.3,flex:1}}>{t.title}</div>
              <div style={{fontFamily:F.body,fontSize:10,color:"#555"}}><span style={{color:sc,fontWeight:600}}>{t.subject}</span> · {daysUntil(t.dueDate)||"no date"}</div>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <button onClick={e=>{e.stopPropagation();toggleDone(t.id);}} style={{background:t.done?"#22c55e":"#ffffff88",border:"1.5px solid #33333333",borderRadius:4,padding:"2px 7px",cursor:"pointer",fontFamily:F.body,fontSize:10,color:"#333"}}>{t.done?"✓ done":"mark done"}</button>
                <button style={{background:"none",border:"none",color:"#666",cursor:"pointer",fontSize:14}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>
              </div>
            </div>
          );
        })}
      </div>
    );

    if (layout==="kanban") {
      const cols=[{key:"high",label:"Urgent",tasks:filteredTasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins,t.priorityOverride)==="high")},{key:"medium",label:"Soon",tasks:filteredTasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins,t.priorityOverride)==="medium")},{key:"low",label:"Later",tasks:filteredTasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins,t.priorityOverride)==="low")},{key:"done",label:"✓ Done",tasks:filteredTasks.filter(t=>t.done)}];
      return(
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10}}>
          {cols.map(col=>(
            <div key={col.key} style={{background:T.surface,borderRadius:12,padding:"12px",border:`1px solid ${T.border}`}}>
              <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginBottom:10,fontWeight:500}}>{col.label} ({col.tasks.length})</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {col.tasks.map(t=>(
                  <div key={t.id} className="tc" onClick={()=>{setSelectedTask(t);setSessionHistory([]);}} style={{background:T.card,borderRadius:8,padding:"9px 10px",border:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:7,cursor:"pointer"}}>
                    <button onClick={e=>{e.stopPropagation();toggleDone(t.id);}} style={{background:t.done?"#2ED573":"none",border:`1.5px solid ${t.done?"#2ED573":T.textFaint}`,borderRadius:"50%",width:14,height:14,cursor:"pointer",flexShrink:0,padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {t.done&&<span style={{color:"#111",fontSize:8}}>✓</span>}
                    </button>
                    <span style={{fontFamily:F.body,fontSize:12,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:t.done?T.textFaint:T.text,textDecoration:t.done?"line-through":"none"}}>{t.title}</span>
                    <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:12,lineHeight:1}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>
                  </div>
                ))}
                {col.tasks.length===0&&<div style={{fontFamily:F.body,fontSize:11,color:T.textFaint,textAlign:"center",padding:"10px 0"}}>empty</div>}
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (layout==="timeline") return (
      <div style={{position:"relative",paddingLeft:24}}>
        <div style={{position:"absolute",left:10,top:0,bottom:0,width:2,background:`linear-gradient(${T.accent},${T.border})`}}/>
        {tasks.map(t=>{const pr=getPriority(t.dueDate,t.estMins,t.priorityOverride);const sc=subjectColors[t.subject]||T.accent;return(
          <div key={t.id} className="tc" style={{position:"relative",marginBottom:14}}>
            <div style={{position:"absolute",left:-19,top:14,width:12,height:12,borderRadius:"50%",background:t.done?"#2ED573":priColor(pr,colorCodeUrgency),border:`2px solid ${T.bg}`,cursor:"pointer"}} onClick={()=>toggleDone(t.id)}/>
            <div onClick={()=>{setSelectedTask(t);setSessionHistory([]);}} style={{background:T.card,borderRadius:11,padding:"11px 13px",border:`1px solid ${T.border}`,marginLeft:6,cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                <span style={{fontFamily:F.heading,fontSize:14,color:t.done?T.textFaint:T.text,textDecoration:t.done?"line-through":"none",flex:1}}>{t.title}</span>
                <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13,lineHeight:1,flexShrink:0}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>
              </div>
              <div style={{display:"flex",gap:10,marginTop:4,flexWrap:"wrap"}}>
                <span style={{background:sc+"22",color:sc,borderRadius:999,padding:"1px 7px",fontFamily:F.body,fontSize:10}}>{t.subject}</span>
                <span style={{fontFamily:F.body,fontSize:10,color:T.textMuted}}>{formatDate(t.dueDate)}</span>
                <span style={{fontFamily:F.body,fontSize:10,color:priColor(pr,colorCodeUrgency)}}>{daysUntil(t.dueDate)}</span>
              </div>
            </div>
          </div>
        );})}
      </div>
    );

    if (layout==="subject") {
      const subs=[...new Set(filteredTasks.map(t=>t.subject))];
      const allSubs=["all",...subs];
      const shown=activeSubject==="all"?filteredTasks:filteredTasks.filter(t=>t.subject===activeSubject);
      return(
        <div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
            {allSubs.map(s=>(
              <button key={s} className="chip" onClick={()=>setActiveSubject(s)}
                style={{background:activeSubject===s?(subjectColors[s]||T.accent)+"33":"none",color:activeSubject===s?(subjectColors[s]||T.accent):T.textMuted,border:`1.5px solid ${activeSubject===s?(subjectColors[s]||T.accent):T.border}`}}>
                {s==="all"?"All ▥":s}
              </button>
            ))}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:9}}>
            {shown.map(t=><MiniCard key={t.id} task={t} rank={pending.indexOf(t)} {...miniCardProps}/>)}
          </div>
        </div>
      );
    }

    if (layout==="progress") return (
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {tasks.map(t=>{
          const pr=getPriority(t.dueDate,t.estMins,t.priorityOverride);const sc=subjectColors[t.subject]||T.accent;
          const maxMins=120; const pct=Math.min(100,Math.round(t.estMins/maxMins*100));
          return(
            <div key={t.id} className="tc" onClick={()=>{setSelectedTask(t);setSessionHistory([]);}} style={{background:T.card,borderRadius:12,padding:"13px 15px",border:`1px solid ${T.border}`,cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <button onClick={e=>{e.stopPropagation();toggleDone(t.id);}} style={{background:t.done?"#2ED573":"none",border:`2px solid ${t.done?"#2ED573":T.textFaint}`,borderRadius:"50%",width:18,height:18,cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {t.done&&<span style={{color:"#111",fontSize:9,fontWeight:"bold"}}>✓</span>}
                  </button>
                  <span style={{fontFamily:F.heading,fontSize:14,color:t.done?T.textFaint:T.text,textDecoration:t.done?"line-through":"none"}}>{t.title}</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{background:sc+"22",color:sc,borderRadius:999,padding:"1px 7px",fontFamily:F.body,fontSize:10}}>{t.subject}</span>
                  <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13,lineHeight:1}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{flex:1,height:7,background:T.border,borderRadius:999}}>
                  <div style={{width:t.done?"100%":`${pct}%`,height:"100%",background:t.done?"#2ED573":priColor(pr,colorCodeUrgency),borderRadius:999,transition:"width 0.5s"}}/>
                </div>
                <span style={{fontFamily:F.body,fontSize:10,color:T.textMuted,flexShrink:0}}>{t.estMins}m</span>
                <span style={{fontFamily:F.body,fontSize:10,color:priColor(pr,colorCodeUrgency),flexShrink:0}}>{daysUntil(t.dueDate)}</span>
              </div>
            </div>
          );
        })}
      </div>
    );

    if (layout==="pyramid") {
      const highT=tasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins,t.priorityOverride)==="high");
      const medT=tasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins,t.priorityOverride)==="medium");
      const lowT=tasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins,t.priorityOverride)==="low");
      const doneT=tasks.filter(t=>t.done);
      return(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {[{tasks:highT,color:priColor("high",colorCodeUrgency),label:"High Priority",w:"100%"},{tasks:medT,color:priColor("medium",colorCodeUrgency),label:"Medium Priority",w:"85%"},{tasks:lowT,color:priColor("low",colorCodeUrgency),label:"Low Priority",w:"65%"},{tasks:doneT,color:T.textFaint,label:"✓ Done",w:"45%"}].map(tier=>(
            tier.tasks.length>0&&(
              <div key={tier.label} style={{margin:"0 auto",width:tier.w}}>
                <div style={{fontFamily:F.body,fontSize:10,color:tier.color,marginBottom:5,textAlign:"center"}}>{tier.label}</div>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {tier.tasks.map(t=>(
                    <div key={t.id} className="tc" onClick={()=>{setSelectedTask(t);setSessionHistory([]);}} style={{background:T.card,borderRadius:9,padding:"9px 12px",border:`1px solid ${tier.color}44`,display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
                      <button onClick={e=>{e.stopPropagation();toggleDone(t.id);}} style={{background:t.done?"#2ED573":"none",border:`1.5px solid ${t.done?"#2ED573":T.textFaint}`,borderRadius:"50%",width:15,height:15,cursor:"pointer",flexShrink:0,padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {t.done&&<span style={{color:"#111",fontSize:8}}>✓</span>}
                      </button>
                      <span style={{fontFamily:F.body,fontSize:12,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:t.done?T.textFaint:T.text}}>{t.title}</span>
                      <span style={{fontFamily:F.body,fontSize:10,color:T.textMuted,flexShrink:0}}>{t.subject}</span>
                      <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>
                    </div>
                  ))}
                </div>
              </div>
            )
          ))}
        </div>
      );
    }

    if (layout==="calendar") {
      const week:string[]=[];
      for(let i=0;i<7;i++){const d=new Date();d.setDate(d.getDate()+i);week.push(localDateStr(d));}
      const noDate=tasks.filter(t=>!t.dueDate);
      return(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {week.map(day=>{
            const dayTasks=tasks.filter(t=>t.dueDate===day);
            if(dayTasks.length===0)return null;
            const isToday=day===todayISO();
            return(
              <div key={day} style={{background:T.card,borderRadius:12,padding:"12px 14px",border:`1px solid ${isToday?T.accent+"66":T.border}`}}>
                <div style={{fontFamily:F.body,fontSize:11,color:isToday?T.accent:T.textMuted,marginBottom:8,fontWeight:isToday?"500":"normal"}}>
                  {isToday?"• Today":formatDate(day)}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {dayTasks.map(t=>{const sc=subjectColors[t.subject]||T.accent;return(
                    <div key={t.id} onClick={()=>{setSelectedTask(t);setSessionHistory([]);}} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:`1px solid ${T.border}33`,cursor:"pointer"}}>
                      <button onClick={e=>{e.stopPropagation();toggleDone(t.id);}} style={{background:t.done?"#2ED573":"none",border:`1.5px solid ${t.done?"#2ED573":T.textFaint}`,borderRadius:3,width:15,height:15,cursor:"pointer",flexShrink:0,padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {t.done&&<span style={{color:"#111",fontSize:9,fontWeight:"bold"}}>✓</span>}
                      </button>
                      <span style={{fontFamily:F.body,fontSize:12,flex:1,textDecoration:t.done?"line-through":"none",color:t.done?T.textFaint:T.text}}>{t.title}</span>
                      <span style={{color:sc,fontFamily:F.body,fontSize:10}}>{t.subject}</span>
                      <span style={{fontFamily:F.body,fontSize:10,color:T.textMuted}}>{t.estMins}m</span>
                      <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>
                    </div>
                  );})}
                </div>
              </div>
            );
          })}
          {noDate.length>0&&(
            <div style={{background:T.card,borderRadius:12,padding:"12px 14px",border:`1px solid ${T.border}`}}>
              <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginBottom:8}}>No date</div>
              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                {noDate.map(t=>(
                  <div key={t.id} onClick={()=>{setSelectedTask(t);setSessionHistory([]);}} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
                    <button onClick={e=>{e.stopPropagation();toggleDone(t.id);}} style={{background:t.done?"#2ED573":"none",border:`1.5px solid ${t.done?"#2ED573":T.textFaint}`,borderRadius:3,width:15,height:15,cursor:"pointer",flexShrink:0,padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {t.done&&<span style={{color:"#111",fontSize:9}}>✓</span>}
                    </button>
                    <span style={{fontFamily:F.body,fontSize:12,flex:1,color:t.done?T.textFaint:T.text}}>{t.title}</span>
                    <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    // default: list -- this is also the only layout "Group Tasks By" applies to,
    // since the other layouts (kanban, progress, pyramid, calendar...) already
    // have their own built-in grouping and combining the two would conflict.
    if (groupBy!=="none") {
      const groups=new Map<string,Task[]>();
      const order:string[]=[];
      const keyFor=(t:Task)=>{
        if (groupBy==="subject") return t.subject||"Other";
        if (groupBy==="priority") return getPriority(t.dueDate,t.estMins,t.priorityOverride);
        return t.dueDate||"No date"; // dueDate
      };
      for (const t of tasks) {
        const k=keyFor(t);
        if (!groups.has(k)) { groups.set(k,[]); order.push(k); }
        groups.get(k)!.push(t);
      }
      if (groupBy==="priority") order.sort((a,b)=>({high:0,medium:1,low:2} as Record<string,number>)[a]-({high:0,medium:1,low:2} as Record<string,number>)[b]);
      if (groupBy==="dueDate") order.sort((a,b)=>a==="No date"?1:b==="No date"?-1:a.localeCompare(b));
      const labelFor=(k:string)=>{
        if (groupBy==="priority") return k==="high"?"High priority":k==="medium"?"Medium priority":"Low priority";
        if (groupBy==="dueDate") return k==="No date"?k:formatDate(k);
        return k; // subject
      };
      return <div style={{display:"flex",flexDirection:"column",gap:16}}>
        {order.map(k=>(
          <div key={k}>
            <div className="sl" style={{color:T.textMuted,paddingTop:0}}>{labelFor(k)} ({groups.get(k)!.length})</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {groups.get(k)!.map(t=><MiniCard key={t.id} task={t} rank={pending.indexOf(t)} swipeable {...miniCardProps}/>)}
            </div>
          </div>
        ))}
      </div>;
    }
    return <div style={{display:"flex",flexDirection:"column",gap:10}}>{tasks.map(t=><MiniCard key={t.id} task={t} rank={pending.indexOf(t)} reorderable swipeable {...miniCardProps} isSelected={selectedIds.includes(t.id)}/>)}</div>;
  }


  const pomMin=Math.floor(pomodoroSecs/60); const pomSec=pomodoroSecs%60;
  const pomPct=pomodoroSecs/(25*60);
  function renderPomodoroCard(){
    return (
      <div style={{background:T.card,borderRadius:12,padding:"16px",border:`1px solid ${T.border}`,textAlign:"center"}}>
        <div className="sl" style={{color:T.textMuted,textAlign:"left"}}>Pomodoro Timer</div>
        <div style={{position:"relative",width:100,height:100,margin:"10px auto"}}>
          <svg width="100" height="100" style={{transform:"rotate(-90deg)"}}>
            <circle cx="50" cy="50" r="45" fill="none" stroke={T.border} strokeWidth="6"/>
            <circle cx="50" cy="50" r="45" fill="none" stroke={T.accent} strokeWidth="6" strokeDasharray="283" strokeDashoffset={283*(1-pomPct)} strokeLinecap="round" style={{transition:"stroke-dashoffset 1s linear"}}/>
          </svg>
          <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",textAlign:"center"}}>
            <div style={{fontFamily:F.body,fontSize:18,color:T.text,fontWeight:500}}>{String(pomMin).padStart(2,"0")}:{String(pomSec).padStart(2,"0")}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"center"}}>
          <button onClick={()=>setPomodoroActive(a=>!a)} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:9,padding:"8px 18px",fontFamily:F.body,fontSize:12,cursor:"pointer"}}>{pomodoroActive?"⏸ Pause":"▶ Start"}</button>
          <button onClick={()=>{setPomodoroSecs(25*60);setPomodoroActive(false);}} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:9,padding:"8px 14px",color:T.textMuted,fontFamily:F.body,fontSize:12,cursor:"pointer"}}>↺ Reset</button>
        </div>
      </div>
    );
  }

  // Sync outer page background to theme
  useEffect(()=>{
    document.body.style.background=T.bg;
    document.body.style.transition="background 0.4s";
    return()=>{ document.body.style.background=""; };
  },[T.bg]);

  // Focus Mode: a stripped, full-screen view -- just the single most urgent
  // pending task and the (reused, not forked) Pomodoro timer. No tab bar, no
  // other tasks, no settings. Plain useState above, nothing to persist.
  if(focusMode){
    return (
      <div className="app-shell" style={{background:T.bg,fontFamily:F.body,color:T.text,minHeight:"100dvh",display:"flex",flexDirection:"column",padding:20,transition:"background 0.3s,color 0.3s"}}>
        <style>{css}</style>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div style={{fontFamily:F.heading,fontSize:20,color:T.accent}}>Focus Mode</div>
          <button onClick={()=>setFocusMode(false)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:9,padding:"8px 14px",color:T.textMuted,fontFamily:F.body,fontSize:12,cursor:"pointer"}}>✕ Exit</button>
        </div>
        <div style={{flex:1,display:"flex",flexDirection:"column",gap:16,justifyContent:"center",maxWidth:420,margin:"0 auto",width:"100%"}}>
          {topTask?(
            <div className="pop" style={{background:T.gradientCard,borderRadius:16,padding:"20px",border:`1px solid ${T.accent}44`}}>
              <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                <span className="rb" style={{background:T.accent+"33",color:T.accent}}>most urgent</span>
                <span style={{background:(subjectColors[topTask.subject]||T.accent)+"22",color:subjectColors[topTask.subject]||T.accent,borderRadius:999,padding:"2px 8px",fontFamily:F.body,fontSize:10}}>{topTask.subject}</span>
              </div>
              <div style={{fontFamily:F.heading,fontSize:22,color:T.text,marginBottom:8}}>{topTask.title}</div>
              <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                <span style={{fontFamily:F.body,fontSize:12,color:T.textMuted}}>{formatDate(topTask.dueDate)}{topTask.dueTime?` ${formatTime(topTask.dueTime)}`:""}</span>
                <span style={{fontFamily:F.body,fontSize:12,color:T.textMuted}}>{topTask.estMins}m</span>
              </div>
              <button onClick={()=>toggleDone(topTask.id)} style={{marginTop:14,background:"#2ED57322",color:"#2ED573",border:"1px solid #2ED57344",borderRadius:11,padding:"11px",fontFamily:F.body,fontSize:13,cursor:"pointer",width:"100%"}}>✓ Mark done</button>
            </div>
          ):(
            <div style={{textAlign:"center",color:T.textFaint,fontFamily:F.body,fontSize:13}}>Nothing left to focus on</div>
          )}
          {renderPomodoroCard()}
        </div>
      </div>
    );
  }

  return (
    <div className={"app-shell dl-"+desktopLayout} style={{background:T.bg,fontFamily:F.body,color:T.text,transition:"background 0.3s,color 0.3s"}}>
      <style>{css}</style>
      <div className="app-inner">

        {/* Header */}
        <div style={{position:"relative",display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:5}}>
          <div ref={titleMenuRef} style={{position:"relative"}}>
            <button onClick={()=>setTitleMenuOpen(o=>!o)} aria-haspopup="menu" aria-expanded={titleMenuOpen} aria-label="DuePlanner menu" style={{background:"none",border:"none",padding:0,cursor:"pointer",textAlign:"left",display:"block"}}>
              <div style={{fontFamily:F.heading,fontSize:28,lineHeight:1,color:T.accent}}>Due<span style={{color:T.text}}>Planner</span></div>
              <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint,marginTop:2}}>by due. studios</div>
            </button>
            {titleMenuOpen&&(
              <div role="menu" style={{position:"absolute",top:"calc(100% + 8px)",left:0,zIndex:200,width:280,background:T.card,border:`1px solid ${T.border}`,borderRadius:14,boxShadow:"0 10px 34px rgba(0,0,0,0.4)",overflow:"hidden"}}>
                <button role="menuitem" onClick={()=>{setFilter("inbox");setActiveTab("tasks");setTitleMenuOpen(false);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:"none",border:"none",padding:"12px 14px",cursor:"pointer",textAlign:"left",borderBottom:`1px solid ${T.border}`}}>
                  <IconTasks/>
                  <span style={{fontFamily:F.body,fontSize:13,color:T.text,flex:1}}>Inbox</span>
                  {inboxCount>0&&<span style={{background:T.accent,color:contrastColor(T.accent),borderRadius:999,padding:"1px 7px",fontFamily:F.body,fontSize:10}}>{inboxCount}</span>}
                </button>
                <div style={{padding:"12px 14px",borderBottom:`1px solid ${T.border}`}}>
                  <div style={{fontFamily:F.body,fontSize:13,color:T.text,marginBottom:8}}>History</div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={undo} disabled={undoStack.length===0} title={undoStack.length?`Undo: delete "${undoStack[undoStack.length-1].task.title}"`:"Nothing to undo"} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,background:T.cardAlt,border:`1px solid ${T.border}`,borderRadius:9,padding:"8px 0",cursor:undoStack.length?"pointer":"default",opacity:undoStack.length?1:0.4,color:T.text,fontFamily:F.body,fontSize:12}}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-1"/></svg>
                      Undo
                    </button>
                    <button onClick={redo} disabled={redoStack.length===0} title={redoStack.length?`Redo: delete "${redoStack[redoStack.length-1].task.title}"`:"Nothing to redo"} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,background:T.cardAlt,border:`1px solid ${T.border}`,borderRadius:9,padding:"8px 0",cursor:redoStack.length?"pointer":"default",opacity:redoStack.length?1:0.4,color:T.text,fontFamily:F.body,fontSize:12}}>
                      Redo
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 14 20 9l-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h1"/></svg>
                    </button>
                  </div>
                </div>
                <button role="menuitem" onClick={()=>{setShowProfile(true);setTitleMenuOpen(false);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:"none",border:"none",padding:"12px 14px",cursor:"pointer",textAlign:"left",borderBottom:`1px solid ${T.border}`}}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke={T.text} strokeWidth="2"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={T.text} strokeWidth="2" strokeLinecap="round"/></svg>
                  <span style={{fontFamily:F.body,fontSize:13,color:T.text}}>Profile</span>
                </button>
                <button role="menuitem" onClick={()=>{setActiveTab("options");setTitleMenuOpen(false);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:"none",border:"none",padding:"12px 14px",cursor:"pointer",textAlign:"left"}}>
                  <IconSettings/>
                  <span style={{fontFamily:F.body,fontSize:13,color:T.text}}>Settings</span>
                </button>
              </div>
            )}
          </div>
          {/* Profile button - always visible, absolutely centered in the header regardless of the side content's widths */}
          {!fbLoading&&(
            <button onClick={()=>setShowProfile(true)} aria-label="Profile" style={{position:"absolute",left:"50%",top:"50%",transform:"translate(-50%,-50%)",display:"flex",alignItems:"center",justifyContent:"center",background:"none",border:`1px solid ${T.border}`,borderRadius:"50%",width:32,height:32,padding:0,cursor:"pointer",transition:"all 0.15s",flexShrink:0}}>
              {fbUser?.photoURL
                ? <img src={fbUser.photoURL} alt="" style={{width:28,height:28,borderRadius:"50%",objectFit:"cover"}}/>
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill={T.textMuted}/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round"/></svg>
              }
            </button>
          )}
          <div style={{textAlign:"right"}}>
            <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint}}>time left</div>
            <div style={{fontFamily:F.heading,fontSize:20,color:effectiveThemeMode==="dark"?"#fff":"#000"}}>{totalMins>=60?`${Math.floor(totalMins/60)}h ${totalMins%60}m`:`${totalMins}m`}</div>
          </div>
        </div>
        <div style={{height:1,background:`linear-gradient(90deg,${T.accent},transparent)`,marginBottom:16}}/>

        <div className="app-body">
        <div className="app-sidebar">
        {/* Tabs */}
        <div className="tab-bar" style={{display:"flex",gap:3,marginBottom:16,background:T.surface+"cc",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:`1px solid ${T.border}`,borderRadius:999,padding:4}}>
          {(["tasks","tools","import"] as const).map(id=>{
            const labels:Record<string,string>={tasks:"Tasks",tools:"Tools",import:"Import"};
            const icons:Record<string,()=>React.JSX.Element>={tasks:IconTasks,tools:IconTools,import:IconImport};
            const Icon=icons[id];
            const active=activeTab===id;
            return <button key={id} onClick={()=>setActiveTab(id)} aria-label={labels[id]} aria-pressed={active} title={labels[id]}
              style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:active?T.card:"transparent",color:active?T.accent:T.textMuted,border:"none",borderRadius:999,padding:"10px 0",cursor:"pointer",transition:"all 0.18s cubic-bezier(.34,1.4,.64,1)"}}>
              <Icon/>
            </button>;
          })}
        </div>
        </div>
        <div className="app-main">

        {/* TASKS TAB */}
        {activeTab==="tasks"&&<>
          {/* AI Suggestion -- hidden entirely (box and the floating re-open
              button both) once there's no pending homework left, since
              there's nothing to suggest; reappears on its own as soon as a
              task is added, no separate state to reset. */}
          {topTask&&(showSuggestion?(
            <div style={{background:T.gradientCard,borderRadius:12,padding:"10px 12px",marginBottom:16,border:`1px solid ${T.accent}33`,position:"relative",overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:7,minWidth:0}}>
                  <span style={{fontSize:12,marginTop:1}}>✦</span>
                  {suggestionLoading?(<div className="shim" style={{height:11,width:140,marginTop:2}}/>):(<span style={{fontFamily:F.body,fontSize:12,color:T.text,lineHeight:1.4,whiteSpace:"pre-line"}}>{suggestion}</span>)}
                </div>
                <button onClick={()=>setShowSuggestion(false)} style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:16,lineHeight:1,padding:"0 2px",flexShrink:0}}>×</button>
              </div>
            </div>
          ):(
            <button onClick={()=>setShowSuggestion(true)} style={{position:"fixed",bottom:20,right:16,width:40,height:40,borderRadius:"50%",background:T.card,border:`1px solid ${T.accent}55`,boxShadow:`0 2px 10px ${T.accent}33`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,zIndex:50}} title="Show smart suggestion">
              ✦
            </button>
          ))}

          {/* Search */}
          <div style={{position:"relative",marginBottom:10}}>
            <input
              value={searchQuery}
              onChange={e=>setSearchQuery(e.target.value)}
              placeholder="Search tasks..."
              style={{width:"100%",background:T.card,border:`1px solid ${T.border}`,borderRadius:10,color:T.text,padding:"9px 32px 9px 13px",fontFamily:F.body,fontSize:13,outline:"none"}}
            />
            {searchQuery&&<button onClick={()=>setSearchQuery("")} style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:15,lineHeight:1,padding:6}}>×</button>}
          </div>

          {/* Filters + layout picker */}
          <div style={{display:"flex",gap:6,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
            {["all","pending","done","archived","inbox"].map(f=><button key={f} onClick={()=>setFilter(f)} style={{background:filter===f?T.accent:"none",color:filter===f?contrastColor(T.accent):T.textMuted,border:`1px solid ${filter===f?T.accent:T.border}`,borderRadius:999,padding:"4px 12px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>{f}</button>)}
            {topTask&&<button onClick={()=>setFocusMode(true)} style={{background:"none",border:`1px solid ${T.accent}55`,color:T.accent,borderRadius:999,padding:"4px 12px",fontFamily:F.body,fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>Focus</button>}
            {layout==="list"&&(selectionMode
              ? <button onClick={exitSelectionMode} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:999,padding:"4px 12px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>Cancel</button>
              : <button onClick={()=>setSelectionMode(true)} style={{background:"none",border:`1px solid ${T.border}`,color:T.textMuted,borderRadius:999,padding:"4px 12px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>Select</button>
            )}
            <div style={{marginLeft:"auto",fontFamily:F.body,fontSize:10,color:T.textFaint}}>{visibleTasks.filter(t=>!t.done&&!t.archived).length} pending</div>
          </div>

          {renderTasks(filteredTasks)}
          {filteredTasks.length===0&&<div style={{textAlign:"center",color:T.textFaint,fontFamily:F.body,fontSize:12,padding:"32px 0"}}>nothing here yet</div>}
          <div style={{marginTop:14}}>
            {!adding?(
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,paddingTop:10}}>
                <button onClick={startAdding} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:14,padding:"13px 28px",fontFamily:F.heading,fontSize:17,cursor:"pointer",boxShadow:`0 4px 20px ${T.accentGlow}`,transition:"all 0.2s"}}>+ add homework</button>
                {templates.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",maxWidth:340}}>
                  {templates.map(tpl=>(
                    <button key={tpl.id} onClick={()=>startFromTemplate(tpl)} className="chip" style={{background:T.card,color:T.textMuted,border:`1px solid ${T.border}`}}>{tpl.name}</button>
                  ))}
                </div>}
              </div>
            ):(
              <div style={{background:T.card,borderRadius:16,padding:"18px",border:`1px solid ${T.borderAccent}`,position:"relative"}}>
                <button onClick={()=>setAdding(false)} aria-label="Cancel" title="Cancel" style={{position:"absolute",top:10,right:10,background:"none",border:"none",color:T.textFaint,fontSize:20,lineHeight:1,cursor:"pointer",padding:4}}>×</button>
                <div style={{display:"flex",gap:5,marginBottom:14,justifyContent:"center"}}>
                  {[...Array(QUESTIONS.length+1)].map((_,i)=><div key={i} style={{width:i===step+1?20:6,height:6,borderRadius:999,background:i<=step+1?T.accent:T.border,transition:"all 0.3s"}}/>)}
                </div>
                <div>
                  {step===-1?(
                    <div>
                      <div style={{fontFamily:F.heading,fontSize:17,marginBottom:12,color:T.accent}}>What's the assignment?</div>
                      <form onSubmit={handleTitleSubmit} style={{display:"flex",gap:8}}>
                        <input ref={inputRef} defaultValue={newTask.title||""} placeholder="e.g. Chapter 3 reading..." autoFocus style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,color:T.text,padding:"10px 13px",fontFamily:F.body,fontSize:13,flex:1,outline:"none"}}/>
                        <button type="submit" style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:10,padding:"10px 16px",cursor:"pointer"}}>→</button>
                      </form>
                    </div>
                  ):currentQ?(
                    <div>
                      <div style={{fontFamily:F.heading,fontSize:17,marginBottom:12,color:T.accent}}>{currentQ.label}</div>
                      {currentQ.type==="select"&&<div style={{display:"flex",flexWrap:"wrap",gap:7}}>{subjects.map(opt=><button key={opt} className="chip" style={{background:subjectColors[opt]?subjectColors[opt]+"22":T.cardAlt,color:subjectColors[opt]||T.text,border:`1px solid ${subjectColors[opt]||T.border}`}} onClick={()=>handleAnswer(opt)}>{opt}</button>)}</div>}
                      {currentQ.type==="date"&&(pendingDueDate===null?(
                        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                          {[{l:"Today",d:0},{l:"Tomorrow",d:1},{l:"3 days",d:3},{l:"Next week",d:7}].map(({l,d})=>{const dt=new Date();dt.setDate(dt.getDate()+d);return<button key={l} className="chip" style={{background:T.cardAlt,color:T.text,border:`1px solid ${T.border}`}} onClick={()=>handleDateInput(localDateStr(dt))}>{l}</button>;})}
                          <input ref={inputRef} type="date" defaultValue="" onChange={e=>{inputValRef.current=e.target.value;}} onKeyDown={e=>e.key==="Enter"&&inputRef.current?.value&&handleDateInput(inputRef.current.value)} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,color:T.text,padding:"7px 11px",fontFamily:F.body,fontSize:12,flex:1,minWidth:120,outline:"none"}}/>
                          <button style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:10,padding:"7px 13px",cursor:"pointer"}} onClick={()=>inputRef.current?.value&&handleDateInput(inputRef.current.value)}>→</button>
                        </div>
                      ):(
                        <div>
                          <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginBottom:10}}>Due {formatDate(pendingDueDate)} -- what time? ⏰</div>
                          <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:12}}>
                            {[{l:"Any time",v:""},{l:"9:00 AM",v:"09:00"},{l:"3:00 PM",v:"15:00"},{l:"11:59 PM",v:"23:59"}].map(({l,v})=>(
                              <button key={l} className="chip" style={{background:T.cardAlt,color:T.text,border:`1px solid ${T.border}`}} onClick={()=>confirmDueTime(v)}>{l}</button>
                            ))}
                          </div>
                          <div style={{display:"flex",gap:7}}>
                            <input ref={inputRef} type="time" defaultValue="" style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,color:T.text,padding:"7px 11px",fontFamily:F.body,fontSize:12,flex:1,outline:"none"}}/>
                            <button style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:10,padding:"7px 13px",cursor:"pointer"}} onClick={()=>confirmDueTime(inputRef.current?.value||"")}>→</button>
                          </div>
                          <button onClick={()=>setPendingDueDate(null)} style={{background:"none",border:"none",color:T.textFaint,fontFamily:F.body,fontSize:11,cursor:"pointer",marginTop:10,padding:0}}>‹ back to date</button>
                        </div>
                      ))}
                      {currentQ.type==="time"&&(
                        <div>
                          {/* Quick picks */}
                          <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:14}}>
                            {[{l:"15 min",m:15},{l:"30 min",m:30},{l:"45 min",m:45},{l:"1 hour",m:60},{l:"1.5 hrs",m:90},{l:"2 hrs",m:120}].map(({l,m})=>(
                              <button key={l} className="chip" onClick={()=>handleAnswer(String(m))}
                                style={{background:T.cardAlt,color:T.text,border:`1px solid ${T.border}`}}>{l}</button>
                            ))}
                          </div>
                          {/* Custom time picker */}
                          <div style={{background:T.surface,borderRadius:12,padding:"14px",border:`1px solid ${T.border}`}}>
                            <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.08em"}}>Custom time</div>
                            <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"center"}}>
                              {/* Hours */}
                              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                                <button onClick={()=>setTimeHours(h=>Math.min(23,h+1))} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:7,width:36,height:28,cursor:"pointer",color:T.text,fontSize:14}}>▲</button>
                                <div style={{fontFamily:F.heading,fontSize:28,color:T.text,minWidth:44,textAlign:"center",lineHeight:1}}>{String(timeHours).padStart(2,"0")}</div>
                                <button onClick={()=>setTimeHours(h=>Math.max(0,h-1))} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:7,width:36,height:28,cursor:"pointer",color:T.text,fontSize:14}}>▼</button>
                                <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint}}>hrs</div>
                              </div>
                              <div style={{fontFamily:F.heading,fontSize:28,color:T.textMuted,marginBottom:16}}>:</div>
                              {/* Minutes */}
                              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                                <button onClick={()=>setTimeMins(m=>m>=55?0:m+5)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:7,width:36,height:28,cursor:"pointer",color:T.text,fontSize:14}}>▲</button>
                                <div style={{fontFamily:F.heading,fontSize:28,color:T.text,minWidth:44,textAlign:"center",lineHeight:1}}>{String(timeMins).padStart(2,"0")}</div>
                                <button onClick={()=>setTimeMins(m=>m<=0?55:m-5)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:7,width:36,height:28,cursor:"pointer",color:T.text,fontSize:14}}>▼</button>
                                <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint}}>min</div>
                              </div>
                              <div style={{fontFamily:F.heading,fontSize:28,color:T.textMuted,marginBottom:16}}>:</div>
                              {/* Seconds */}
                              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                                <button onClick={()=>setTimeSecs(s=>s>=55?0:s+5)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:7,width:36,height:28,cursor:"pointer",color:T.text,fontSize:14}}>▲</button>
                                <div style={{fontFamily:F.heading,fontSize:28,color:T.text,minWidth:44,textAlign:"center",lineHeight:1}}>{String(timeSecs).padStart(2,"0")}</div>
                                <button onClick={()=>setTimeSecs(s=>s<=0?55:s-5)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:7,width:36,height:28,cursor:"pointer",color:T.text,fontSize:14}}>▼</button>
                                <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint}}>sec</div>
                              </div>
                            </div>
                            {/* Preview + confirm */}
                            <div style={{marginTop:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                              <div style={{fontFamily:F.body,fontSize:12,color:T.textMuted}}>
                                {timeHours>0?`${timeHours}h `:""}{timeMins>0?`${timeMins}m `:""}{timeSecs>0?`${timeSecs}s`:""}{timeHours===0&&timeMins===0&&timeSecs===0?"0 min":""}
                                {" "}= {Math.round(timeHours*60+timeMins+timeSecs/60)} min total
                              </div>
                              <button onClick={()=>handleAnswer(String(Math.max(1,Math.round(timeHours*60+timeMins+timeSecs/60))))}
                                style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:9,padding:"8px 18px",fontFamily:F.body,fontSize:12,cursor:"pointer",fontWeight:500}}>
                                Set time →
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                      {currentQ.type==="recurrence"&&<div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                        {[{l:"Doesn't repeat",v:"none"},{l:"Daily",v:"daily"},{l:"Weekly",v:"weekly"},{l:"Monthly",v:"monthly"}].map(({l,v})=>(
                          <button key={v} className="chip" style={{background:T.cardAlt,color:T.text,border:`1px solid ${T.border}`}} onClick={()=>handleAnswer(v)}>{l}</button>
                        ))}
                      </div>}
                    </div>
                  ):null}
                  {newTask.title&&<div style={{marginTop:12,padding:"9px 13px",background:T.bg,borderRadius:10,border:`1px solid ${T.border}`}}>
                    <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint,marginBottom:2}}>adding</div>
                    <div style={{fontFamily:F.heading,fontSize:14,color:T.text}}>{newTask.title}</div>
                    <div style={{display:"flex",gap:8,marginTop:3,flexWrap:"wrap"}}>
                      {newTask.subject&&<span style={{color:subjectColors[newTask.subject]||T.accent,fontFamily:F.body,fontSize:10}}>{newTask.subject}</span>}
                      {newTask.dueDate&&<span style={{color:T.textMuted,fontFamily:F.body,fontSize:10}}>{formatDate(newTask.dueDate)}{newTask.dueTime?` at ${formatTime(newTask.dueTime)}`:""}</span>}
                      {newTask.recurrence&&newTask.recurrence!=="none"&&<span style={{color:T.textMuted,fontFamily:F.body,fontSize:10}}>↻ {newTask.recurrence}</span>}
                    </div>
                  </div>}
                </div>
                {step>-1&&<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:16}}>
                  <button onClick={goBackStep} aria-label="Go back" title="Go back" style={{background:T.cardAlt,border:`1px solid ${T.border}`,color:T.textMuted,fontSize:15,cursor:"pointer",padding:"7px 16px",borderRadius:10}}>‹ back</button>
                  <button onClick={goForwardStep} aria-label="Skip" title="Skip" style={{background:T.cardAlt,border:`1px solid ${T.border}`,color:T.textMuted,fontSize:15,cursor:"pointer",padding:"7px 16px",borderRadius:10}}>skip ›</button>
                </div>}
              </div>
            )}
          </div>
        </>}

        {/* TOOLS TAB */}
        {activeTab==="tools"&&(
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {/* Pomodoro */}
            {renderPomodoroCard()}

            {/* Stats */}
            <div style={{background:T.card,borderRadius:12,padding:"16px",border:`1px solid ${T.border}`}}>
              <div className="sl" style={{color:T.textMuted,paddingTop:0}}>Stats</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
                <div style={{background:T.surface,borderRadius:9,padding:"11px 8px",textAlign:"center"}}>
                  <div style={{fontFamily:F.heading,fontSize:20,color:T.accent}}>{tasksThisWeek}</div>
                  <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint,marginTop:1}}>This Week</div>
                </div>
                <div style={{background:T.surface,borderRadius:9,padding:"11px 8px",textAlign:"center"}}>
                  <div style={{fontFamily:F.heading,fontSize:20,color:T.accent}}>{tasksThisMonth}</div>
                  <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint,marginTop:1}}>This Month</div>
                </div>
              </div>
            </div>

            {/* Scratchpad */}
            <div style={{background:T.card,borderRadius:12,padding:"14px",border:`1px solid ${T.border}`}}>
              <div className="sl" style={{color:T.textMuted,paddingTop:0}}>Scratchpad</div>
              <textarea
                value={scratchpad}
                onChange={e=>updateScratchpad(e.target.value)}
                placeholder="Jot something down..."
                style={{width:"100%",minHeight:120,maxHeight:280,background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,color:T.text,padding:"10px 12px",fontFamily:F.body,fontSize:13,outline:"none",resize:"vertical",overflowY:"auto"}}
              />
            </div>

            {/* Templates */}
            {templates.length>0&&(
              <div style={{background:T.card,borderRadius:12,padding:"14px",border:`1px solid ${T.border}`}}>
                <div className="sl" style={{color:T.textMuted,paddingTop:0}}>Templates</div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {templates.map(tpl=>(
                    <div key={tpl.id} style={{display:"flex",alignItems:"center",gap:8,background:T.surface,borderRadius:9,padding:"9px 12px"}}>
                      <span style={{flex:1,fontFamily:F.body,fontSize:12,color:T.text}}>{tpl.name}</span>
                      <span style={{fontFamily:F.body,fontSize:10,color:T.textFaint}}>{tpl.subject}</span>
                      <button onClick={()=>{if(window.confirm(`Delete the "${tpl.name}" template?`))deleteTemplate(tpl.id);}} style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:14,lineHeight:1,padding:"0 2px"}}>×</button>
                    </div>
                  ))}
                </div>
                <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:8}}>
                  Save a task as a template from its detail view -- templates show up as quick-start chips above "add homework".
                </div>
              </div>
            )}
          </div>
        )}

        {/* IMPORT TAB */}
        {activeTab==="import"&&(
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <div style={{background:T.card,borderRadius:12,padding:"14px",border:`1px solid ${T.border}`}}>
              <div className="sl" style={{color:T.textMuted,paddingTop:0}}>Import from Syllabus</div>
              <div style={{fontFamily:F.body,fontSize:11,color:T.textFaint,marginBottom:10,lineHeight:1.5}}>
                Paste your syllabus below. Lines with a date (e.g. "Sept 20", "9/20", "2026-09-20") are picked up as assignments -- review and uncheck anything that isn't one before adding.
              </div>
              <textarea
                value={importText}
                onChange={e=>{setImportText(e.target.value);setImportPreview(null);setImportedCount(null);}}
                placeholder="Paste your syllabus text here..."
                style={{width:"100%",minHeight:160,maxHeight:320,background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,color:T.text,padding:"10px 12px",fontFamily:F.body,fontSize:13,outline:"none",resize:"vertical",overflowY:"auto",marginBottom:10}}
              />
              <div style={{marginBottom:10}}>
                <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Add as subject</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                  {subjects.map(s=>{
                    const active=(importSubject||subjects[0])===s;
                    return <button key={s} className="chip" onClick={()=>setImportSubject(s)} style={{background:active?(subjectColors[s]||T.accent)+"33":"none",color:active?(subjectColors[s]||T.accent):T.textMuted,border:`1.5px solid ${active?(subjectColors[s]||T.accent):T.border}`}}>{s}</button>;
                  })}
                </div>
              </div>
              <button onClick={scanSyllabus} disabled={!importText.trim()} style={{width:"100%",background:importText.trim()?T.accent:T.surface,color:importText.trim()?contrastColor(T.accent):T.textFaint,border:"none",borderRadius:10,padding:"11px",fontFamily:F.body,fontSize:13,fontWeight:500,cursor:importText.trim()?"pointer":"default"}}>
                Scan for assignments
              </button>
              {importedCount!==null&&<div style={{fontFamily:F.body,fontSize:12,color:"#2ED573",marginTop:10,textAlign:"center"}}>✓ Added {importedCount} task{importedCount===1?"":"s"}</div>}
            </div>

            {importPreview&&(
              <div style={{background:T.card,borderRadius:12,padding:"14px",border:`1px solid ${T.border}`}}>
                <div className="sl" style={{color:T.textMuted,paddingTop:0}}>
                  Found {importPreview.length} assignment{importPreview.length===1?"":"s"}
                </div>
                {importPreview.length===0?(
                  <div style={{textAlign:"center",color:T.textFaint,fontFamily:F.body,fontSize:12,padding:"16px 0"}}>No dated lines found -- try a different format.</div>
                ):(<>
                  <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12,maxHeight:320,overflowY:"auto"}}>
                    {importPreview.map((it,i)=>(
                      <div key={i} onClick={()=>toggleImportItem(i)} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 11px",background:T.surface,borderRadius:9,cursor:"pointer",opacity:it.checked?1:0.45}}>
                        <div style={{width:18,height:18,border:`2px solid ${it.checked?T.accent:T.textFaint}`,borderRadius:5,background:it.checked?T.accent:"none",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          {it.checked&&<span style={{color:contrastColor(T.accent),fontSize:11,fontWeight:"bold"}}>✓</span>}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontFamily:F.body,fontSize:12,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.title}</div>
                          <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:1}}>{formatDate(it.dueDate)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={commitImport} disabled={!importPreview.some(it=>it.checked)} style={{width:"100%",background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:10,padding:"11px",fontFamily:F.body,fontSize:13,fontWeight:500,cursor:"pointer"}}>
                    + Add {importPreview.filter(it=>it.checked).length} task{importPreview.filter(it=>it.checked).length===1?"":"s"}
                  </button>
                </>)}
              </div>
            )}
          </div>
        )}

        {/* OPTIONS TAB */}
        {activeTab==="options"&&(
          <div style={{display:"flex",flexDirection:"column",gap:8}}>

            {/* Account */}
            {!fbLoading&&(
              <button onClick={()=>setShowProfile(true)} style={{background:T.card,borderRadius:12,padding:"12px 14px",border:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:12,cursor:"pointer",width:"100%",textAlign:"left"}}>
                {fbUser?.photoURL
                  ? <img src={fbUser.photoURL} alt="" style={{width:38,height:38,borderRadius:"50%",objectFit:"cover",flexShrink:0}}/>
                  : <div style={{width:38,height:38,borderRadius:"50%",background:T.surface,border:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill={T.textMuted}/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round"/></svg>
                    </div>
                }
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:F.body,fontSize:13,color:T.text,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fbUser?fbUser.displayName:"Not signed in"}</div>
                  <div style={{fontFamily:F.body,fontSize:11,color:fbUser&&syncError?"#FF4757":T.textFaint,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fbUser?(syncError?"⚠ Sync issue -- tap for details":fbUser.email):"Tap to sign in & sync"}</div>
                </div>
                <span style={{color:T.textFaint,fontSize:16,flexShrink:0}}>›</span>
              </button>
            )}
            {/* Looks */}
            <div style={{background:T.card,borderRadius:12,padding:"16px",border:`1px solid ${T.border}`}}>
              <button onClick={()=>setLooksOpen(o=>!o)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",background:"none",border:"none",cursor:"pointer",padding:0,outline:"none",WebkitTapHighlightColor:"transparent"}}>
                <span style={{color:T.textMuted,fontFamily:"'DM Mono',monospace",fontSize:10,letterSpacing:".08em",textTransform:"uppercase"}}>Looks</span>
                <span style={{color:T.textMuted,fontSize:13,transform:looksOpen?"rotate(0deg)":"rotate(-90deg)",transition:"transform 0.15s",display:"inline-block"}}>⌄</span>
              </button>
              {looksOpen&&<div style={{display:"flex",flexDirection:"column",gap:20,marginTop:16}}>
              {/* Appearance mode */}
              <div>
                <div className="sl" style={{color:T.textMuted,paddingTop:0}}>Appearance</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7}}>
                  {([{k:"light",l:"Light",e:"○"},{k:"dark",l:"Dark",e:"●"},{k:"auto",l:"System",e:"◐"}] as const).map(({k,l,e})=>(
                    <button key={k} onClick={()=>setThemeMode(k)} style={{background:themeMode===k?T.accent+"22":T.surface,border:`1.5px solid ${themeMode===k?T.accent:T.border}`,borderRadius:9,padding:"9px 8px",cursor:"pointer",color:themeMode===k?T.accent:T.textMuted,fontFamily:F.body,fontSize:11,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                      <span style={{fontSize:15}}>{e}</span>
                      <span style={{fontWeight:500}}>{l}</span>
                    </button>
                  ))}
                </div>
                {themeMode==="auto"&&<div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:8,textAlign:"center"}}>Following your device -- currently {effectiveThemeMode}</div>}
              </div>
              {/* Layouts */}
              <div>
                <div className="sl" style={{color:T.textMuted,paddingTop:0}}>Layout ({Object.keys(LAYOUTS).length})</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7}}>
                  {(Object.entries(LAYOUTS) as [LayoutName,{name:string;emoji:string;desc:string}][]).map(([key,l])=>{
                    const active=layout===key;
                    const ic=T.accent;
                    const dim=active?ic:T.textFaint;
                    const icons:Record<string,React.JSX.Element>={
                      list:<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="4" width="18" height="3" rx="1.5" fill={dim}/><rect x="2" y="9.5" width="18" height="3" rx="1.5" fill={dim}/><rect x="2" y="15" width="18" height="3" rx="1.5" fill={dim}/></svg>,
                      compact:<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="4" width="18" height="2" rx="1" fill={dim}/><rect x="2" y="8" width="18" height="2" rx="1" fill={dim}/><rect x="2" y="12" width="18" height="2" rx="1" fill={dim}/><rect x="2" y="16" width="18" height="2" rx="1" fill={dim}/></svg>,
                      board:<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="2" width="8" height="8" rx="2" fill={dim}/><rect x="12" y="2" width="8" height="8" rx="2" fill={dim}/><rect x="2" y="12" width="8" height="8" rx="2" fill={dim}/><rect x="12" y="12" width="8" height="8" rx="2" fill={dim}/></svg>,
                      minimal:<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="4" cy="6" r="1.5" fill={dim}/><rect x="7" y="5" width="13" height="2" rx="1" fill={dim}/><circle cx="4" cy="11" r="1.5" fill={dim}/><rect x="7" y="10" width="13" height="2" rx="1" fill={dim}/><circle cx="4" cy="16" r="1.5" fill={dim}/><rect x="7" y="15" width="13" height="2" rx="1" fill={dim}/></svg>,
                      checklist:<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="4" width="5" height="5" rx="1.5" stroke={dim} strokeWidth="1.5"/><path d="M3.5 6.5l1.2 1.2L6.5 5" stroke={active?ic:T.textFaint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><rect x="9" y="5.5" width="11" height="2" rx="1" fill={dim}/><rect x="2" y="13" width="5" height="5" rx="1.5" stroke={dim} strokeWidth="1.5"/><rect x="9" y="14.5" width="11" height="2" rx="1" fill={dim}/></svg>,
                      sticky:<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="2" width="8" height="9" rx="2" fill={dim} opacity="0.9" transform="rotate(-4 2 2)"/><rect x="12" y="3" width="8" height="9" rx="2" fill={dim} opacity="0.7" transform="rotate(3 12 3)"/><rect x="3" y="12" width="8" height="8" rx="2" fill={dim} opacity="0.6" transform="rotate(2 3 12)"/></svg>,
                      kanban:<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="2" width="5" height="18" rx="1.5" fill={dim} opacity="0.4"/><rect x="9" y="2" width="5" height="13" rx="1.5" fill={dim} opacity="0.7"/><rect x="16" y="2" width="5" height="9" rx="1.5" fill={dim}/></svg>,
                      timeline:<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><line x1="6" y1="2" x2="6" y2="20" stroke={dim} strokeWidth="2" strokeLinecap="round"/><circle cx="6" cy="6" r="2.5" fill={dim}/><rect x="10" y="4.5" width="10" height="3" rx="1.5" fill={dim} opacity="0.7"/><circle cx="6" cy="12" r="2.5" fill={dim}/><rect x="10" y="10.5" width="7" height="3" rx="1.5" fill={dim} opacity="0.7"/><circle cx="6" cy="18" r="2.5" fill={dim}/><rect x="10" y="16.5" width="9" height="3" rx="1.5" fill={dim} opacity="0.7"/></svg>,
                      subject:<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="2" width="4" height="4" rx="1" fill={dim}/><rect x="8" y="2" width="4" height="4" rx="1" fill={dim} opacity="0.6"/><rect x="14" y="2" width="4" height="4" rx="1" fill={dim} opacity="0.4"/><rect x="2" y="9" width="18" height="11" rx="2" fill={dim} opacity="0.25"/><rect x="2" y="9" width="18" height="3" rx="1.5" fill={dim} opacity="0.5"/></svg>,
                      progress:<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="4" width="18" height="3.5" rx="1.75" fill={dim} opacity="0.2"/><rect x="2" y="4" width="14" height="3.5" rx="1.75" fill={dim}/><rect x="2" y="10" width="18" height="3.5" rx="1.75" fill={dim} opacity="0.2"/><rect x="2" y="10" width="9" height="3.5" rx="1.75" fill={dim}/><rect x="2" y="16" width="18" height="3.5" rx="1.75" fill={dim} opacity="0.2"/><rect x="2" y="16" width="16" height="3.5" rx="1.75" fill={dim}/></svg>,
                      pyramid:<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="7" y="3" width="8" height="4" rx="1.5" fill={dim}/><rect x="4" y="9" width="14" height="4" rx="1.5" fill={dim} opacity="0.7"/><rect x="1" y="15" width="20" height="4" rx="1.5" fill={dim} opacity="0.4"/></svg>,
                      calendar:<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="4" width="18" height="16" rx="2" stroke={dim} strokeWidth="1.5"/><line x1="2" y1="9" x2="20" y2="9" stroke={dim} strokeWidth="1.5"/><line x1="7" y1="2" x2="7" y2="6" stroke={dim} strokeWidth="1.5" strokeLinecap="round"/><line x1="15" y1="2" x2="15" y2="6" stroke={dim} strokeWidth="1.5" strokeLinecap="round"/><rect x="5" y="12" width="3" height="3" rx="0.75" fill={dim} opacity="0.7"/><rect x="10" y="12" width="3" height="3" rx="0.75" fill={dim} opacity="0.7"/><rect x="15" y="12" width="3" height="3" rx="0.75" fill={dim} opacity="0.4"/></svg>,
                    };
                    return(
                      <button key={key} onClick={()=>setLayout(key)}
                        style={{background:active?T.accent+"22":"none",border:`1.5px solid ${active?T.accent:T.border}`,borderRadius:11,padding:"10px 7px",cursor:"pointer",color:active?T.accent:T.textMuted,fontFamily:F.body,fontSize:11,display:"flex",flexDirection:"column",alignItems:"center",gap:5,transition:"all 0.14s"}}>
                        {icons[key]}
                        <span style={{fontWeight:500,fontSize:10}}>{l.name}</span>
                        <span style={{fontSize:9,opacity:0.6}}>{l.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Preview */}
              <div>
                <div className="sl" style={{color:T.textMuted,paddingTop:0}}>Preview</div>
                <div style={{background:T.surface,borderRadius:12,padding:"12px 14px",border:`1px solid ${T.accent}44`,position:"relative",overflow:"hidden"}}>
                  <div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:T.accent,borderRadius:"12px 0 0 12px"}}/>
                  <div style={{paddingLeft:7,display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                    <span className="rb" style={{background:T.accent+"33",color:T.accent}}>do first</span>
                    <span style={{fontFamily:F.heading,fontSize:15,color:T.text}}>Sample Assignment</span>
                    <span style={{background:"#FF6B6B22",color:"#FF6B6B",borderRadius:999,padding:"2px 8px",fontFamily:F.body,fontSize:10}}>Math</span>
                  </div>
                  <div style={{display:"flex",gap:12,marginTop:5,paddingLeft:7}}>
                    <span style={{fontFamily:F.body,fontSize:10,color:T.textMuted}}>Due tomorrow</span>
                    <span style={{fontFamily:F.body,fontSize:10,color:"#FFA502"}}>Due tomorrow</span>
                  </div>
                </div>
              </div>
              {/* Desktop layout */}
              <div>
                <div className="sl" style={{color:T.textMuted,paddingTop:0}}>Desktop Layout</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7}}>
                  {[{k:"narrow",l:"Narrow",d:"Centered column"},{k:"wide",l:"Wide",d:"Roomier column"},{k:"sidebar",l:"Sidebar",d:"Nav on the left"}].map(({k,l,d})=>(
                    <button key={k} onClick={()=>setDesktopLayout(k)} style={{background:desktopLayout===k?T.accent+"22":T.surface,border:`1.5px solid ${desktopLayout===k?T.accent:T.border}`,borderRadius:9,padding:"9px 8px",cursor:"pointer",color:desktopLayout===k?T.accent:T.textMuted,fontFamily:F.body,fontSize:11,display:"flex",flexDirection:"column",alignItems:"center",gap:2,textAlign:"center"}}>
                      <span style={{fontWeight:500}}>{l}</span>
                      <span style={{fontSize:9,opacity:0.7}}>{d}</span>
                    </button>
                  ))}
                </div>
                <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:8,textAlign:"center"}}>
                  Only changes anything on wider screens -- phones always get the narrow view
                </div>
              </div>
              {/* Urgency color coding */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                <div><div className="sl" style={{color:T.textMuted,paddingTop:0}}>Urgency Color Coding</div><div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:-4}}>Red for urgent, green for not urgent</div></div>
                <Toggle on={colorCodeUrgency} onChange={setColorCodeUrgency} T={T}/>
              </div>
            </div>}
            </div>
            {/* Group by */}
            <div style={{background:T.card,borderRadius:12,padding:"14px",border:`1px solid ${T.border}`}}>
              <div className="sl" style={{color:T.textMuted}}>Group Tasks By</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                {Object.entries(GROUP_BY).map(([key,g])=>(
                  <button key={key} onClick={()=>setGroupBy(key)} style={{background:groupBy===key?T.accent+"22":T.surface,border:`1.5px solid ${groupBy===key?T.accent:T.border}`,borderRadius:9,padding:"9px 11px",cursor:"pointer",color:groupBy===key?T.accent:T.textMuted,fontFamily:F.body,fontSize:11,display:"flex",alignItems:"center",gap:7}}><span>{g.emoji}</span>{g.name}</button>
                ))}
              </div>
            </div>
            {/* Toggles */}
            <div style={{background:T.card,borderRadius:12,padding:"13px 15px",border:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
              <div><div style={{fontFamily:F.body,fontSize:12,color:T.text}}>Show smart suggestion</div><div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:1}}>Study tip at the top of tasks</div></div>
              <Toggle on={showSuggestion} onChange={setShowSuggestion} T={T}/>
            </div>
            <div style={{background:T.card,borderRadius:12,padding:"13px 15px",border:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
              <div><div style={{fontFamily:F.body,fontSize:12,color:T.text}}>Show completed tasks</div><div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:1}}>Keep done tasks visible</div></div>
              <Toggle on={showDone} onChange={setShowDone} T={T}/>
            </div>
            <div style={{background:T.card,borderRadius:12,padding:"13px 15px",border:`1px solid ${T.border}`}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                <div><div style={{fontFamily:F.body,fontSize:12,color:T.text}}>Due date reminders</div><div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:1}}>Notify for tasks due today or overdue</div></div>
                <Toggle on={notificationsEnabled} onChange={toggleNotifications} T={T}/>
              </div>
              {notificationNote&&<div style={{fontFamily:F.body,fontSize:10,color:"#FF4757",marginTop:8}}>{notificationNote}</div>}
              {notificationsEnabled&&<div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:8}}>Only fires while this tab is open or when you reopen it -- not true background push.</div>}
              {notificationsEnabled&&(
                <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${T.border}`}}>
                  <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Remind me</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {REMINDER_OFFSETS.map(o=>(
                      <button key={o.key} onClick={()=>toggleOffset(o.key)} style={{display:"flex",alignItems:"center",gap:8,background:"none",border:"none",padding:0,cursor:"pointer",textAlign:"left"}}>
                        <div style={{width:16,height:16,border:`2px solid ${enabledOffsets.includes(o.key)?T.accent:T.textFaint}`,borderRadius:4,background:enabledOffsets.includes(o.key)?T.accent:"none",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          {enabledOffsets.includes(o.key)&&<span style={{color:contrastColor(T.accent),fontSize:10,fontWeight:"bold"}}>✓</span>}
                        </div>
                        <span style={{fontFamily:F.body,fontSize:12,color:T.text}}>{o.label}</span>
                      </button>
                    ))}
                  </div>
                  <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:8}}>
                    Only applies to tasks with a specific due time set (not just a date).
                  </div>
                </div>
              )}
            </div>
            {/* Auto-archive */}
            <div style={{background:T.card,borderRadius:12,padding:"14px",border:`1px solid ${T.border}`}}>
              <div className="sl" style={{color:T.textMuted,paddingTop:0}}>Auto-Archive Completed Tasks</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:7}}>
                {[{l:"Never",v:0},{l:"1 day",v:1},{l:"7 days",v:7},{l:"30 days",v:30}].map(({l,v})=>(
                  <button key={l} onClick={()=>setAutoArchiveDays(v)} style={{background:autoArchiveDays===v?T.accent+"22":T.surface,border:`1.5px solid ${autoArchiveDays===v?T.accent:T.border}`,borderRadius:9,padding:"9px 4px",cursor:"pointer",color:autoArchiveDays===v?T.accent:T.textMuted,fontFamily:F.body,fontSize:11}}>{l}</button>
                ))}
              </div>
              <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:8}}>
                Done tasks move to Archived after this long. You can still archive any task manually from its detail view.
              </div>
            </div>
            {/* Stats */}
            <div style={{background:T.card,borderRadius:12,padding:"14px",border:`1px solid ${T.border}`}}>
              <div className="sl" style={{color:T.textMuted}}>Stats</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:9}}>
                {[{label:"Total",val:visibleTasks.length},{label:"Done",val:visibleTasks.filter(t=>t.done).length},{label:"Hours",val:`${(totalMins/60).toFixed(1)}h`}].map(({label,val})=>(
                  <div key={label} style={{background:T.surface,borderRadius:9,padding:"11px 8px",textAlign:"center"}}>
                    <div style={{fontFamily:F.heading,fontSize:20,color:T.accent}}>{val}</div>
                    <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint,marginTop:1}}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
            {/* Export */}
            <div style={{background:T.card,borderRadius:12,padding:"14px",border:`1px solid ${T.border}`}}>
              <div className="sl" style={{color:T.textMuted,paddingTop:0}}>Your Data</div>
              <div style={{display:"flex",gap:7}}>
                <button onClick={exportAllDataJSON} style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 4px",cursor:"pointer",color:T.textMuted,fontFamily:F.body,fontSize:11}}>Export all (JSON)</button>
                <button onClick={exportTasksCSV} style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 4px",cursor:"pointer",color:T.textMuted,fontFamily:F.body,fontSize:11}}>Export tasks (CSV)</button>
              </div>
            </div>
            <a href="https://forms.gle/oPuAWx6jNHvm75xi8" target="_blank" rel="noopener noreferrer" style={{display:"block",boxSizing:"border-box",textAlign:"center",textDecoration:"none",background:"none",border:`1px solid ${T.border}`,borderRadius:9,color:T.textMuted,fontFamily:F.body,fontSize:11,padding:"9px 14px",cursor:"pointer",width:"100%"}}>Send feedback / report a bug</a>
            <button onClick={()=>{if(window.confirm("Clear all completed tasks?"))setTasks(prev=>prev.filter(t=>!t.done));}} style={{background:"none",border:`1px solid #FF475744`,borderRadius:9,color:"#FF4757",fontFamily:F.body,fontSize:11,padding:"9px 14px",cursor:"pointer",width:"100%"}}>Clear completed tasks</button>
            {fbUser&&(
              <div style={{background:T.card,borderRadius:12,padding:"14px",border:"1px solid #FF475744"}}>
                <div className="sl" style={{color:"#FF4757",paddingTop:0}}>Danger Zone</div>
                {!showDeleteAccountConfirm ? (
                  <button onClick={()=>{setShowDeleteAccountConfirm(true);setDeleteConfirmText("");setDeleteAccountError(null);}} style={{background:"none",border:`1px solid #FF475744`,borderRadius:9,color:"#FF4757",fontFamily:F.body,fontSize:11,padding:"9px 14px",cursor:"pointer",width:"100%"}}>Delete my account & all data</button>
                ) : (
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,lineHeight:1.5}}>
                      This permanently deletes your account, every task, and all settings -- on this device and in the cloud. This can't be undone. Type <b>DELETE</b> to confirm.
                    </div>
                    <input value={deleteConfirmText} onChange={e=>setDeleteConfirmText(e.target.value)} placeholder="DELETE" style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,color:T.text,padding:"9px 12px",fontFamily:F.body,fontSize:13,outline:"none"}}/>
                    {deleteAccountError&&<div style={{fontFamily:F.body,fontSize:11,color:"#FF4757"}}>{deleteAccountError}</div>}
                    <div style={{display:"flex",gap:7}}>
                      <button onClick={()=>setShowDeleteAccountConfirm(false)} style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 4px",cursor:"pointer",color:T.textMuted,fontFamily:F.body,fontSize:11}}>Cancel</button>
                      <button disabled={deleteConfirmText!=="DELETE"||deleteAccountBusy} onClick={deleteAccountForever} style={{flex:1,background:deleteConfirmText==="DELETE"?"#FF4757":T.surface,border:"none",borderRadius:9,padding:"9px 4px",cursor:deleteConfirmText==="DELETE"?"pointer":"not-allowed",color:deleteConfirmText==="DELETE"?"#fff":T.textFaint,fontFamily:F.body,fontSize:11,opacity:deleteAccountBusy?0.6:1}}>{deleteAccountBusy?"Deleting…":"Delete forever"}</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div style={{textAlign:"center",fontFamily:F.body,fontSize:9,color:T.textFaint,paddingTop:4}}>DuePlanner v{__APP_VERSION__}</div>
          </div>
        )}
        </div>
        </div>
      </div>
      {selectedTask&&<ErrorBoundary fallback={()=>(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{background:T.card,borderRadius:12,padding:24,maxWidth:320,textAlign:"center",display:"flex",flexDirection:"column",gap:12,border:`1px solid ${T.border}`}}>
            <div style={{color:T.text,fontFamily:F.body,fontSize:14}}>This task couldn't be displayed.</div>
            <button onClick={()=>{setSelectedTask(null);setSessionHistory([]);}} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:9,padding:"9px 16px",fontFamily:F.body,fontSize:13,cursor:"pointer"}}>Close</button>
          </div>
        </div>
      )}>
        <TaskModal
          task={tasks.find(t=>t.id===selectedTask.id)||selectedTask}
          T={T} F={F} subjectColors={subjectColors} colorCodeUrgency={colorCodeUrgency}
          sessionActive={sessionActive} sessionSecs={sessionSecs} sessionHistory={sessionHistory}
          allTags={allTags}
          onClose={()=>{setSelectedTask(null);setSessionHistory([]);}}
          onStartSession={startSession} onEndSession={endSession}
          onToggleDone={()=>{toggleDone(selectedTask.id);setSelectedTask(null);setSessionHistory([]);}}
          onDelete={()=>{deleteTask(selectedTask.id);setSelectedTask(null);setSessionHistory([]);}}
          onUpdateSubtasks={subtasks=>updateSubtasks(selectedTask.id,subtasks)}
          onArchive={()=>{archiveTask(selectedTask.id);setSelectedTask(null);}}
          onSetPriorityOverride={override=>setPriorityOverride(selectedTask.id,override)}
          onSetTags={tags=>setTaskTags(selectedTask.id,tags)}
          onSaveAsTemplate={name=>saveAsTemplate(tasks.find(t=>t.id===selectedTask.id)||selectedTask,name)}
        />
      </ErrorBoundary>}
      {showProfile&&<ProfileModal
        T={T} F={F}
        fbUser={fbUser} signInError={signInError} syncError={syncError}
        visibleTasks={visibleTasks} totalMins={totalMins}
        subjects={subjects} subjectColors={subjectColors} colorCodeUrgency={colorCodeUrgency}
        themeName={themeName}
        newSubjectText={newSubjectText} setNewSubjectText={setNewSubjectText}
        profileTab={profileTab} setProfileTab={setProfileTab}
        setShowProfile={setShowProfile}
        signInWithFirebase={signInWithFirebase}
        signOutFirebase={signOutFirebase}
        addSubject={addSubject}
        removeSubject={removeSubject}
      />}
      {/* Undo Delete toast -- bottom-center so it never collides with the
          bottom-right smart-suggestion icon or the tab bar above it. */}
      {deleteToast!=null&&(
        <div style={{position:"fixed",left:"50%",bottom:20,transform:"translateX(-50%)",zIndex:1500,display:"flex",alignItems:"center",gap:10,background:T.card,border:`1px solid ${T.border}`,borderRadius:999,padding:"10px 10px 10px 16px",boxShadow:"0 6px 24px rgba(0,0,0,0.3)",maxWidth:"calc(100vw - 32px)"}}>
          <span style={{fontFamily:F.body,fontSize:12,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:180}}>"{deleteToast}" deleted</span>
          <button onClick={undo} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:999,padding:"6px 14px",fontFamily:F.body,fontSize:12,fontWeight:500,cursor:"pointer",flexShrink:0}}>Undo</button>
        </div>
      )}
      {/* Bulk action bar -- only reachable via the "Select" toggle, list layout only */}
      {selectionMode&&selectedIds.length>0&&(
        <div style={{position:"fixed",left:"50%",bottom:20,transform:"translateX(-50%)",zIndex:1500,display:"flex",alignItems:"center",gap:8,background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:"10px 14px",boxShadow:"0 6px 24px rgba(0,0,0,0.3)",maxWidth:"calc(100vw - 32px)",flexWrap:"wrap",justifyContent:"center"}}>
          <span style={{fontFamily:F.body,fontSize:12,color:T.text,fontWeight:500}}>{selectedIds.length} selected</span>
          <button onClick={()=>bulkMarkDone(selectedIds)} style={{background:"#2ED57322",color:"#2ED573",border:"1px solid #2ED57344",borderRadius:9,padding:"7px 10px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>✓ Done</button>
          <button onClick={()=>bulkArchive(selectedIds)} style={{background:T.surface,color:T.textMuted,border:`1px solid ${T.border}`,borderRadius:9,padding:"7px 10px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>Archive</button>
          <select onChange={e=>{if(e.target.value)bulkSetSubject(selectedIds,e.target.value);}} defaultValue="" style={{background:T.surface,color:T.textMuted,border:`1px solid ${T.border}`,borderRadius:9,padding:"7px 8px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>
            <option value="" disabled>Set subject...</option>
            {subjects.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={()=>bulkDelete(selectedIds)} style={{background:"#FF475711",color:"#FF4757",border:"1px solid #FF475733",borderRadius:9,padding:"7px 10px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>Delete</button>
        </div>
      )}
    </div>
  );
}
