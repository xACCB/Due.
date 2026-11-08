import type { Task } from "@dueplanner/core/types";
import { localDateStr } from "@dueplanner/core/lib/dates";

// Sample tasks for checking screens in development (see app/dev.tsx): every
// kind of card the list can show (overdue, due today at a time, repeating,
// subtasks, tags, a pinned priority, done, archived, no date).
export function devSampleTasks(now: number): Task[] {
  const day = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return localDateStr(d); };
  const hour = new Date(now + 3 * 3600000);
  const soon = `${String(hour.getHours()).padStart(2, "0")}:00`;
  return [
    { id: 1001, order: 0, title: "Chapter 3 reading", subject: "English", dueDate: day(-1), dueTime: "", estMins: 45, done: false },
    { id: 1002, order: 1, title: "Problem set 4", subject: "Math", dueDate: day(0), dueTime: soon, estMins: 90, done: false,
      subtasks: [{ id: "s1", text: "Questions 1-5", done: true }, { id: "s2", text: "Questions 6-10", done: false }, { id: "s3", text: "Check answers", done: false }],
      sessions: [{ mins: 25, at: now - 3600000 }] },
    { id: 1003, order: 2, title: "Lab report", subject: "Science", dueDate: day(1), dueTime: "", estMins: 120, done: false, tags: ["lab", "group"] },
    { id: 1004, order: 3, title: "Vocabulary quiz", subject: "Spanish", dueDate: day(4), dueTime: "09:00", estMins: 20, done: false, recurrence: "weekly" },
    { id: 1005, order: 4, title: "History essay draft", subject: "History", dueDate: day(12), dueTime: "", estMins: 180, done: false, priorityOverride: "high" },
    { id: 1006, order: 5, title: "Read for fun", subject: "", dueDate: "", dueTime: "", estMins: 0, done: false },
    { id: 1007, order: 6, title: "Worksheet 2", subject: "Math", dueDate: day(-2), dueTime: "", estMins: 30, done: true, completedAt: now - 86400000 },
    { id: 1008, order: 7, title: "Old project", subject: "Art", dueDate: day(-20), dueTime: "", estMins: 60, done: true, archived: true, completedAt: now - 15 * 86400000 },
  ];
}
