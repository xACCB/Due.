// ─── TAB BAR ICONS ─────────────────────────────────────────────────────────────
// Small stroke-based SVGs (not Unicode glyphs) for the icon-only main tab bar --
// built from plain primitives (line/circle/polyline) rather than hand-drawn path
// data, so they render identically and crisply everywhere instead of depending on
// whichever symbols a given OS/browser's font happens to ship. `stroke="currentColor"`
// picks up the parent button's `color`, so active/inactive state needs no extra prop.
export function IconTasks(){
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="4" cy="6" r="1.3"/><line x1="8.5" y1="6" x2="20" y2="6"/>
    <circle cx="4" cy="12" r="1.3"/><line x1="8.5" y1="12" x2="20" y2="12"/>
    <circle cx="4" cy="18" r="1.3"/><line x1="8.5" y1="18" x2="20" y2="18"/>
  </svg>;
}
export function IconImport(){
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="3" x2="12" y2="14"/><polyline points="7.5,10 12,14.5 16.5,10"/>
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>
  </svg>;
}
export function IconCalendar(){
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><line x1="3.5" y1="10" x2="20.5" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>
  </svg>;
}
export function IconFocus(){
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none"/>
  </svg>;
}
// The fold-away button at the top of the sidebar: a panel with its left column marked.
export function IconSidebar({size=16}:{size?:number}){
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><line x1="9.5" y1="4.5" x2="9.5" y2="19.5"/>
  </svg>;
}
export function IconBell(){
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z"/>
    <path d="M10 19a2 2 0 0 0 4 0"/>
  </svg>;
}
export function IconHistory(){
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="13" r="8"/><polyline points="12,9 12,13 15,15"/><polyline points="8.5,2.5 12,5.5 15.5,2.5"/>
  </svg>;
}
export function IconSearch(){
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/>
  </svg>;
}
export function IconSettings(){
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2.1"/>
    {[0,45,90,135,180,225,270,315].map(deg=>(
      <line key={deg} x1="12" y1="4.2" x2="12" y2="1.8" transform={`rotate(${deg} 12 12)`}/>
    ))}
  </svg>;
}

// Done checkmark, drawn as a stroke so it can draw itself in (.check-draw in
// the runtime css) the moment a task is completed; static everywhere else.
export function CheckMark({size=10,color="#111",animate=false}:{size?:number;color?:string;animate?:boolean}){
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" className={animate?"check-draw":undefined} style={{display:"block"}}>
      <polyline points="2.2,6.4 4.9,9 9.8,3.2" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1}/>
    </svg>
  );
}
