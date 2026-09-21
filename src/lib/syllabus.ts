import { localDateStr } from "./dates";

// ─── SYLLABUS IMPORT ────────────────────────────────────────────────────────
// A syllabus is free text with no fixed structure, so this is a heuristic
// line-scanner rather than a real parser: for each line, look for the first
// recognizable date (ISO, M/D[/YY], or "Month D[, YYYY]"), and if one's found,
// treat the rest of that line as the assignment title. No AI/network call --
// this app intentionally has no backend to send syllabus text to.
export const MONTH_NAMES:Record<string,number> = {
  jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,
  jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,
  oct:9,october:9,nov:10,november:10,dec:11,december:11,
};
export interface ParsedSyllabusItem { title:string; dueDate:string; }
export function parseSyllabus(text:string):ParsedSyllabusItem[] {
  const today=new Date(); today.setHours(0,0,0,0);
  const results:ParsedSyllabusItem[]=[];
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim();
    if(!line)continue;
    let d:Date|null=null, matched="";
    let m=line.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if(m){ d=new Date(+m[1],+m[2]-1,+m[3]); matched=m[0]; }
    if(!d){
      m=line.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
      if(m){
        const year=m[3]?(m[3].length===2?2000+ +m[3]:+m[3]):today.getFullYear();
        d=new Date(year,+m[1]-1,+m[2]);
        matched=m[0];
      }
    }
    if(!d){
      m=line.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i);
      if(m){
        const year=m[3]?+m[3]:today.getFullYear();
        d=new Date(year,MONTH_NAMES[m[1].toLowerCase()],+m[2]);
        matched=m[0];
      }
    }
    if(!d||isNaN(d.getTime()))continue;
    // No explicit 4-digit year in the match and the date lands well in the
    // past -- most likely next year's occurrence of that month/day (a Dec
    // syllabus listing "Jan 15" almost always means the following January).
    if(!/\d{4}/.test(matched)&&(today.getTime()-d.getTime())/86400000>30){
      d.setFullYear(d.getFullYear()+1);
    }
    let title=(line.slice(0,m!.index)+line.slice(m!.index!+matched.length)).trim();
    title=title.replace(/^[-–—:•*\s]+|[-–—:•*\s]+$/g,"");
    if(title.length>100)title=title.slice(0,97)+"...";
    if(!title)title="Untitled assignment";
    results.push({title,dueDate:localDateStr(d)});
  }
  return results;
}
