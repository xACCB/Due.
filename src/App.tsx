import { useState, useEffect, useRef, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut as fbSignOut, onAuthStateChanged } from "firebase/auth";
import type { User } from "firebase/auth";
import { getFirestore, doc, setDoc, onSnapshot } from "firebase/firestore";

const GOOGLE_CLIENT_ID = ""; // unused
const GOOGLE_SCOPES = ""; // unused

// ─── FIREBASE ────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyD9W3eTvKjthiEZ_0MjeCHBIZ6BevMKgSo",
  authDomain: "ai-homework-planner-92260.firebaseapp.com",
  projectId: "ai-homework-planner-92260",
  storageBucket: "ai-homework-planner-92260.firebasestorage.app",
  messagingSenderId: "445404835645",
  appId: "1:445404835645:web:c84c3f1bbb8cbfe171df54",
};
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const googleProvider = new GoogleAuthProvider();

// ─── THEMES (22 total) ────────────────────────────────────────────────────────
const THEMES = {
  midnight:    { name:"Midnight",    emoji:"🌙", bg:"#0F0F1A", card:"#16162A", cardAlt:"#1e1e35", border:"#252540", borderAccent:"#2A2A50", text:"#EEE8D5", textMuted:"#888",   textFaint:"#555",   accent:"#F0A500", surface:"#1A1A2E" },
  nord:        { name:"Nord",        emoji:"❄️", bg:"#2E3440", card:"#3B4252", cardAlt:"#434C5E", border:"#4C566A", borderAccent:"#5E6E82", text:"#ECEFF4", textMuted:"#D8DEE9", textFaint:"#8894a8", accent:"#88C0D0", surface:"#3B4252" },
  olivia:      { name:"Olivia",      emoji:"🌹", bg:"#1b1b1b", card:"#2a2a2a", cardAlt:"#333333", border:"#3d3d3d", borderAccent:"#4a4a4a", text:"#e8c4b8", textMuted:"#b08070", textFaint:"#6a4a40", accent:"#e05c5c", surface:"#252525" },
  stealth:     { name:"Stealth",     emoji:"🕶️", bg:"#0a0a0a", card:"#111111", cardAlt:"#1a1a1a", border:"#222222", borderAccent:"#2a2a2a", text:"#cccccc", textMuted:"#666666", textFaint:"#333333", accent:"#ffffff", surface:"#0f0f0f" },
  serika:      { name:"Serika",      emoji:"🌾", bg:"#e1dbd2", card:"#cdc6bd", cardAlt:"#d5cec5", border:"#b8b0a5", borderAccent:"#a8a09a", text:"#3b3a36", textMuted:"#7a7060", textFaint:"#aaa090", accent:"#e2b714", surface:"#d4cdc4" },
  catppuccin:  { name:"Catppuccin",  emoji:"🐱", bg:"#1e1e2e", card:"#313244", cardAlt:"#3a3a54", border:"#45475a", borderAccent:"#585b70", text:"#cdd6f4", textMuted:"#a6adc8", textFaint:"#6c7086", accent:"#cba6f7", surface:"#181825" },
  tokyonight:  { name:"Tokyo Night", emoji:"🗼", bg:"#1a1b26", card:"#24283b", cardAlt:"#2f344d", border:"#383d5a", borderAccent:"#414868", text:"#c0caf5", textMuted:"#9aa5ce", textFaint:"#565f89", accent:"#7dcfff", surface:"#16161e" },
  dracula:     { name:"Dracula",     emoji:"🧛", bg:"#282a36", card:"#343746", cardAlt:"#3d4059", border:"#44475a", borderAccent:"#555777", text:"#f8f8f2", textMuted:"#bd93f9", textFaint:"#6272a4", accent:"#ff79c6", surface:"#21222c" },
  rosepine:    { name:"Rosé Pine",   emoji:"🌸", bg:"#191724", card:"#1f1d2e", cardAlt:"#26233a", border:"#2a2740", borderAccent:"#393552", text:"#e0def4", textMuted:"#908caa", textFaint:"#524f67", accent:"#ebbcba", surface:"#1a1826" },
  matrix:      { name:"Matrix",      emoji:"💻", bg:"#0a0f0a", card:"#0d160d", cardAlt:"#111e11", border:"#1a2e1a", borderAccent:"#1f381f", text:"#00ff41", textMuted:"#00aa2b", textFaint:"#005515", accent:"#00ff41", surface:"#0b120b" },
  blush:       { name:"Blush",       emoji:"💗", bg:"#1a0e14", card:"#2a1520", cardAlt:"#351a28", border:"#3d2030", borderAccent:"#4a2838", text:"#f5dde8", textMuted:"#c49aaa", textFaint:"#7a5060", accent:"#f472b6", surface:"#22101a" },
  paper:       { name:"Paper",       emoji:"📄", bg:"#f5f0e8", card:"#faf7f2", cardAlt:"#ffffff", border:"#e0d8cc", borderAccent:"#cec4b4", text:"#2c2416", textMuted:"#7a6a55", textFaint:"#b0a090", accent:"#c2440f", surface:"#ede8df" },
  gruvbox:     { name:"Gruvbox",     emoji:"🟫", bg:"#282828", card:"#3c3836", cardAlt:"#504945", border:"#665c54", borderAccent:"#7c6f64", text:"#ebdbb2", textMuted:"#a89984", textFaint:"#7c6f64", accent:"#fabd2f", surface:"#32302f" },
  milkshake:   { name:"Milkshake",   emoji:"🥤", bg:"#fdf6ff", card:"#f5eaff", cardAlt:"#eedeff", border:"#ddc8f5", borderAccent:"#ccb3ee", text:"#3b1f5e", textMuted:"#8b6aaa", textFaint:"#c4a8e0", accent:"#b44fd1", surface:"#f0e0ff" },
  suisei:      { name:"Suisei",      emoji:"⭐", bg:"#0d0e1a", card:"#131428", cardAlt:"#1a1b35", border:"#252645", borderAccent:"#2e2f55", text:"#e8eaf6", textMuted:"#9fa8da", textFaint:"#3d4070", accent:"#7c83e8", surface:"#0f1020" },
  onedark:     { name:"One Dark",    emoji:"🌑", bg:"#282c34", card:"#21252b", cardAlt:"#2c313a", border:"#3e4451", borderAccent:"#4b5263", text:"#abb2bf", textMuted:"#828997", textFaint:"#4b5263", accent:"#61afef", surface:"#1e2127" },
  cherry:      { name:"Cherry",      emoji:"🌸", bg:"#1a0a0f", card:"#2a1018", cardAlt:"#351520", border:"#4a1f2d", borderAccent:"#5c2638", text:"#fce4ec", textMuted:"#f48fb1", textFaint:"#6a2040", accent:"#f06292", surface:"#200c14" },
  discord:     { name:"Discord",     emoji:"💬", bg:"#313338", card:"#2b2d31", cardAlt:"#232428", border:"#3f4147", borderAccent:"#4e5058", text:"#dbdee1", textMuted:"#949ba4", textFaint:"#4e5058", accent:"#5865f2", surface:"#1e1f22" },
  bliss:       { name:"Bliss",       emoji:"🌅", bg:"#1a1625", card:"#221e30", cardAlt:"#2a263c", border:"#373048", borderAccent:"#433a58", text:"#e8e0f5", textMuted:"#a89bc4", textFaint:"#5a5070", accent:"#c9a8f5", surface:"#1d1929" },
  dev:         { name:"Dev",         emoji:"🖥️", bg:"#1e1e1e", card:"#252526", cardAlt:"#2d2d2d", border:"#3c3c3c", borderAccent:"#4a4a4a", text:"#d4d4d4", textMuted:"#858585", textFaint:"#3c3c3c", accent:"#569cd6", surface:"#1e1e1e" },
  dark:        { name:"Dark",        emoji:"🌚", bg:"#000000", card:"#0d0d0d", cardAlt:"#141414", border:"#1f1f1f", borderAccent:"#2a2a2a", text:"#e0e0e0", textMuted:"#666666", textFaint:"#2a2a2a", accent:"#ffffff", surface:"#080808" },
  shadow:      { name:"Shadow",      emoji:"👤", bg:"#0c0c0f", card:"#13131a", cardAlt:"#1a1a24", border:"#22222e", borderAccent:"#2a2a3a", text:"#c8c8d8", textMuted:"#6a6a88", textFaint:"#2a2a3a", accent:"#7070aa", surface:"#0f0f15" },
} as const;
type ThemeName = keyof typeof THEMES;
type ThemeObj = Omit<typeof THEMES[ThemeName], "accent"> & { accent: string; accentGlow: string; gradientCard: string };

const LAYOUTS = {
  list:      { name:"List",       emoji:"☰",  desc:"Classic cards" },
  compact:   { name:"Compact",    emoji:"⊟",  desc:"Slim rows" },
  board:     { name:"Board",      emoji:"⊞",  desc:"Grid cards" },
  minimal:   { name:"Minimal",    emoji:"·",  desc:"Just text" },
  checklist: { name:"Checklist",  emoji:"☑",  desc:"Simple ticks" },
  sticky:    { name:"Sticky",     emoji:"🗒",  desc:"Sticky notes" },
  kanban:    { name:"Kanban",     emoji:"𝄘",  desc:"By status" },
  timeline:  { name:"Timeline",   emoji:"↓",  desc:"Time ordered" },
  subject:   { name:"By Subject", emoji:"📚", desc:"Subject tabs" },
  progress:  { name:"Progress",   emoji:"▓",  desc:"Progress bars" },
  pyramid:   { name:"Pyramid",    emoji:"△",  desc:"By priority" },
  calendar:  { name:"Calendar",   emoji:"📅", desc:"Week view" },
} as const;
type LayoutName = keyof typeof LAYOUTS;

