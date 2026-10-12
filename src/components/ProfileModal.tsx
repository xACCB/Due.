import { useState } from "react";
import type { User } from "firebase/auth";
import type { Task } from "../types";
import { priColor } from "../constants";
import { completionStats } from "../lib/taskViews";
import type { ThemeObj } from "../themes";
import { formatDuration, formatAgo, ink } from "../lib/format";
import { LIMITS } from "../lib/limits";
import type { DeviceEntry } from "../lib/devices";
import { FONT } from "../fonts";
import { requestInstall, isStandalone } from "../lib/thisDevice";

// ─── PROFILE MODAL ────────────────────────────────────────────────────────────
// Also module scope (see TaskModal/MiniCard above) -- notably, this fixed a
// real bug on top of the perf/remount concern: the "Add a subject" field used
// to be an uncontrolled ref-based input, and since this component was being
// recreated on every unrelated parent re-render, a background update (a
// Firestore sync landing, etc.) while the user was mid-typing would silently
// wipe out the text. newSubjectText/setNewSubjectText are lifted to the
// parent specifically so they survive that; being hoisted now means this
// component itself is no longer being recreated in the first place either.
export function ProfileModal({T,F,fbUser,authPending,signInError,syncError,syncStatus,visibleTasks,totalMins,subjects,subjectColors,colorCodeUrgency,taskCount,trashCount,notificationsEnabled,notificationNote,onToggleNotifications,devices,onSignOutDevice,onSignOutOtherDevices,now,setShowProfile,signInWithFirebase,signOutFirebase}:{
  T:ThemeObj; F:typeof FONT;
  fbUser:User|null; authPending:boolean; signInError:string|null; syncError:string|null; syncStatus:string|null;
  visibleTasks:Task[]; totalMins:number;
  subjects:string[]; subjectColors:Record<string,string>; colorCodeUrgency:boolean;
  // Housekeeping: how much of the account's room is used (every task, archived
  // ones too, and Recently deleted), and reminders on this device.
  taskCount:number; trashCount:number;
  notificationsEnabled:boolean; notificationNote:string|null; onToggleNotifications:(next:boolean)=>void;
  // The devices signed in to this account (listDevices()), or null while the
  // list isn't available.
  devices:{id:string;entry:DeviceEntry;current:boolean}[]|null; onSignOutDevice:(id:string)=>void; onSignOutOtherDevices:()=>void; now:number;
  setShowProfile:(v:boolean)=>void;
  signInWithFirebase:()=>Promise<void>;
  signOutFirebase:()=>Promise<void>;
}) {
  const {done:doneTasks,total:totalTasks,urgent:highPri,pct}=completionStats(visibleTasks);
  const [installHint,setInstallHint]=useState<string|null>(null);
  const subjectCounts=subjects.map(s=>({name:s,count:visibleTasks.filter(t=>t.subject===s).length,color:subjectColors[s]})).filter(s=>s.count>0).sort((a,b)=>b.count-a.count);

  // Signed in last time, but Firebase hasn't said so yet this load: show the
  // Profile page's own header rather than flashing the sign-in screen.
  if (!fbUser&&authPending) return (
    <div className="sec-body" style={{position:"fixed",inset:0,background:T.bg,zIndex:1000,overflowY:"auto"}}>
      <div style={{maxWidth:560,margin:"0 auto",padding:"20px 16px 40px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div style={{fontFamily:F.heading,fontSize:22,color:T.accent}}>Profile</div>
          <button onClick={()=>setShowProfile(false)} aria-label="Close" className="hit" style={{background:"none",border:"none",color:T.textFaint,fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>
        </div>
        <div role="status" style={{textAlign:"center",fontFamily:F.body,fontSize:12,color:T.textFaint,marginTop:48}}>Loading your profile…</div>
      </div>
    </div>
  );

  if (!fbUser) return (
    // ── SIGN IN SCREEN (monkeytype-style) ─────────────────────────────────────
    <div className="sec-body" style={{position:"fixed",inset:0,background:T.bg,zIndex:1000,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px"}}>
      <button onClick={()=>setShowProfile(false)} aria-label="Close" className="hit" style={{position:"absolute",top:20,right:20,background:"none",border:"none",color:T.textFaint,fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>
      {/* Logo */}
      <div style={{marginBottom:40,textAlign:"center"}}>
        <div style={{fontFamily:F.heading,fontSize:42,color:T.accent,lineHeight:1}}>Due<span style={{color:T.text}}>Planner</span></div>
        <div style={{fontFamily:F.body,fontSize:12,color:T.textFaint,marginTop:6}}>due. studios · sync across devices</div>
      </div>
      {/* Sign in box */}
      <div style={{width:"100%",maxWidth:340}}>
        <button onClick={signInWithFirebase}
          style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:12,background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px 20px",cursor:"pointer",marginBottom:12,transition:"all .2s ease-out"}}>
          {/* Google icon */}
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/></svg>
          <span style={{fontFamily:F.body,fontSize:13,color:T.text}}>Continue with Google</span>
        </button>
        {signInError&&<div style={{textAlign:"center",fontFamily:F.body,fontSize:11,color:ink("#FF4757",T.light),marginBottom:12,lineHeight:1.5}}>{signInError}</div>}
        <div style={{textAlign:"center",fontFamily:F.body,fontSize:11,color:T.textFaint,lineHeight:1.6}}>
          Signing in syncs your homework across your devices. We never sell your data or use it for ads. See the <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{color:T.textMuted}}>privacy policy</a> for the services that help run the app.
        </div>
      </div>
      {/* Add to Home Screen -- the browser's own install prompt where it offers
          one (Chrome/Edge/Android), otherwise platform-specific instructions;
          hidden entirely once the app is already running installed. */}
      {!isStandalone()&&<button onClick={()=>requestInstall(setInstallHint)} style={{width:"100%",maxWidth:340,background:"none",border:`1px solid ${T.border}`,borderRadius:12,padding:"12px",fontFamily:F.body,fontSize:12,color:T.textMuted,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginTop:12}}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 2L12 16M12 2L7 7M12 2L17 7" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 16V20C3 21.1 3.9 22 5 22H19C20.1 22 21 21.1 21 20V16" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round"/></svg>
        Add to Home Screen
      </button>}
      {installHint&&<div style={{maxWidth:340,textAlign:"center",fontFamily:F.body,fontSize:11,color:T.textMuted,marginTop:8,lineHeight:1.5}}>{installHint}</div>}
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
    <div className="sec-body" style={{position:"fixed",inset:0,background:T.bg,zIndex:1000,overflowY:"auto"}}>
      <div style={{maxWidth:560,margin:"0 auto",padding:"20px 16px 40px"}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div style={{fontFamily:F.heading,fontSize:22,color:T.accent}}>Profile</div>
          <button onClick={()=>setShowProfile(false)} aria-label="Close" className="hit" style={{background:"none",border:"none",color:T.textFaint,fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>
        </div>

        {/* Avatar + name */}
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:32}}>
          <div style={{position:"relative",marginBottom:14}}>
            {fbUser.photoURL
              ? <img src={fbUser.photoURL} alt="" style={{width:80,height:80,borderRadius:"50%",objectFit:"cover",display:"block"}}/>
              : <div style={{width:80,height:80,borderRadius:"50%",background:T.surface,border:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill={T.textMuted}/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round"/></svg>
                </div>
            }
          </div>
          <div style={{fontFamily:F.heading,fontSize:24,color:T.text,marginBottom:4}}>{fbUser.displayName||"Your account"}</div>
          <div style={{fontFamily:F.body,fontSize:12,color:T.textFaint,marginBottom:8}}>{fbUser.email}</div>
          <div style={{display:"flex",alignItems:"center",gap:6,background:syncError?"#FF475722":"#2ED57322",borderRadius:999,padding:"4px 12px",border:`1px solid ${syncError?"#FF475744":"#2ED57344"}`}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:syncError?"#FF4757":"#2ED573"}}/>
            <span style={{fontFamily:F.body,fontSize:11,color:ink(syncError?"#FF4757":"#2ED573",T.light)}}>{syncError?"Sync issue":syncStatus||"Synced across devices"}</span>
          </div>
          {syncError&&<div style={{fontFamily:F.body,fontSize:11,color:ink("#FF4757",T.light),marginTop:8,textAlign:"center",maxWidth:280,lineHeight:1.5}}>{syncError}</div>}
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
            <div style={{fontFamily:F.heading,fontSize:13,color:T.textMuted,marginBottom:10}}>Completion</div>
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
            <div style={{fontFamily:F.heading,fontSize:26,color:T.accent}}>{formatDuration(totalMins)||"0m"}</div>
            <div style={{fontFamily:F.body,fontSize:11,color:T.textFaint,marginTop:2}}>Estimated left</div>
          </div>
          <div style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.border}`}}>
            <div style={{fontFamily:F.heading,fontSize:26,color:T.accent}}>{formatDuration(visibleTasks.filter(t=>t.done).reduce((a,b)=>a+(b.estMins||0),0))||"0m"}</div>
            <div style={{fontFamily:F.body,fontSize:11,color:T.textFaint,marginTop:2}}>Completed work</div>
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

        {/* Devices signed in to this account. Signing one out removes its entry;
            that device then signs itself out when it next has the app open
            and online (src/lib/devices.ts), which the note says plainly. */}
        <div data-tour="profile-devices" style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.border}`,marginBottom:14}}>
          <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:12}}>Devices</div>
          {!devices||devices.length===0
            ?<div style={{fontFamily:F.body,fontSize:12,color:T.textFaint}}>{devices?"Getting this device ready…":"The device list isn't available right now."}</div>
            :<>
              {devices.map(d=>(
                <div key={d.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginBottom:10}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontFamily:F.body,fontSize:12,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.entry.name}</div>
                    <div style={{fontFamily:F.body,fontSize:10,color:d.current?ink("#2ED573",T.light):T.textFaint,marginTop:2}}>{d.current?"This device":`Active ${formatAgo(d.entry.lastSeen,now)}`}</div>
                  </div>
                  {!d.current&&<button onClick={()=>onSignOutDevice(d.id)} aria-label={`Sign out ${d.entry.name}`} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:9,padding:"6px 12px",color:T.text,fontFamily:F.body,fontSize:11,cursor:"pointer",flexShrink:0}}>Sign out</button>}
                </div>
              ))}
              {devices.some(d=>!d.current)&&devices.some(d=>d.current)&&<button onClick={onSignOutOtherDevices} style={{width:"100%",background:"none",border:"1px solid #FF475744",borderRadius:9,padding:"9px",color:ink("#FF4757",T.light),fontFamily:F.body,fontSize:12,cursor:"pointer",marginBottom:10}}>Sign out all other devices</button>}
              <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,lineHeight:1.5}}>A device signs out the next time it has DuePlanner open and online. If you think someone else can get into your Google account, change your Google password as well.</div>
            </>}
        </div>

        {/* Housekeeping. Storage: the real number of tasks on this device against
            the account's caps (LIMITS; the cloud's own counter started at zero
            when it was added, so it can read low for an older account). */}
        <div data-tour="profile-storage" style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.border}`,marginBottom:14}}>
          <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:12}}>Storage</div>
          {[{label:"Tasks",used:taskCount,max:LIMITS.tasks},{label:"Recently deleted",used:trashCount,max:LIMITS.trash}].map(r=>{
            const pctUsed=Math.min(100,r.used/r.max*100), nearlyFull=pctUsed>=90;
            return(
              <div key={r.label} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontFamily:F.body,fontSize:12,color:T.text}}>{r.label}</span>
                  <span style={{fontFamily:F.body,fontSize:11,color:nearlyFull?ink("#FF4757",T.light):T.textFaint}}>{r.used.toLocaleString()} of {r.max.toLocaleString()}</span>
                </div>
                <div role="progressbar" aria-label={`${r.label} storage used`} aria-valuemin={0} aria-valuemax={r.max} aria-valuenow={Math.min(r.used,r.max)} style={{height:5,background:T.border,borderRadius:999}}>
                  <div style={{width:`${r.used>0?Math.max(pctUsed,1.5):0}%`,height:"100%",background:nearlyFull?"#FF4757":T.accent,borderRadius:999}}/>
                </div>
              </div>
            );
          })}
          <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,lineHeight:1.5}}>Finished and archived tasks count too. Deleting tasks frees up room.</div>
        </div>

        {/* This device: installing the app and reminders (both are per device),
            then the feedback and privacy links. */}
        <div data-tour="profile-device" style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.border}`,marginBottom:14}}>
          <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:12}}>This device</div>
          {(()=>{
            const row={display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,minHeight:32};
            const name={fontFamily:F.body,fontSize:12,color:T.text};
            const state={fontFamily:F.body,fontSize:11,color:T.textFaint,textAlign:"right" as const};
            const btn={background:"none",border:`1px solid ${T.border}`,borderRadius:9,padding:"6px 12px",color:T.text,fontFamily:F.body,fontSize:11,cursor:"pointer",flexShrink:0};
            const note={fontFamily:F.body,fontSize:10,color:T.textMuted,lineHeight:1.5,marginTop:4};
            const permission=typeof Notification==="undefined"?"unsupported":Notification.permission;
            const remindersOn=notificationsEnabled&&permission==="granted";
            return <>
              <div style={row}>
                <span style={name}>App</span>
                {isStandalone()
                  ?<span style={state}>Installed on this device</span>
                  :<button onClick={()=>requestInstall(setInstallHint)} style={btn}>Install DuePlanner</button>}
              </div>
              {installHint&&<div style={note}>{installHint}</div>}
              <div style={{...row,marginTop:8}}>
                <span style={name}>Reminders</span>
                {permission==="unsupported"?<span style={state}>Not supported in this browser</span>
                  :permission==="denied"?<span style={state}>Blocked</span>
                  :<button onClick={()=>onToggleNotifications(!remindersOn)} aria-pressed={remindersOn} style={btn}>{remindersOn?"On. Turn off":"Turn on"}</button>}
              </div>
              {permission==="denied"&&<div style={note}>Notifications are blocked for this site. Allow them in your browser's site settings, then turn reminders on here.</div>}
              {notificationNote&&permission!=="denied"&&<div style={note}>{notificationNote}</div>}
              <div style={{height:1,background:T.borderFaint,margin:"12px 0"}}/>
              <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                <a href="https://forms.gle/oPuAWx6jNHvm75xi8" target="_blank" rel="noopener noreferrer" style={{fontFamily:F.body,fontSize:12,color:T.text}}>Send feedback or report a bug</a>
                <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{fontFamily:F.body,fontSize:12,color:T.textMuted}}>Privacy policy</a>
              </div>
            </>;
          })()}
        </div>

        {/* Sign out */}
        <button onClick={async()=>{await signOutFirebase();setShowProfile(false);}}
          style={{width:"100%",background:"none",border:`1px solid #FF475744`,borderRadius:12,padding:"13px",color:ink("#FF4757",T.light),fontFamily:F.body,fontSize:13,cursor:"pointer"}}>
          Sign out
        </button>
      </div>
    </div>
  );
}
