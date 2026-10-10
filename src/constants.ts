// App-wide constants: the layouts, subjects, colours, reminder offsets and
// add-task questions. Plain data (and two tiny helpers over it), with nothing
// from React or the browser, so anything can import it.
import type { Priority } from "./types";
import { normalizeQuestionPrefs } from "./lib/addQuestions";

export const LAYOUTS = {
  list:      { name:"List",       emoji:"☰",  desc:"Classic cards" },
  board:     { name:"Board",      emoji:"⊞",  desc:"Grid cards" },
  checklist: { name:"Checklist",  emoji:"☑",  desc:"Simple ticks" },
  kanban:    { name:"Kanban",     emoji:"𝄘",  desc:"By urgency" },
  progress:  { name:"Progress",   emoji:"▓",  desc:"Subtask progress" },
  pyramid:   { name:"Pyramid",    emoji:"△",  desc:"By priority" },
} as const;
export type LayoutName = keyof typeof LAYOUTS;

export const GROUP_BY = { none:{name:"None",emoji:"--"}, subject:{name:"Subject",emoji:"▥"}, priority:{name:"Priority",emoji:"‼"}, dueDate:{name:"Due Date",emoji:"▦"} };
export const DEFAULT_SUBJECTS = ["Math","English","Science","History","Art","PE"];
export const DEFAULT_SUBJECT_COLORS: Record<string,string> = { Math:"#FF6B6B",English:"#FF9F43",Science:"#45B7D1",History:"#F7DC6F",Art:"#BB8FCE",PE:"#82E0AA" };
export const SUBJECT_COLOR_PALETTE = ["#FF6B6B","#FF9F43","#45B7D1","#F7DC6F","#BB8FCE","#82E0AA","#C9E06C","#9CE06C","#6EE06C","#6CE0D2","#6C7DE0","#8D6CE0","#E06CCE","#E06C9E"];
export const PRIORITY_COLORS: Record<Priority,string> = { high:"#FF4757",medium:"#FFA502",low:"#2ED573" };
// Fallback for every priority color/text when the "Urgency color coding" toggle
// (Options -> Looks) is off -- one neutral gray instead of red/orange/green, so
// urgency still reads through position/text ("Overdue!" etc.) without color.
export const NEUTRAL_PRIORITY_COLOR = "#8a8a8a";
export function priColor(pr:Priority,colorCode:boolean):string{ return colorCode?PRIORITY_COLORS[pr]:NEUTRAL_PRIORITY_COLOR; }

export const REMINDER_OFFSETS = [
  { key:"1w", label:"1 week before", mins:10080 },
  { key:"1d", label:"1 day before", mins:1440 },
  { key:"3h", label:"3 hours before", mins:180 },
  { key:"1h", label:"1 hour before", mins:60 },
  { key:"0",  label:"At due time",   mins:0 },
] as const;
// The add-task questions asked after the title. Which are asked, and in what
// order, is the "New task questions" setting (`askQuestions`); `name` is how
// Settings lists each one.
export const QUESTIONS = [
  { key:"subject", label:"What subject?", type:"select", name:"Subject" },
  { key:"dueDate", label:"When is it due?", type:"date", name:"Due date" },
  { key:"estMins", label:"How long will it take?", type:"time", name:"How long it takes" },
  { key:"recurrence", label:"Does this repeat?", type:"recurrence", name:"Repeats" },
];
export const QUESTION_KEYS=QUESTIONS.map(q=>q.key);
// The questions to ask, in order, from the saved "New task questions" setting.
// HomeworkPlanner wraps this in useMemo: computed plainly in the component body,
// the React Compiler treated the list (read by the wizard's JSX) as possibly
// mutated and bailed out on the whole component (preserve-manual-memoization,
// reported on the css memo's F.google/F.body deps).
export function askedQuestions(saved:unknown){
  return normalizeQuestionPrefs(saved,QUESTION_KEYS).filter(p=>p.on).map(p=>QUESTIONS.find(q=>q.key===p.key)!);
}