// ─── FONTS ────────────────────────────────────────────────────────────────────
const FONTS = {
  dmSerif:      { name:"DM Serif",        preview:"Homework.",  heading:"'DM Serif Display', serif",   body:"'DM Mono', monospace",        google:"DM+Serif+Display:ital@0;1&family=DM+Mono:wght@400;500" },
  inter:        { name:"Inter",           preview:"Homework.",  heading:"'Inter', sans-serif",          body:"'Inter', sans-serif",          google:"Inter:wght@400;500;600;700" },
  jakarta:      { name:"Plus Jakarta",    preview:"Homework.",  heading:"'Plus Jakarta Sans', sans-serif", body:"'Plus Jakarta Sans', sans-serif", google:"Plus+Jakarta+Sans:wght@400;500;600;700" },
  playfair:     { name:"Playfair",        preview:"Homework.",  heading:"'Playfair Display', serif",    body:"'Inter', sans-serif",          google:"Playfair+Display:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500" },
  cormorant:    { name:"Cormorant",       preview:"Homework.",  heading:"'Cormorant Garamond', serif",  body:"'Inter', sans-serif",          google:"Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500" },
  nunito:       { name:"Nunito",          preview:"Homework.",  heading:"'Nunito', sans-serif",         body:"'Nunito', sans-serif",          google:"Nunito:wght@400;500;600;700;800" },
  poppins:      { name:"Poppins",         preview:"Homework.",  heading:"'Poppins', sans-serif",        body:"'Poppins', sans-serif",         google:"Poppins:wght@400;500;600;700" },
  jetbrains:    { name:"JetBrains Mono",  preview:"Homework.",  heading:"'JetBrains Mono', monospace",  body:"'JetBrains Mono', monospace",   google:"JetBrains+Mono:wght@400;500;700" },
  firacode:     { name:"Fira Code",       preview:"Homework.",  heading:"'Fira Code', monospace",       body:"'Fira Code', monospace",        google:"Fira+Code:wght@400;500;700" },
  sourceserif:  { name:"Source Serif",    preview:"Homework.",  heading:"'Source Serif 4', serif",      body:"'Source Serif 4', serif",       google:"Source+Serif+4:ital,wght@0,400;0,600;1,400" },
  lora:         { name:"Lora",            preview:"Homework.",  heading:"'Lora', serif",                body:"'Inter', sans-serif",           google:"Lora:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500" },
  spacegrotesk: { name:"Space Grotesk",   preview:"Homework.",  heading:"'Space Grotesk', sans-serif",  body:"'Space Grotesk', sans-serif",   google:"Space+Grotesk:wght@400;500;600;700" },
  ibmplex:      { name:"IBM Plex Serif",  preview:"Homework.",  heading:"'IBM Plex Serif', serif",      body:"'IBM Plex Sans', sans-serif",   google:"IBM+Plex+Serif:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Sans:wght@400;500" },
  syne:         { name:"Syne",            preview:"Homework.",  heading:"'Syne', sans-serif",           body:"'Inter', sans-serif",           google:"Syne:wght@400;500;600;700;800" },
  outfit:       { name:"Outfit",          preview:"Homework.",  heading:"'Outfit', sans-serif",         body:"'Outfit', sans-serif",          google:"Outfit:wght@300;400;500;600;700" },
  pixel:        { name:"Pixel",           preview:"HW.",        heading:"'Press Start 2P', monospace",  body:"'Press Start 2P', monospace",   google:"Press+Start+2P" },
} as const;
type FontName = keyof typeof FONTS;

const GROUP_BY = { none:{name:"None",emoji:"--"}, subject:{name:"Subject",emoji:"📚"}, priority:{name:"Priority",emoji:"🔥"}, dueDate:{name:"Due Date",emoji:"📅"} };
const SUBJECTS = ["Math","English","Science","History","Art","PE","Other"];
const SUBJECT_COLORS: Record<string,string> = { Math:"#FF6B6B",English:"#4ECDC4",Science:"#45B7D1",History:"#F7DC6F",Art:"#BB8FCE",PE:"#82E0AA",Other:"#F0A500" };
const PRIORITY_COLORS: Record<string,string> = { high:"#FF4757",medium:"#FFA502",low:"#2ED573" };
const QUESTIONS = [
  { key:"subject", label:"What subject? 📚", type:"select", options:SUBJECTS },
  { key:"dueDate", label:"When is it due? 📅", type:"date" },
  { key:"estMins", label:"How long will it take? ⏱️", type:"time" },
  { key:"notes", label:"Paste rubric or instructions 📋 (optional)", type:"text", optional:true },
];

interface Task { id:number; title:string; subject:string; dueDate:string; estMins:number; notes:string; done:boolean; }

const DEFAULT_TASKS: Task[] = [
  { id:1, title:"Chapter 5 Review", subject:"Math", dueDate:new Date(Date.now()+86400000).toISOString().split("T")[0], estMins:45, notes:"Focus on quadratics", done:false },
  { id:2, title:"Essay Draft", subject:"English", dueDate:new Date(Date.now()+3*86400000).toISOString().split("T")[0], estMins:90, notes:"", done:false },
  { id:3, title:"Lab Report", subject:"Science", dueDate:new Date(Date.now()+5*86400000).toISOString().split("T")[0], estMins:60, notes:"", done:false },
  { id:4, title:"History Reading", subject:"History", dueDate:new Date(Date.now()+2*86400000).toISOString().split("T")[0], estMins:30, notes:"Pages 120-145", done:false },
];

