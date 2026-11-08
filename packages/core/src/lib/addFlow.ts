// The add-task questions as a state machine: the title, then the questions
// the "New task questions" setting asks (core's QUESTIONS, in the user's
// order), each answered or skipped. The due-date question has two parts: the
// date, then "what time?". Plain data in, plain data out, so any screen can
// drive it; the phone app's add sheet does.
// It follows the web wizard in App.tsx (startAdding / handleAnswer /
// goForwardStep / confirmDueTime): with the estimate question off a new task
// gets no estimate (not the picker's 30-minute start), skipping the estimate
// also means none, and with every question off the title alone adds the task.
import type { Recurrence, TaskTemplate } from "../types";
import { QUESTIONS } from "../constants";
import { LIMITS, oneLine } from "./limits";

export type AddQuestion = (typeof QUESTIONS)[number];

export interface AddDraft {
  title: string;
  subject: string;
  dueDate: string;
  dueTime: string;
  estMins: number;
  recurrence?: Recurrence;
  // From a template: subtasks to create, unchecked.
  subtasks?: { text: string }[];
}

export interface AddFlow {
  questions: AddQuestion[];
  // -1 is the title; 0.. is a position in `questions`.
  step: number;
  draft: AddDraft;
  // The due-date question's picked date while it asks "what time?" (null: asking the date).
  pendingDate: string | null;
}

// Either the flow carries on, or the task is ready to add.
export type AddStep = { flow: AddFlow; done?: undefined } | { done: AddDraft; flow?: undefined };

// The estimate picker starts at 30 minutes when the question is asked.
export const ESTIMATE_START = 30;

export function currentQuestion(f: AddFlow): AddQuestion | null {
  return f.step >= 0 ? f.questions[f.step] ?? null : null;
}

// `presetDate`: a due date picked before starting (the Calendar's "Add
// homework due ..."): the date question then opens on "what time?", or with
// that question off the date is simply set.
export function startAdd(questions: AddQuestion[], presetDate?: string): AddFlow {
  const asksDate = questions.some(q => q.type === "date");
  return {
    questions,
    step: -1,
    draft: {
      title: "", subject: "", dueDate: presetDate && !asksDate ? presetDate : "", dueTime: "",
      estMins: questions.some(q => q.type === "time") ? ESTIMATE_START : 0,
    },
    pendingDate: presetDate && asksDate ? presetDate : null,
  };
}

function advance(f: AddFlow, draft: AddDraft): AddStep {
  // A preset `pendingDate` waits, unused, until the date question comes up:
  // every date step checks that it is the current question.
  if (f.step < f.questions.length - 1) return { flow: { ...f, step: f.step + 1, draft } };
  return { done: draft };
}

export function submitTitle(f: AddFlow, title: string): AddStep {
  const clean = oneLine(title).trim().slice(0, LIMITS.title);
  if (!clean) return { flow: f };
  const draft = { ...f.draft, title: clean };
  if (f.questions.length === 0) return { done: draft };
  return { flow: { ...f, step: 0, draft } };
}

// Answers the current subject, estimate or repeat question (the date has its own two steps).
export function answer(f: AddFlow, value: string | number): AddStep {
  const q = currentQuestion(f);
  if (!q || q.type === "date") return { flow: f };
  const draft: AddDraft = { ...f.draft };
  if (q.type === "time") draft.estMins = Math.max(0, Math.min(LIMITS.estMins, Math.round(Number(value)) || 0));
  else if (q.type === "recurrence") draft.recurrence = value as Recurrence;
  else draft.subject = oneLine(String(value)).slice(0, LIMITS.subject);
  return advance(f, draft);
}

export function pickDate(f: AddFlow, iso: string): AddStep {
  if (currentQuestion(f)?.type !== "date") return { flow: f };
  return { flow: { ...f, pendingDate: iso } };
}

// The time for the picked date ("" is "any time").
export function confirmTime(f: AddFlow, time: string): AddStep {
  if (currentQuestion(f)?.type !== "date" || f.pendingDate == null) return { flow: f };
  return advance({ ...f, pendingDate: null }, { ...f.draft, dueDate: f.pendingDate, dueTime: time });
}

// Skip: leaves the answer blank (no estimate means 0). On "what time?" it
// keeps the date with no time.
export function skip(f: AddFlow): AddStep {
  const q = currentQuestion(f);
  if (!q) return { flow: f };
  if (q.type === "date" && f.pendingDate != null) return confirmTime(f, "");
  return advance(f, q.type === "time" ? { ...f.draft, estMins: 0 } : f.draft);
}

export function back(f: AddFlow): AddFlow {
  if (currentQuestion(f)?.type === "date" && f.pendingDate != null) return { ...f, pendingDate: null };
  return f.step > -1 ? { ...f, step: f.step - 1 } : f;
}

// Starting from a template (the web's startFromTemplate): the template has
// answered everything but the due date, so only that question is asked; with
// it turned off, the task is ready at once.
export function startFromTemplate(questions: AddQuestion[], tpl: TaskTemplate): AddStep {
  const draft: AddDraft = {
    title: oneLine(tpl.name).trim().slice(0, LIMITS.title), subject: tpl.subject, dueDate: "", dueTime: "",
    estMins: tpl.estMins, recurrence: tpl.recurrence, subtasks: tpl.subtasks,
  };
  const dateQ = questions.find(q => q.type === "date");
  if (!dateQ) return { done: draft };
  return { flow: { questions: [dateQ], step: 0, draft, pendingDate: null } };
}
