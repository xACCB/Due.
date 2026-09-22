// Audits every theme in src/themes.ts for WCAG contrast failures. Diagnostic
// only -- reports findings, doesn't fix anything or fail the build. With 26
// independently-defined themes, it's entirely plausible one dark theme's
// accent-on-background contrast quietly fails accessibility guidelines and
// nobody's checked.
//
// Run with: node --experimental-strip-types scripts/check-theme-contrast.ts
import { THEMES } from "../src/themes.ts";

function relativeLuminance(hex:string):number {
  const c=hex.replace("#","");
  const r=parseInt(c.substring(0,2),16)/255, g=parseInt(c.substring(2,4),16)/255, b=parseInt(c.substring(4,6),16)/255;
  const lin=(v:number)=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);
  return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
}
function contrastRatio(hexA:string,hexB:string):number {
  const lA=relativeLuminance(hexA), lB=relativeLuminance(hexB);
  const lighter=Math.max(lA,lB), darker=Math.min(lA,lB);
  return (lighter+0.05)/(darker+0.05);
}

const NORMAL_TEXT_MIN=4.5; // WCAG AA, normal-sized text
const LARGE_TEXT_MIN=3.0;  // WCAG AA, large text (18pt+/14pt bold+) or UI components

let failures=0, checked=0;
for(const [key,t] of Object.entries(THEMES)){
  const rows:{label:string;fg:string;bg:string;min:number}[]=[
    {label:"text on bg",     fg:t.text,      bg:t.bg,   min:NORMAL_TEXT_MIN},
    {label:"text on card",   fg:t.text,      bg:t.card, min:NORMAL_TEXT_MIN},
    {label:"textMuted on bg",fg:t.textMuted, bg:t.bg,   min:NORMAL_TEXT_MIN},
    {label:"textMuted/card", fg:t.textMuted, bg:t.card, min:NORMAL_TEXT_MIN},
    // textFaint is the deliberately lowest-emphasis tier (decorative/caption-ish,
    // not primary reading text), so it's held to the looser large-text/UI-component
    // bar rather than normal-text AA -- this row was originally missing entirely,
    // which let stealthLight's #cccccc-on-#f5f5f5 (1.47:1, genuinely close to
    // invisible) ship without the audit ever flagging it.
    {label:"textFaint on bg", fg:t.textFaint, bg:t.bg,   min:LARGE_TEXT_MIN},
    {label:"textFaint/card",  fg:t.textFaint, bg:t.card, min:LARGE_TEXT_MIN},
    {label:"accent on bg",   fg:t.accent,    bg:t.bg,   min:LARGE_TEXT_MIN},
  ];
  for(const row of rows){
    checked++;
    const ratio=contrastRatio(row.fg,row.bg);
    if(ratio<row.min){
      failures++;
      console.log(`FAIL  ${key.padEnd(14)} ${row.label.padEnd(16)} ${ratio.toFixed(2)}:1  (needs ${row.min}:1)  ${row.fg} on ${row.bg}`);
    }
  }
}
console.log(`\n${checked} pairs checked across ${Object.keys(THEMES).length} themes, ${failures} below WCAG AA.`);
if(failures>0)process.exitCode=1;