function getPriority(dueDate:string, estMins:number):string {
  if (!dueDate) return "low";
  const d=(new Date(dueDate).getTime()-Date.now())/86400000;
  if (d<1||(d<2&&estMins>60)) return "high"; if (d<3) return "medium"; return "low";
}
function formatDate(s:string):string {
  if (!s) return "No date";
  return new Date(s+"T00:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
}
function daysUntil(s:string):string|null {
  if (!s) return null;
  const now=new Date(); now.setHours(0,0,0,0);
  const d=Math.ceil((new Date(s+"T00:00:00").getTime()-now.getTime())/86400000);
  if (d<0) return "Overdue!"; if (d===0) return "Due today!"; if (d===1) return "Due tomorrow"; return `${d} days left`;
}

async function fetchAISuggestion(tasks:Task[]):Promise<string> {
  // NOTE: this used to call api.anthropic.com directly from the browser with no
  // auth header, so it silently failed on every call. Calling a paid AI API from
  // client-side code isn't secure anyway (the key would be visible to anyone),
  // so this generates the suggestion locally from the task data instead.
  const pending=tasks.filter(t=>!t.done);
  if (pending.length===0) return "Nothing left to do -- great work! 🎉";
  if (pending.length===1) return `Just one task left: "${pending[0].title}". You've got this! 💪`;
  const sorted=[...pending].sort((a,b)=>{
    const o:Record<string,number>={high:0,medium:1,low:2};
    const d=o[getPriority(a.dueDate,a.estMins)]-o[getPriority(b.dueDate,b.estMins)];
    return d!==0?d:(a.dueDate||"").localeCompare(b.dueDate||"");
  });
  const top=sorted[0];
  const days=daysUntil(top.dueDate);
  const timeStr=top.estMins>=60?`${Math.floor(top.estMins/60)}h${top.estMins%60?` ${top.estMins%60}m`:""}`:`${top.estMins}m`;
  const urgencyWord=days==="Overdue!"?"overdue":days==="Due today!"?"due today":days==="Due tomorrow"?"due tomorrow":days?days.replace(" days left","d left"):"no deadline";
  return `Start with "${top.title}"\n${urgencyWord}, ~${timeStr}`;
}

export default function HomeworkPlanner() {
  const [tasks,setTasks]=useState<Task[]>(()=>{try{const s=localStorage.getItem("hw-tasks");return s?JSON.parse(s):DEFAULT_TASKS;}catch{return DEFAULT_TASKS;}});
  const [selectedTask,setSelectedTask]=useState<Task|null>(null);
  const [themeName,setThemeName]=useState<ThemeName>(()=>(localStorage.getItem("hw-theme") as ThemeName)||"midnight");
  const [layout,setLayout]=useState<LayoutName>(()=>(localStorage.getItem("hw-layout") as LayoutName)||"list");
  const [groupBy,setGroupBy]=useState(()=>localStorage.getItem("hw-group")||"none");
  const [showDone,setShowDone]=useState(()=>localStorage.getItem("hw-showdone")!=="false");
  const [showSuggestion,setShowSuggestion]=useState(()=>localStorage.getItem("hw-showsuggestion")!=="false");
  const [accentOverride,setAccentOverride]=useState<string|null>(()=>localStorage.getItem("hw-accent")||null);
  const [fontName,setFontName]=useState<FontName>(()=>(localStorage.getItem("hw-font") as FontName)||"dmSerif");
  useEffect(()=>{localStorage.setItem("hw-font",fontName);},[fontName]);
  // Desktop layout: "narrow" (default, current single-column look), "wide" (roomier
  // center column), "sidebar" (tabs move into a persistent left nav column). All of
  // these only kick in above a min-width via CSS media queries, so phones/tablets
  // always render the same single narrow column regardless of this setting.
  const [desktopLayout,setDesktopLayout]=useState(()=>localStorage.getItem("hw-desktoplayout")||"narrow");
  useEffect(()=>{localStorage.setItem("hw-desktoplayout",desktopLayout);},[desktopLayout]);

  useEffect(()=>{localStorage.setItem("hw-tasks",JSON.stringify(tasks));},[tasks]);
  useEffect(()=>{localStorage.setItem("hw-theme",themeName);},[themeName]);
  useEffect(()=>{localStorage.setItem("hw-layout",layout);},[layout]);
  useEffect(()=>{localStorage.setItem("hw-group",groupBy);},[groupBy]);
  useEffect(()=>{localStorage.setItem("hw-showdone",String(showDone));},[showDone]);
  useEffect(()=>{localStorage.setItem("hw-showsuggestion",String(showSuggestion));},[showSuggestion]);
  useEffect(()=>{if(accentOverride)localStorage.setItem("hw-accent",accentOverride);else localStorage.removeItem("hw-accent");},[accentOverride]);

  // ── FIREBASE AUTH ─────────────────────────────────────────────────────────────
  const [fbUser,setFbUser]=useState<User|null>(null);
  const [fbLoading,setFbLoading]=useState(true);
  const [signInError,setSignInError]=useState<string|null>(null);
  const isSyncing=useRef(false);

  // Listen for auth state
  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,user=>{
      setFbUser(user);
      setFbLoading(false);
    });
    // Only relevant if signInWithFirebase had to fall back to the redirect
    // method below (e.g. a browser that blocks/mishandles the popup) -- this
    // is where any error from THAT flow surfaces, since there's no popup
    // promise to catch in that case.
    getRedirectResult(auth).catch(e=>{
      console.error(e);
      const code=(e as {code?:string})?.code||"unknown";
      setSignInError(`Sign-in didn't go through (${code}). Please try again.`);
    });
    return unsub;
  },[]);

  // When signed in, sync tasks FROM Firestore
  useEffect(()=>{
    if(!fbUser)return;
    const ref=doc(db,"users",fbUser.uid);
    const unsub=onSnapshot(ref,snap=>{
      if(snap.exists()&&!isSyncing.current){
        const data=snap.data();
        if(data.tasks) setTasks(data.tasks);
        if(data.themeName) setThemeName(data.themeName);
        if(data.layout) setLayout(data.layout as LayoutName);
      }
    });
    return unsub;
  },[fbUser]);

  // Save tasks TO Firestore whenever they change
  useEffect(()=>{
    if(!fbUser)return;
    isSyncing.current=true;
    const ref=doc(db,"users",fbUser.uid);
    setDoc(ref,{tasks,themeName,layout},{merge:true}).finally(()=>{isSyncing.current=false;});
  },[tasks,themeName,layout,fbUser]);

  async function signInWithFirebase(){
    setSignInError(null);
    try{
      await signInWithPopup(auth,googleProvider);
    } catch(e){
      const code=(e as {code?:string})?.code||"unknown";
      // Whatever the reason the popup failed, fall back to a full-page
      // redirect rather than just giving up -- covers browsers like Arc
      // that are inconsistent about popups on mobile in ways that don't
      // always match Firebase's standard "popup blocked" error codes.
      try{ await signInWithRedirect(auth,googleProvider); }
      catch(e2){
        console.error(e,e2);
        const code2=(e2 as {code?:string})?.code||"unknown";
        setSignInError(`Sign-in didn't go through (${code} / ${code2}). Please try again.`);
      }
    }
  }
  async function signOutFirebase(){
    await fbSignOut(auth);
    setFbUser(null);
  }

  const [adding,setAdding]=useState(false);
  const [step,setStep]=useState(0);
  const [newTask,setNewTask]=useState<Partial<Task>>({title:"",subject:"",dueDate:"",estMins:30,notes:""});
  const inputValRef=useRef("");
  const [filter,setFilter]=useState("all");
  const [suggestion,setSuggestion]=useState("");
  const [suggestionLoading,setSuggestionLoading]=useState(false);
  const [activeTab,setActiveTab]=useState("tasks");
  const [looksOpen,setLooksOpen]=useState(false);
  const [activeSubject,setActiveSubject]=useState("all");
  const [pomodoroActive,setPomodoroActive]=useState(false);
  const [pomodoroSecs,setPomodoroSecs]=useState(25*60);
  const [timeHours,setTimeHours]=useState(0);
  const [timeMins,setTimeMins]=useState(30);
  const [timeSecs,setTimeSecs]=useState(0);
  const [showAccountMenu,setShowAccountMenu]=useState(false);
  const [showProfile,setShowProfile]=useState(false);
  const [sessionActive,setSessionActive]=useState(false);
  const [sessionSecs,setSessionSecs]=useState(0);
  const [sessionHistory,setSessionHistory]=useState<{mins:number;date:string}[]>([]);
  const sessionInterval=useRef<any>(null);
  const inputRef=useRef<HTMLInputElement>(null);

  const base=THEMES[themeName];
  const T:ThemeObj={...base,accentGlow:(accentOverride||base.accent)+"44",gradientCard:`linear-gradient(135deg,${base.cardAlt},${base.card})`,accent:(accentOverride||base.accent) as typeof base.accent};

  useEffect(()=>{
    const pending=tasks.filter(t=>!t.done);
    if(pending.length===0){setSuggestion("Nothing left -- you're all done! 🎉");return;}
    setSuggestionLoading(true);setSuggestion("");
    const t=setTimeout(()=>{fetchAISuggestion(tasks).then(s=>{setSuggestion(s);setSuggestionLoading(false);}).catch(()=>{setSuggestion("Start with your most urgent assignment!");setSuggestionLoading(false);});},700);
    return()=>clearTimeout(t);
  },[tasks]);

  // focus input when adding starts
  useEffect(()=>{if(adding){setTimeout(()=>inputRef.current?.focus(),50);}},[adding,step]);

  // Pomodoro timer
  useEffect(()=>{if(!pomodoroActive)return;const t=setInterval(()=>setPomodoroSecs(s=>{if(s<=1){setPomodoroActive(false);return 25*60;}return s-1;}),1000);return()=>clearInterval(t);},[pomodoroActive]);

  const allSorted=[...tasks].sort((a,b)=>{
    if(a.done!==b.done)return a.done?1:-1;
    const o:Record<string,number>={high:0,medium:1,low:2};
    const d=o[getPriority(a.dueDate,a.estMins)]-o[getPriority(b.dueDate,b.estMins)];
    return d!==0?d:(a.dueDate||"").localeCompare(b.dueDate||"");
  });
  const filteredTasks=allSorted.filter(t=>filter==="done"?t.done:filter==="pending"?!t.done:(showDone?true:!t.done));
  const topTask=allSorted.find(t=>!t.done);
  const totalMins=tasks.filter(t=>!t.done).reduce((s,t)=>s+(t.estMins||0),0);

  function startAdding(){
    setAdding(true);setStep(-1);
    setNewTask({title:"",subject:"",dueDate:"",estMins:30,notes:""});
    inputValRef.current="";
    if(inputRef.current) inputRef.current.value="";
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
  function handleDateInput(val:string){
    const q=QUESTIONS[step];const value=val;
    const updated={...newTask,[q.key]:value};setNewTask(updated);
    inputValRef.current="";
    if(inputRef.current) inputRef.current.value="";
    setTimeout(()=>{if(step<QUESTIONS.length-1){setStep(s=>s+1);}else finishTask(updated as Task);},100);
  }
  function skipOptional(){setTimeout(()=>{if(step<QUESTIONS.length-1){setStep(s=>s+1);}else finishTask(newTask as Task);},100);}
  function finishTask(task:Task){setTasks(prev=>[...prev,{...task,id:Date.now(),done:false}]);setAdding(false);setStep(0);}
  function toggleDone(id:number){setTasks(prev=>prev.map(t=>t.id===id?{...t,done:!t.done}:t));}
  function deleteTask(id:number){setTasks(prev=>prev.filter(t=>t.id!==id));}
  const currentQ=step>=0?QUESTIONS[step]:null;

  const F = FONTS[fontName];

  const css=`
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
      .dl-sidebar .app-sidebar .tab-bar{flex-direction:column;background:none!important;padding:0!important;gap:6px!important;}
      .dl-sidebar .app-sidebar .tab-bar button{flex:none!important;justify-content:flex-start!important;text-align:left;padding:10px 12px!important;}
    }
    @media (max-width:600px){
      input,textarea{font-size:16px!important;}
    }
  `;

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
    // Update task's estMins to actual time spent
    setTasks(prev=>prev.map(t=>t.id===selectedTask.id?{...t,estMins:mins}:t));
    setSelectedTask(prev=>prev?{...prev,estMins:mins}:prev);
    setSessionHistory(h=>[...h,{mins,date:new Date().toLocaleTimeString()}]);
    setSessionSecs(0);
  }

  // ─── PROFILE MODAL ────────────────────────────────────────────────────────────
  function ProfileModal() {
    const doneTasks=tasks.filter(t=>t.done).length;
    const totalTasks=tasks.length;
    const highPri=tasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins)==="high").length;
    const pct=totalTasks>0?Math.round(doneTasks/totalTasks*100):0;
    const subjectCounts=SUBJECTS.map(s=>({name:s,count:tasks.filter(t=>t.subject===s).length,color:SUBJECT_COLORS[s]})).filter(s=>s.count>0).sort((a,b)=>b.count-a.count);

    if (!fbUser) return (
      // ── SIGN IN SCREEN (monkeytype-style) ─────────────────────────────────────
      <div style={{position:"fixed",inset:0,background:T.bg,zIndex:1000,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px"}}>
        <button onClick={()=>setShowProfile(false)} style={{position:"absolute",top:20,right:20,background:"none",border:"none",color:T.textFaint,fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>
        {/* Logo */}
        <div style={{marginBottom:40,textAlign:"center"}}>
          <div style={{fontFamily:F.heading,fontSize:42,color:T.accent,lineHeight:1}}>due<span style={{color:T.text}}>.</span></div>
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
          if(navigator.share){navigator.share({title:"due.",url:window.location.href}).catch(()=>{});}
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
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:28}}>
            <div style={{fontFamily:F.heading,fontSize:22,color:T.accent}}>profile</div>
            <button onClick={()=>setShowProfile(false)} style={{background:"none",border:"none",color:T.textFaint,fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>
          </div>

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
            <div style={{display:"flex",alignItems:"center",gap:6,background:"#2ED57322",borderRadius:999,padding:"4px 12px",border:"1px solid #2ED57344"}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:"#2ED573"}}/>
              <span style={{fontFamily:F.body,fontSize:11,color:"#2ED573"}}>Synced across devices</span>
            </div>
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
                {[{l:"Total",v:totalTasks,c:T.text},{l:"Done",v:doneTasks,c:"#2ED573"},{l:"Pending",v:totalTasks-doneTasks,c:T.accent},{l:"Urgent",v:highPri,c:"#FF4757"}].map(s=>(
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
              <div style={{fontFamily:F.heading,fontSize:26,color:"#4ECDC4"}}>{tasks.filter(t=>t.done).reduce((a,b)=>a+(b.estMins||0),0)}m</div>
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
                <span style={{fontFamily:F.heading,fontSize:12,color:T.text}}>{FONTS[fontName].name}</span>
              </div>
            </div>
          </div>

          {/* Add to home screen */}
          <div style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.border}`,marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <div style={{width:36,height:36,borderRadius:10,background:T.accent+"22",border:`1px solid ${T.accent}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2L12 16M12 2L7 7M12 2L17 7" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 16V20C3 21.1 3.9 22 5 22H19C20.1 22 21 21.1 21 20V16" stroke={T.accent} strokeWidth="2" strokeLinecap="round"/></svg>
              </div>
              <div>
                <div style={{fontFamily:F.body,fontSize:13,color:T.text,fontWeight:500}}>Add to Home Screen</div>
                <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:1}}>Access like a native app on iOS</div>
              </div>
            </div>
            <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,lineHeight:1.7,marginBottom:12}}>
              1. Tap the <span style={{color:T.accent}}>Share button</span> <span style={{fontSize:13}}>⎋</span> at the bottom of Safari<br/>
              2. Scroll down and tap <span style={{color:T.accent}}>"Add to Home Screen"</span><br/>
              3. Tap <span style={{color:T.accent}}>"Add"</span> in the top right
            </div>
            <button onClick={()=>{
              if(navigator.share){
                navigator.share({title:"due.",url:window.location.href}).catch(()=>{});
              } else {
                navigator.clipboard?.writeText(window.location.href);
                alert("Link copied! Open Safari on your iPhone and paste the link, then use Share → Add to Home Screen.");
              }
            }} style={{width:"100%",background:T.accent,color:"#000",border:"none",borderRadius:10,padding:"11px",fontFamily:F.body,fontSize:12,cursor:"pointer",fontWeight:500,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2L12 16M12 2L7 7M12 2L17 7" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 16V20C3 21.1 3.9 22 5 22H19C20.1 22 21 21.1 21 20V16" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/></svg>
              Share / Make Bookmark
            </button>
          </div>

          {/* Sign out */}
          <button onClick={async()=>{await signOutFirebase();setShowProfile(false);}}
            style={{width:"100%",background:"none",border:`1px solid #FF475744`,borderRadius:12,padding:"13px",color:"#FF4757",fontFamily:F.body,fontSize:13,cursor:"pointer"}}>
            🚪 Sign out
          </button>
        </div>
      </div>
    );
  }

  // ─── TASK SESSION MODAL ───────────────────────────────────────────────────────
  function TaskModal(){
    if(!selectedTask)return null;
    const task=tasks.find(t=>t.id===selectedTask.id)||selectedTask;
    const pr=getPriority(task.dueDate,task.estMins);
    const sc=SUBJECT_COLORS[task.subject]||T.accent;
    const sm=Math.floor(sessionSecs/60); const ss=sessionSecs%60;
    const totalSessionMins=sessionHistory.reduce((a,b)=>a+b.mins,0);
    return(
      <div style={{position:"fixed",inset:0,background:"#00000088",zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"center",padding:"0 0 0 0"}} onClick={e=>{if(e.target===e.currentTarget&&!sessionActive){setSelectedTask(null);setSessionHistory([]);}}}>
        <div className="pop" style={{background:T.bg,borderRadius:"20px 20px 0 0",width:"100%",maxWidth:580,maxHeight:"90vh",overflowY:"auto",border:`1px solid ${T.border}`,borderBottom:"none"}}>
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
                  <span style={{background:PRIORITY_COLORS[pr]+"22",color:PRIORITY_COLORS[pr],borderRadius:999,padding:"3px 10px",fontFamily:F.body,fontSize:11}}>{pr} priority</span>
                  {task.done&&<span style={{background:"#2ED57322",color:"#2ED573",borderRadius:999,padding:"3px 10px",fontFamily:F.body,fontSize:11}}>✓ done</span>}
                </div>
                <div style={{fontFamily:F.heading,fontSize:22,color:T.text,lineHeight:1.2}}>{task.title}</div>
              </div>
              {!sessionActive&&<button onClick={()=>{setSelectedTask(null);setSessionHistory([]);}} style={{background:"none",border:"none",color:T.textFaint,fontSize:22,cursor:"pointer",padding:"0 0 0 8px",lineHeight:1}}>×</button>}
            </div>

            {/* Info row */}
            <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
              <div style={{background:T.card,borderRadius:10,padding:"8px 14px",border:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:14}}>📅</span>
                <span style={{fontFamily:F.body,fontSize:12,color:T.textMuted}}>{formatDate(task.dueDate)}</span>
              </div>
              <div style={{background:T.card,borderRadius:10,padding:"8px 14px",border:`1px solid ${T.accent}44`,display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:14}}>⏱</span>
                <span style={{fontFamily:F.body,fontSize:12,color:T.accent,fontWeight:500}}>
                  {task.estMins>=60?`${Math.floor(task.estMins/60)}h ${task.estMins%60?`${task.estMins%60}m`:""}`:` ${task.estMins}m`} estimated
                </span>
              </div>
              {totalSessionMins>0&&<div style={{background:"#2ED57322",borderRadius:10,padding:"8px 14px",border:"1px solid #2ED57344",display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:14}}>✅</span>
                <span style={{fontFamily:F.body,fontSize:12,color:"#2ED573"}}>{totalSessionMins}m spent today</span>
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
                  <div style={{fontFamily:F.body,fontSize:11,color:T.textFaint,marginBottom:18}}>keep going! 💪</div>
                  <button onClick={endSession} style={{background:"#FF4757",color:"#fff",border:"none",borderRadius:12,padding:"13px 32px",fontFamily:F.heading,fontSize:17,cursor:"pointer",width:"100%",boxShadow:"0 4px 20px #FF475744"}}>
                    ⏹ End Session
                  </button>
                </>
              ):(
                <>
                  <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginBottom:8,letterSpacing:"0.1em",textTransform:"uppercase"}}>Ready to work?</div>
                  <div style={{fontFamily:F.heading,fontSize:52,color:T.textFaint,lineHeight:1,marginBottom:18}}>00:00</div>
                  <button onClick={startSession} style={{background:T.accent,color:"#000",border:"none",borderRadius:12,padding:"13px 32px",fontFamily:F.heading,fontSize:17,cursor:"pointer",width:"100%",boxShadow:`0 4px 20px ${T.accentGlow}`}}>
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
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <button onClick={()=>{toggleDone(task.id);setSelectedTask(null);setSessionHistory([]);}}
                style={{background:task.done?"#FF475722":"#2ED57322",color:task.done?"#FF4757":"#2ED573",border:`1px solid ${task.done?"#FF475744":"#2ED57344"}`,borderRadius:11,padding:"11px",fontFamily:F.body,fontSize:12,cursor:"pointer"}}>
                {task.done?"↩ Mark undone":"✓ Mark done"}
              </button>
              <button onClick={()=>{deleteTask(task.id);setSelectedTask(null);setSessionHistory([]);}}
                style={{background:"#FF475711",color:"#FF4757",border:"1px solid #FF475733",borderRadius:11,padding:"11px",fontFamily:F.body,fontSize:12,cursor:"pointer"}}>
                🗑 Delete task
              </button>
            </div>

            {/* Notes */}
            {task.notes&&(
              <div style={{marginTop:12,background:T.surface,borderRadius:11,padding:"12px 14px",border:`1px solid ${T.border}`}}>
                <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Notes / Rubric</div>
                <div style={{fontFamily:F.body,fontSize:12,color:T.textMuted,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{task.notes}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── TASK CARD (base) ────────────────────────────────────────────────────────
  function MiniCard({task,rank}:{task:Task;rank:number}) {
    const pr=getPriority(task.dueDate,task.estMins);
    const sc=SUBJECT_COLORS[task.subject]||T.accent;
    const dm=daysUntil(task.dueDate);
    const isTop=rank===0&&!task.done; const isNext=rank===1&&!task.done;
    return(
      <div className="tc" onClick={()=>{setSelectedTask(task);setSessionHistory([]);}} style={{background:isTop?T.gradientCard:T.card,borderRadius:13,padding:"13px 15px",border:`1px solid ${isTop?T.accent+"44":task.done?"transparent":T.border}`,position:"relative",overflow:"hidden",cursor:"pointer"}}>
        {!task.done&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:PRIORITY_COLORS[pr],borderRadius:"13px 0 0 13px"}}/>}
        <div style={{paddingLeft:8,display:"flex",alignItems:"flex-start",gap:9}}>
          <button onClick={e=>{e.stopPropagation();toggleDone(task.id);}} style={{background:task.done?"#2ED573":"none",border:`2px solid ${task.done?"#2ED573":T.textFaint}`,borderRadius:"50%",width:19,height:19,cursor:"pointer",flexShrink:0,marginTop:2,display:"flex",alignItems:"center",justifyContent:"center",padding:0,transition:"all 0.2s"}}>
            {task.done&&<span style={{color:"#111",fontSize:10,fontWeight:"bold"}}>✓</span>}
          </button>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
              {isTop&&<span className="rb" style={{background:T.accent+"33",color:T.accent}}>do first</span>}
              {isNext&&<span className="rb" style={{background:T.text+"11",color:T.textMuted}}>next up</span>}
              <span style={{fontFamily:F.heading,fontSize:15,textDecoration:task.done?"line-through":"none",color:task.done?T.textFaint:T.text}}>{task.title}</span>
              <span style={{background:sc+"22",color:sc,borderRadius:999,padding:"2px 8px",fontFamily:F.body,fontSize:10}}>{task.subject}</span>
            </div>
            <div style={{display:"flex",gap:12,marginTop:4,flexWrap:"wrap"}}>
              <span style={{fontFamily:F.body,fontSize:11,color:T.textMuted}}>📅 {formatDate(task.dueDate)}</span>
              <span style={{fontFamily:F.body,fontSize:11,color:T.textMuted}}>⏱ {task.estMins>=60?`${Math.floor(task.estMins/60)}h${task.estMins%60?` ${task.estMins%60}m`:""}`:` ${task.estMins}m`}</span>
              {!task.done&&dm&&<span style={{fontFamily:F.body,fontSize:11,color:pr==="high"?"#FF4757":pr==="medium"?"#FFA502":"#2ED573",fontWeight:500}}>{dm}</span>}
            </div>
            {task.notes&&<div style={{fontFamily:F.body,fontSize:11,color:T.textFaint,marginTop:3,fontStyle:"italic",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"100%"}}>{task.notes.slice(0,60)}{task.notes.length>60?"...":""}</div>}
          </div>
          <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:15,padding:"2px 5px",lineHeight:1}} onClick={e=>{e.stopPropagation();deleteTask(task.id);}}>×</button>
        </div>
      </div>
    );
  }

  // ─── LAYOUT RENDERERS ─────────────────────────────────────────────────────────
  function renderTasks(tasks:Task[]) {
    const pending=allSorted.filter(t=>!t.done);

    if (layout==="minimal") return (
      <div style={{display:"flex",flexDirection:"column",gap:2}}>
        {tasks.map(t=>{const pr=getPriority(t.dueDate,t.estMins);const sc=SUBJECT_COLORS[t.subject]||T.accent;return(
          <div key={t.id} className="tc" style={{display:"flex",alignItems:"center",gap:10,padding:"8px 4px",borderBottom:`1px solid ${T.border}22`}}>
            <button onClick={()=>toggleDone(t.id)} style={{background:t.done?"#2ED573":"none",border:`1.5px solid ${t.done?"#2ED573":T.textFaint}`,borderRadius:"50%",width:15,height:15,cursor:"pointer",flexShrink:0,padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
              {t.done&&<span style={{color:"#111",fontSize:8,fontWeight:"bold"}}>✓</span>}
            </button>
            <div style={{width:6,height:6,borderRadius:"50%",background:PRIORITY_COLORS[pr],flexShrink:0}}/>
            <span style={{fontFamily:F.body,fontSize:13,flex:1,textDecoration:t.done?"line-through":"none",color:t.done?T.textFaint:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</span>
            <span style={{color:sc,fontFamily:F.body,fontSize:10,flexShrink:0}}>{t.subject}</span>
            <span style={{fontFamily:F.body,fontSize:10,color:T.textFaint,flexShrink:0}}>{daysUntil(t.dueDate)}</span>
            <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13,lineHeight:1,padding:"0 3px"}} onClick={()=>deleteTask(t.id)}>×</button>
          </div>
        );})}
      </div>
    );

    if (layout==="checklist") return (
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {tasks.map((t,i)=>{const pr=getPriority(t.dueDate,t.estMins);return(
          <div key={t.id} className="tc" style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",background:T.card,borderRadius:10,border:`1px solid ${T.border}`}}>
            <span style={{fontFamily:F.body,fontSize:11,color:T.textFaint,minWidth:18}}>{String(i+1).padStart(2,"0")}</span>
            <button onClick={()=>toggleDone(t.id)} style={{width:20,height:20,border:`2px solid ${t.done?T.accent:T.textFaint}`,borderRadius:4,background:t.done?T.accent:"none",cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",padding:0,transition:"all 0.2s"}}>
              {t.done&&<span style={{color:"#111",fontSize:11,fontWeight:"bold"}}>✓</span>}
            </button>
            <span style={{fontFamily:F.body,fontSize:13,flex:1,textDecoration:t.done?"line-through":"none",color:t.done?T.textFaint:T.text}}>{t.title}</span>
            <span style={{fontFamily:F.body,fontSize:10,color:pr==="high"?"#FF4757":pr==="medium"?"#FFA502":"#2ED573"}}>{daysUntil(t.dueDate)}</span>
            <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:14,lineHeight:1}} onClick={()=>deleteTask(t.id)}>×</button>
          </div>
        );})}
      </div>
    );

    if (layout==="compact") return (
      <div style={{display:"flex",flexDirection:"column",gap:5}}>
        {tasks.map(t=>{const pr=getPriority(t.dueDate,t.estMins);const sc=SUBJECT_COLORS[t.subject]||T.accent;const dm=daysUntil(t.dueDate);return(
          <div key={t.id} className="tc" style={{background:T.card,borderRadius:9,padding:"8px 11px",border:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:8,position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",left:0,top:0,bottom:0,width:2.5,background:PRIORITY_COLORS[pr]}}/>
            <button onClick={()=>toggleDone(t.id)} style={{background:t.done?"#2ED573":"none",border:`2px solid ${t.done?"#2ED573":T.textFaint}`,borderRadius:"50%",width:15,height:15,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
              {t.done&&<span style={{color:"#111",fontSize:8,fontWeight:"bold"}}>✓</span>}
            </button>
            <span style={{fontFamily:F.body,fontSize:13,textDecoration:t.done?"line-through":"none",color:t.done?T.textFaint:T.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</span>
            <span style={{color:sc,fontFamily:F.body,fontSize:10,flexShrink:0}}>{t.subject}</span>
            {dm&&!t.done&&<span style={{fontFamily:F.body,fontSize:10,color:pr==="high"?"#FF4757":pr==="medium"?"#FFA502":"#2ED573",flexShrink:0}}>{dm}</span>}
            <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13,lineHeight:1}} onClick={()=>deleteTask(t.id)}>×</button>
          </div>
        );})}
      </div>
    );

    if (layout==="board") return (
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(165px,1fr))",gap:10}}>
        {tasks.map(t=>{const pr=getPriority(t.dueDate,t.estMins);const sc=SUBJECT_COLORS[t.subject]||T.accent;return(
          <div key={t.id} className="tc" style={{background:T.card,borderRadius:12,padding:"13px",border:`1px solid ${T.border}`,position:"relative",overflow:"hidden",display:"flex",flexDirection:"column",gap:7}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:PRIORITY_COLORS[pr],borderRadius:"12px 12px 0 0"}}/>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{background:sc+"22",color:sc,borderRadius:999,padding:"2px 8px",fontFamily:F.body,fontSize:10}}>{t.subject}</span>
              <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13,lineHeight:1}} onClick={()=>deleteTask(t.id)}>×</button>
            </div>
            <div style={{fontFamily:F.heading,fontSize:14,color:t.done?T.textFaint:T.text,textDecoration:t.done?"line-through":"none",lineHeight:1.3}}>{t.title}</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:"auto"}}>
              <span style={{fontFamily:F.body,fontSize:10,color:T.textMuted}}>⏱ {t.estMins}m</span>
              <button onClick={()=>toggleDone(t.id)} style={{background:t.done?"#2ED573":"none",border:`2px solid ${t.done?"#2ED573":T.textFaint}`,borderRadius:"50%",width:17,height:17,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
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
          const sc=SUBJECT_COLORS[t.subject]||T.accent;
          const rotations=[-2,-1,0,1,2]; const rot=rotations[i%rotations.length];
          const stickyColors=["#fef08a","#bfdbfe","#bbf7d0","#fed7aa","#f5d0fe","#fecdd3"];
          const bg=stickyColors[i%stickyColors.length];
          return(
            <div key={t.id} className="sticky-note" style={{background:bg,borderRadius:3,padding:"14px 12px",transform:`rotate(${rot}deg)`,boxShadow:"2px 3px 10px #00000033",minHeight:120,display:"flex",flexDirection:"column",gap:6,opacity:t.done?0.5:1}}>
              <div style={{fontFamily:F.heading,fontSize:14,color:"#1a1a1a",textDecoration:t.done?"line-through":"none",lineHeight:1.3,flex:1}}>{t.title}</div>
              <div style={{fontFamily:F.body,fontSize:10,color:"#555"}}>{t.subject} · {daysUntil(t.dueDate)||"no date"}</div>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <button onClick={()=>toggleDone(t.id)} style={{background:t.done?"#22c55e":"#ffffff88",border:"1.5px solid #33333333",borderRadius:4,padding:"2px 7px",cursor:"pointer",fontFamily:F.body,fontSize:10,color:"#333"}}>{t.done?"✓ done":"mark done"}</button>
                <button style={{background:"none",border:"none",color:"#666",cursor:"pointer",fontSize:14}} onClick={()=>deleteTask(t.id)}>×</button>
              </div>
            </div>
          );
        })}
      </div>
    );

    if (layout==="kanban") {
      const cols=[{key:"high",label:"🔴 Urgent",tasks:filteredTasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins)==="high")},{key:"medium",label:"🟡 Soon",tasks:filteredTasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins)==="medium")},{key:"low",label:"🟢 Later",tasks:filteredTasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins)==="low")},{key:"done",label:"✅ Done",tasks:filteredTasks.filter(t=>t.done)}];
      return(
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10}}>
          {cols.map(col=>(
            <div key={col.key} style={{background:T.surface,borderRadius:12,padding:"12px",border:`1px solid ${T.border}`}}>
              <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginBottom:10,fontWeight:500}}>{col.label} ({col.tasks.length})</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {col.tasks.map(t=>(
                  <div key={t.id} className="tc" style={{background:T.card,borderRadius:8,padding:"9px 10px",border:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:7}}>
                    <button onClick={()=>toggleDone(t.id)} style={{background:t.done?"#2ED573":"none",border:`1.5px solid ${t.done?"#2ED573":T.textFaint}`,borderRadius:"50%",width:14,height:14,cursor:"pointer",flexShrink:0,padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {t.done&&<span style={{color:"#111",fontSize:8}}>✓</span>}
                    </button>
                    <span style={{fontFamily:F.body,fontSize:12,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:t.done?T.textFaint:T.text,textDecoration:t.done?"line-through":"none"}}>{t.title}</span>
                    <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:12,lineHeight:1}} onClick={()=>deleteTask(t.id)}>×</button>
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
        {tasks.map((t,i)=>{const pr=getPriority(t.dueDate,t.estMins);const sc=SUBJECT_COLORS[t.subject]||T.accent;return(
          <div key={t.id} className="tc" style={{position:"relative",marginBottom:14}}>
            <div style={{position:"absolute",left:-19,top:14,width:12,height:12,borderRadius:"50%",background:t.done?"#2ED573":PRIORITY_COLORS[pr],border:`2px solid ${T.bg}`,cursor:"pointer"}} onClick={()=>toggleDone(t.id)}/>
            <div style={{background:T.card,borderRadius:11,padding:"11px 13px",border:`1px solid ${T.border}`,marginLeft:6}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                <span style={{fontFamily:F.heading,fontSize:14,color:t.done?T.textFaint:T.text,textDecoration:t.done?"line-through":"none",flex:1}}>{t.title}</span>
                <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13,lineHeight:1,flexShrink:0}} onClick={()=>deleteTask(t.id)}>×</button>
              </div>
              <div style={{display:"flex",gap:10,marginTop:4,flexWrap:"wrap"}}>
                <span style={{background:sc+"22",color:sc,borderRadius:999,padding:"1px 7px",fontFamily:F.body,fontSize:10}}>{t.subject}</span>
                <span style={{fontFamily:F.body,fontSize:10,color:T.textMuted}}>📅 {formatDate(t.dueDate)}</span>
                <span style={{fontFamily:F.body,fontSize:10,color:pr==="high"?"#FF4757":pr==="medium"?"#FFA502":"#2ED573"}}>{daysUntil(t.dueDate)}</span>
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
                style={{background:activeSubject===s?(SUBJECT_COLORS[s]||T.accent)+"33":"none",color:activeSubject===s?(SUBJECT_COLORS[s]||T.accent):T.textMuted,border:`1.5px solid ${activeSubject===s?(SUBJECT_COLORS[s]||T.accent):T.border}`}}>
                {s==="all"?"All 📚":s}
              </button>
            ))}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:9}}>
            {shown.map(t=><MiniCard key={t.id} task={t} rank={pending.indexOf(t)}/>)}
          </div>
        </div>
      );
    }

    if (layout==="progress") return (
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {tasks.map(t=>{
          const pr=getPriority(t.dueDate,t.estMins);const sc=SUBJECT_COLORS[t.subject]||T.accent;
          const maxMins=120; const pct=Math.min(100,Math.round(t.estMins/maxMins*100));
          return(
            <div key={t.id} className="tc" style={{background:T.card,borderRadius:12,padding:"13px 15px",border:`1px solid ${T.border}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <button onClick={()=>toggleDone(t.id)} style={{background:t.done?"#2ED573":"none",border:`2px solid ${t.done?"#2ED573":T.textFaint}`,borderRadius:"50%",width:18,height:18,cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {t.done&&<span style={{color:"#111",fontSize:9,fontWeight:"bold"}}>✓</span>}
                  </button>
                  <span style={{fontFamily:F.heading,fontSize:14,color:t.done?T.textFaint:T.text,textDecoration:t.done?"line-through":"none"}}>{t.title}</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{background:sc+"22",color:sc,borderRadius:999,padding:"1px 7px",fontFamily:F.body,fontSize:10}}>{t.subject}</span>
                  <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13,lineHeight:1}} onClick={()=>deleteTask(t.id)}>×</button>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{flex:1,height:7,background:T.border,borderRadius:999}}>
                  <div style={{width:t.done?"100%":`${pct}%`,height:"100%",background:t.done?"#2ED573":PRIORITY_COLORS[pr],borderRadius:999,transition:"width 0.5s"}}/>
                </div>
                <span style={{fontFamily:F.body,fontSize:10,color:T.textMuted,flexShrink:0}}>{t.estMins}m</span>
                <span style={{fontFamily:F.body,fontSize:10,color:pr==="high"?"#FF4757":pr==="medium"?"#FFA502":"#2ED573",flexShrink:0}}>{daysUntil(t.dueDate)}</span>
              </div>
            </div>
          );
        })}
      </div>
    );

    if (layout==="pyramid") {
      const highT=tasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins)==="high");
      const medT=tasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins)==="medium");
      const lowT=tasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins)==="low");
      const doneT=tasks.filter(t=>t.done);
      return(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {[{tasks:highT,color:"#FF4757",label:"🔴 High Priority",w:"100%"},{tasks:medT,color:"#FFA502",label:"🟡 Medium Priority",w:"85%"},{tasks:lowT,color:"#2ED573",label:"🟢 Low Priority",w:"65%"},{tasks:doneT,color:T.textFaint,label:"✅ Done",w:"45%"}].map(tier=>(
            tier.tasks.length>0&&(
              <div key={tier.label} style={{margin:"0 auto",width:tier.w}}>
                <div style={{fontFamily:F.body,fontSize:10,color:tier.color,marginBottom:5,textAlign:"center"}}>{tier.label}</div>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {tier.tasks.map(t=>(
                    <div key={t.id} className="tc" style={{background:T.card,borderRadius:9,padding:"9px 12px",border:`1px solid ${tier.color}44`,display:"flex",alignItems:"center",gap:8}}>
                      <button onClick={()=>toggleDone(t.id)} style={{background:t.done?"#2ED573":"none",border:`1.5px solid ${t.done?"#2ED573":T.textFaint}`,borderRadius:"50%",width:15,height:15,cursor:"pointer",flexShrink:0,padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {t.done&&<span style={{color:"#111",fontSize:8}}>✓</span>}
                      </button>
                      <span style={{fontFamily:F.body,fontSize:12,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:t.done?T.textFaint:T.text}}>{t.title}</span>
                      <span style={{fontFamily:F.body,fontSize:10,color:T.textMuted,flexShrink:0}}>{t.subject}</span>
                      <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13}} onClick={()=>deleteTask(t.id)}>×</button>
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
      for(let i=0;i<7;i++){const d=new Date();d.setDate(d.getDate()+i);week.push(d.toISOString().split("T")[0]);}
      const noDate=tasks.filter(t=>!t.dueDate);
      return(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {week.map(day=>{
            const dayTasks=tasks.filter(t=>t.dueDate===day);
            if(dayTasks.length===0)return null;
            const isToday=day===new Date().toISOString().split("T")[0];
            return(
              <div key={day} style={{background:T.card,borderRadius:12,padding:"12px 14px",border:`1px solid ${isToday?T.accent+"66":T.border}`}}>
                <div style={{fontFamily:F.body,fontSize:11,color:isToday?T.accent:T.textMuted,marginBottom:8,fontWeight:isToday?"500":"normal"}}>
                  {isToday?"📌 Today":formatDate(day)}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {dayTasks.map(t=>{const sc=SUBJECT_COLORS[t.subject]||T.accent;const pr=getPriority(t.dueDate,t.estMins);return(
                    <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:`1px solid ${T.border}33`}}>
                      <button onClick={()=>toggleDone(t.id)} style={{background:t.done?"#2ED573":"none",border:`1.5px solid ${t.done?"#2ED573":T.textFaint}`,borderRadius:3,width:15,height:15,cursor:"pointer",flexShrink:0,padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {t.done&&<span style={{color:"#111",fontSize:9,fontWeight:"bold"}}>✓</span>}
                      </button>
                      <span style={{fontFamily:F.body,fontSize:12,flex:1,textDecoration:t.done?"line-through":"none",color:t.done?T.textFaint:T.text}}>{t.title}</span>
                      <span style={{color:sc,fontFamily:F.body,fontSize:10}}>{t.subject}</span>
                      <span style={{fontFamily:F.body,fontSize:10,color:T.textMuted}}>⏱{t.estMins}m</span>
                      <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13}} onClick={()=>deleteTask(t.id)}>×</button>
                    </div>
                  );})}
                </div>
              </div>
            );
          })}
          {noDate.length>0&&(
            <div style={{background:T.card,borderRadius:12,padding:"12px 14px",border:`1px solid ${T.border}`}}>
              <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginBottom:8}}>📋 No date</div>
              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                {noDate.map(t=>(
                  <div key={t.id} style={{display:"flex",alignItems:"center",gap:8}}>
                    <button onClick={()=>toggleDone(t.id)} style={{background:t.done?"#2ED573":"none",border:`1.5px solid ${t.done?"#2ED573":T.textFaint}`,borderRadius:3,width:15,height:15,cursor:"pointer",flexShrink:0,padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {t.done&&<span style={{color:"#111",fontSize:9}}>✓</span>}
                    </button>
                    <span style={{fontFamily:F.body,fontSize:12,flex:1,color:t.done?T.textFaint:T.text}}>{t.title}</span>
                    <button style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13}} onClick={()=>deleteTask(t.id)}>×</button>
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
        if (groupBy==="priority") return getPriority(t.dueDate,t.estMins);
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
        if (groupBy==="priority") return k==="high"?"🔴 High priority":k==="medium"?"🟡 Medium priority":"🟢 Low priority";
        if (groupBy==="dueDate") return k==="No date"?k:formatDate(k);
        return k; // subject
      };
      return <div style={{display:"flex",flexDirection:"column",gap:16}}>
        {order.map(k=>(
          <div key={k}>
            <div className="sl" style={{color:T.textMuted,paddingTop:0}}>{labelFor(k)} ({groups.get(k)!.length})</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {groups.get(k)!.map(t=><MiniCard key={t.id} task={t} rank={pending.indexOf(t)}/>)}
            </div>
          </div>
        ))}
      </div>;
    }
    return <div style={{display:"flex",flexDirection:"column",gap:10}}>{tasks.map(t=><MiniCard key={t.id} task={t} rank={pending.indexOf(t)}/>)}</div>;
  }

  function Toggle({on,onChange}:{on:boolean;onChange:(v:boolean)=>void}){
    return <button className="tog" onClick={()=>onChange(!on)} style={{background:on?T.accent:T.border}}>
      <span style={{position:"absolute",top:3,left:on?21:3,width:14,height:14,borderRadius:"50%",background:"#fff",transition:"left 0.2s",display:"block"}}/>
    </button>;
  }

  const pomMin=Math.floor(pomodoroSecs/60); const pomSec=pomodoroSecs%60;
  const pomPct=pomodoroSecs/(25*60);

  // Sync outer page background to theme
  useEffect(()=>{
    document.body.style.background=T.bg;
    document.body.style.transition="background 0.4s";
    return()=>{ document.body.style.background=""; };
  },[T.accent]);

  return (
    <div className={"app-shell dl-"+desktopLayout} style={{background:T.bg,fontFamily:F.body,color:T.text,transition:"background 0.3s,color 0.3s"}}>
      <style>{css}</style>
      <div className="app-inner">

        {/* Header */}
        <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:5}}>
          <div>
            <div style={{fontFamily:F.heading,fontSize:28,lineHeight:1,color:T.accent}}>due<span style={{color:T.text}}>. </span></div>
            <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint,marginTop:2}}>by due. studios</div>
          </div>
          {/* Profile button - always visible */}
          {!fbLoading&&(
            <button onClick={()=>setShowProfile(true)} aria-label="Profile" style={{display:"flex",alignItems:"center",justifyContent:"center",background:"none",border:`1px solid ${T.border}`,borderRadius:"50%",width:32,height:32,padding:0,cursor:"pointer",transition:"all 0.15s",flexShrink:0}}>
              {fbUser?.photoURL
                ? <img src={fbUser.photoURL} alt="" style={{width:28,height:28,borderRadius:"50%",objectFit:"cover"}}/>
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill={T.textMuted}/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round"/></svg>
              }
            </button>
          )}
          <div style={{textAlign:"right"}}>
            <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint}}>time left</div>
            <div style={{fontFamily:F.heading,fontSize:20,color:"#4ECDC4"}}>{totalMins>=60?`${Math.floor(totalMins/60)}h ${totalMins%60}m`:`${totalMins}m`}</div>
          </div>
        </div>
        <div style={{height:1,background:`linear-gradient(90deg,${T.accent},transparent)`,marginBottom:16}}/>

        <div className="app-body">
        <div className="app-sidebar">
        {/* Tabs */}
        <div className="tab-bar" style={{display:"flex",gap:4,marginBottom:16,background:T.surface,borderRadius:11,padding:3}}>
          {(["tasks","tools","options"] as const).map(id=>{
            const labels:Record<string,string>={tasks:"📋 Tasks",tools:"🛠️ Tools",options:"⚙️ Settings"};
            return <button key={id} onClick={()=>setActiveTab(id)} style={{flex:1,background:activeTab===id?T.card:"transparent",color:activeTab===id?T.text:T.textMuted,fontFamily:F.body,fontSize:11,border:"none",borderRadius:9,padding:"7px 6px",cursor:"pointer",transition:"all 0.15s",fontWeight:activeTab===id?"500":"normal",position:"relative"}}>
              {labels[id]}
            </button>;
          })}
        </div>
        </div>
        <div className="app-main">

        {/* TASKS TAB */}
        {activeTab==="tasks"&&<>
          {/* AI Suggestion */}
          {showSuggestion?(
            <div style={{background:T.gradientCard,borderRadius:12,padding:"10px 12px",marginBottom:16,border:`1px solid ${T.accent}33`,position:"relative",overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:7,minWidth:0}}>
                  <span style={{fontSize:12,marginTop:1}}>✨</span>
                  {suggestionLoading?(<div className="shim" style={{height:11,width:140,marginTop:2}}/>):(<span style={{fontFamily:F.body,fontSize:12,color:T.text,lineHeight:1.4,whiteSpace:"pre-line"}}>{suggestion}</span>)}
                </div>
                <button onClick={()=>setShowSuggestion(false)} style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:16,lineHeight:1,padding:"0 2px",flexShrink:0}}>×</button>
              </div>
            </div>
          ):(
            <button onClick={()=>setShowSuggestion(true)} style={{position:"fixed",bottom:20,right:16,width:40,height:40,borderRadius:"50%",background:T.card,border:`1px solid ${T.accent}55`,boxShadow:`0 2px 10px ${T.accent}33`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,zIndex:50}} title="Show smart suggestion">
              ✨
            </button>
          )}

          {/* Filters + layout picker */}
          <div style={{display:"flex",gap:6,marginBottom:12,alignItems:"center"}}>
            {["all","pending","done"].map(f=><button key={f} onClick={()=>setFilter(f)} style={{background:filter===f?T.accent:"none",color:filter===f?"#000":T.textMuted,border:`1px solid ${filter===f?T.accent:T.border}`,borderRadius:999,padding:"4px 12px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>{f}</button>)}
            <div style={{marginLeft:"auto",fontFamily:F.body,fontSize:10,color:T.textFaint}}>{tasks.filter(t=>!t.done).length} pending</div>
          </div>

          {renderTasks(filteredTasks)}
          {filteredTasks.length===0&&<div style={{textAlign:"center",color:T.textFaint,fontFamily:F.body,fontSize:12,padding:"32px 0"}}>nothing here yet ✨</div>}
          <div style={{marginTop:14}}>
            {!adding?(
              <div style={{display:"flex",justifyContent:"center",paddingTop:10}}>
                <button onClick={startAdding} style={{background:T.accent,color:"#000",border:"none",borderRadius:14,padding:"13px 28px",fontFamily:F.heading,fontSize:17,cursor:"pointer",boxShadow:`0 4px 20px ${T.accentGlow}`,transition:"all 0.2s"}}>+ add homework</button>
              </div>
            ):(
              <div style={{background:T.card,borderRadius:16,padding:"18px",border:`1px solid ${T.borderAccent}`}}>
                <div style={{display:"flex",gap:5,marginBottom:14,justifyContent:"center"}}>
                  {[...Array(QUESTIONS.length+1)].map((_,i)=><div key={i} style={{width:i===step+1?20:6,height:6,borderRadius:999,background:i<=step+1?T.accent:T.border,transition:"all 0.3s"}}/>)}
                </div>
                <div>
                  {step===-1?(
                    <div>
                      <div style={{fontFamily:F.heading,fontSize:17,marginBottom:12,color:T.accent}}>What's the assignment? 🎒</div>
                      <form onSubmit={handleTitleSubmit} style={{display:"flex",gap:8}}>
                        <input ref={inputRef} defaultValue="" placeholder="e.g. Chapter 3 reading..." autoFocus style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,color:T.text,padding:"10px 13px",fontFamily:F.body,fontSize:13,flex:1,outline:"none"}}/>
                        <button type="submit" style={{background:T.accent,color:"#000",border:"none",borderRadius:10,padding:"10px 16px",cursor:"pointer"}}>→</button>
                      </form>
                    </div>
                  ):currentQ?(
                    <div>
                      <div style={{fontFamily:F.heading,fontSize:17,marginBottom:12,color:T.accent}}>{currentQ.label}</div>
                      {currentQ.type==="select"&&<div style={{display:"flex",flexWrap:"wrap",gap:7}}>{currentQ.options!.map(opt=><button key={opt} className="chip" style={{background:SUBJECT_COLORS[opt]?SUBJECT_COLORS[opt]+"22":T.cardAlt,color:SUBJECT_COLORS[opt]||T.text,border:`1px solid ${SUBJECT_COLORS[opt]||T.border}`}} onClick={()=>handleAnswer(opt)}>{opt}</button>)}{currentQ.optional&&<button className="chip" style={{background:"none",color:T.textFaint,border:`1px dashed ${T.border}`}} onClick={skipOptional}>skip</button>}</div>}
                      {currentQ.type==="date"&&<div style={{display:"flex",gap:7,flexWrap:"wrap"}}>{[{l:"Today",d:0},{l:"Tomorrow",d:1},{l:"3 days",d:3},{l:"Next week",d:7}].map(({l,d})=>{const dt=new Date();dt.setDate(dt.getDate()+d);return<button key={l} className="chip" style={{background:T.cardAlt,color:T.text,border:`1px solid ${T.border}`}} onClick={()=>handleAnswer(dt.toISOString().split("T")[0])}>{l}</button>;})} <input ref={inputRef} type="date" defaultValue="" onChange={e=>{inputValRef.current=e.target.value;}} onKeyDown={e=>e.key==="Enter"&&inputRef.current?.value&&handleDateInput(inputRef.current.value)} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,color:T.text,padding:"7px 11px",fontFamily:F.body,fontSize:12,flex:1,minWidth:120,outline:"none"}}/><button style={{background:T.accent,color:"#000",border:"none",borderRadius:10,padding:"7px 13px",cursor:"pointer"}} onClick={()=>inputRef.current?.value&&handleDateInput(inputRef.current.value)}>→</button></div>}
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
                                style={{background:T.accent,color:"#000",border:"none",borderRadius:9,padding:"8px 18px",fontFamily:F.body,fontSize:12,cursor:"pointer",fontWeight:500}}>
                                Set time →
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                      {currentQ.type==="text"&&(
                        <div style={{display:"flex",flexDirection:"column",gap:10}}>
                          <textarea
                            ref={inputRef as any}
                            defaultValue=""
                            placeholder="Paste your rubric, instructions, or assignment details here... we'll estimate how long it'll take! (or skip)"
                            rows={5}
                            style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,color:T.text,padding:"11px 13px",fontFamily:F.body,fontSize:12,width:"100%",outline:"none",resize:"vertical",lineHeight:1.5}}
                          />
                          <div style={{display:"flex",gap:8}}>
                            <button onClick={()=>{
                              const rubric=(inputRef.current as any)?.value||"";
                              if(!rubric.trim()){finishTask({...newTask,notes:""} as Task);return;}
                              // Local word-count heuristic -- this used to call api.anthropic.com
                              // directly from the browser with no auth header, so it always failed
                              // and silently fell back anyway. This estimates from the text itself,
                              // no network call needed, and never fails.
                              const words=rubric.trim().split(/\s+/).length;
                              const keywordBonus=/essay|research|report|paper/i.test(rubric)?20:0;
                              const estMins=Math.max(10,Math.min(180,Math.round(words/12)*5+keywordBonus));
                              finishTask({...newTask,estMins,notes:rubric} as Task);
                            }} id="rubric-btn"
                              style={{background:T.accent,color:"#000",border:"none",borderRadius:10,padding:"10px 16px",fontFamily:F.body,fontSize:12,cursor:"pointer",fontWeight:500,flex:1}}>
                              ✨ Estimate time from text
                            </button>
                            <button className="chip" style={{background:"none",color:T.textFaint,border:`1px dashed ${T.border}`}} onClick={()=>finishTask({...newTask,notes:(inputRef.current as any)?.value||""} as Task)}>skip</button>
                          </div>
                          <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,textAlign:"center"}}>Estimates time from your rubric's length -- paste it in or skip</div>
                        </div>
                      )}
                    </div>
                  ):null}
                  {newTask.title&&<div style={{marginTop:12,padding:"9px 13px",background:T.bg,borderRadius:10,border:`1px solid ${T.border}`}}>
                    <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint,marginBottom:2}}>adding</div>
                    <div style={{fontFamily:F.heading,fontSize:14,color:T.text}}>{newTask.title}</div>
                    <div style={{display:"flex",gap:8,marginTop:3,flexWrap:"wrap"}}>
                      {newTask.subject&&<span style={{color:SUBJECT_COLORS[newTask.subject]||T.accent,fontFamily:F.body,fontSize:10}}>{newTask.subject}</span>}
                      {newTask.dueDate&&<span style={{color:T.textMuted,fontFamily:F.body,fontSize:10}}>📅 {formatDate(newTask.dueDate)}</span>}
                    </div>
                  </div>}
                </div>
                <button onClick={()=>setAdding(false)} style={{background:"none",border:"none",color:T.textFaint,fontFamily:F.body,fontSize:11,cursor:"pointer",marginTop:12}}>cancel</button>
              </div>
            )}
          </div>
        </>}

        {/* TOOLS TAB */}
        {activeTab==="tools"&&(
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {/* Pomodoro */}
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
                <button onClick={()=>setPomodoroActive(a=>!a)} style={{background:T.accent,color:"#000",border:"none",borderRadius:9,padding:"8px 18px",fontFamily:F.body,fontSize:12,cursor:"pointer"}}>{pomodoroActive?"⏸ Pause":"▶ Start"}</button>
                <button onClick={()=>{setPomodoroSecs(25*60);setPomodoroActive(false);}} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:9,padding:"8px 14px",color:T.textMuted,fontFamily:F.body,fontSize:12,cursor:"pointer"}}>↺ Reset</button>
              </div>
            </div>
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
                  <div style={{fontFamily:F.body,fontSize:11,color:T.textFaint,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fbUser?fbUser.email:"Tap to sign in & sync"}</div>
                </div>
                <span style={{color:T.textFaint,fontSize:16,flexShrink:0}}>›</span>
              </button>
            )}
            {/* Looks */}
            <div style={{background:T.card,borderRadius:12,padding:"16px",border:`1px solid ${T.border}`}}>
              <button onClick={()=>setLooksOpen(o=>!o)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",background:"none",border:"none",cursor:"pointer",padding:0,outline:"none",WebkitTapHighlightColor:"transparent"}}>
                <span style={{color:T.textMuted,fontFamily:"'DM Mono',monospace",fontSize:10,letterSpacing:".08em",textTransform:"uppercase"}}>🎨 Looks</span>
                <span style={{color:T.textMuted,fontSize:13,transform:looksOpen?"rotate(0deg)":"rotate(-90deg)",transition:"transform 0.15s",display:"inline-block"}}>⌄</span>
              </button>
              {looksOpen&&<div style={{display:"flex",flexDirection:"column",gap:20,marginTop:16}}>
              {/* Theme */}
              <div>
                <div className="sl" style={{color:T.textMuted,paddingTop:0}}>Theme ({Object.keys(THEMES).length})</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7}}>
                  {(Object.entries(THEMES) as [ThemeName,typeof THEMES[ThemeName]][]).map(([key,th])=>(
                    <button key={key} onClick={()=>{setThemeName(key);setAccentOverride(null);}}
                      style={{background:th.card,border:`2px solid ${themeName===key&&!accentOverride?th.accent:th.border}`,borderRadius:12,padding:"11px 6px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:4,transition:"all 0.15s",transform:themeName===key&&!accentOverride?"scale(1.06)":"none"}}>
                      <span style={{fontSize:16}}>{th.emoji}</span>
                      <span style={{fontFamily:F.body,fontSize:9,color:th.text}}>{th.name}</span>
                      <div style={{width:20,height:4,borderRadius:999,background:th.accent}}/>
                    </button>
                  ))}
                </div>
              </div>
              {/* Accent */}
              <div>
                <div className="sl" style={{color:T.textMuted,paddingTop:0}}>Custom Accent</div>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <input type="color" value={accentOverride||T.accent} onChange={e=>setAccentOverride(e.target.value)} style={{width:44,height:36,borderRadius:9,cursor:"pointer",border:`1px solid ${T.border}`}}/>
                  <span style={{fontFamily:F.body,fontSize:11,color:T.textMuted}}>{accentOverride||T.accent}</span>
                  {accentOverride&&<button onClick={()=>setAccentOverride(null)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:7,color:T.textMuted,fontFamily:F.body,fontSize:10,padding:"3px 9px",cursor:"pointer"}}>reset</button>}
                </div>
                <div style={{marginTop:8,display:"flex",gap:7,flexWrap:"wrap"}}>
                  {["#F0A500","#f472b6","#38bdf8","#4ade80","#fb923c","#f87171","#34d399","#a78bfa","#fbbf24","#60a5fa"].map(c=>(
                    <button key={c} onClick={()=>setAccentOverride(c)} style={{width:26,height:26,borderRadius:"50%",background:c,border:`2px solid ${accentOverride===c?"#fff":"transparent"}`,cursor:"pointer"}}/>
                  ))}
                </div>
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
              {/* Fonts */}
              <div>
                <div className="sl" style={{color:T.textMuted,paddingTop:0}}>Font ({Object.keys(FONTS).length})</div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {(Object.entries(FONTS) as [FontName, typeof FONTS[FontName]][]).map(([key,f])=>(
                    <button key={key} onClick={()=>setFontName(key)}
                      style={{background:fontName===key?T.accent+"22":"none",border:`1.5px solid ${fontName===key?T.accent:T.border}`,borderRadius:11,padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",transition:"all 0.14s"}}>
                      <span style={{fontFamily:f.heading,fontSize:18,color:fontName===key?T.accent:T.text}}>{f.preview}</span>
                      <span style={{fontFamily:F.body,fontSize:10,color:fontName===key?T.accent:T.textFaint}}>{f.name}</span>
                    </button>
                  ))}
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
                    <span style={{fontFamily:F.body,fontSize:10,color:T.textMuted}}>📅 Due tomorrow</span>
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
              <Toggle on={showSuggestion} onChange={setShowSuggestion}/>
            </div>
            <div style={{background:T.card,borderRadius:12,padding:"13px 15px",border:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
              <div><div style={{fontFamily:F.body,fontSize:12,color:T.text}}>Show completed tasks</div><div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:1}}>Keep done tasks visible</div></div>
              <Toggle on={showDone} onChange={setShowDone}/>
            </div>
            {/* Stats */}
            <div style={{background:T.card,borderRadius:12,padding:"14px",border:`1px solid ${T.border}`}}>
              <div className="sl" style={{color:T.textMuted}}>Stats</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:9}}>
                {[{label:"Total",val:tasks.length},{label:"Done",val:tasks.filter(t=>t.done).length},{label:"Hours",val:`${(totalMins/60).toFixed(1)}h`}].map(({label,val})=>(
                  <div key={label} style={{background:T.surface,borderRadius:9,padding:"11px 8px",textAlign:"center"}}>
                    <div style={{fontFamily:F.heading,fontSize:20,color:T.accent}}>{val}</div>
                    <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint,marginTop:1}}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={()=>{if(window.confirm("Clear all completed tasks?"))setTasks(prev=>prev.filter(t=>!t.done));}} style={{background:"none",border:`1px solid #FF475744`,borderRadius:9,color:"#FF4757",fontFamily:F.body,fontSize:11,padding:"9px 14px",cursor:"pointer",width:"100%"}}>🗑 Clear completed tasks</button>
          </div>
        )}
        </div>
        </div>
      </div>
      {selectedTask&&<TaskModal/>}
      {showProfile&&<ProfileModal/>}
    </div>
  );
}
