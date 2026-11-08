import { describe, expect, it } from "vitest";
import { QUESTIONS } from "../constants";
import { askedQuestions } from "../constants";
import { answer, back, confirmTime, currentQuestion, ESTIMATE_START, pickDate, skip, startAdd, submitTitle, type AddFlow, type AddStep } from "./addFlow";

const all = askedQuestions(null); // subject, dueDate, estMins, recurrence
const flow = (s: AddStep): AddFlow => { if (!s.flow) throw new Error("finished early"); return s.flow; };

describe("addFlow", () => {
  it("asks every question in order and finishes with the answers", () => {
    let f = startAdd(all);
    expect(f.step).toBe(-1);
    expect(f.draft.estMins).toBe(ESTIMATE_START);
    f = flow(submitTitle(f, "  Chapter 3\nreading "));
    expect(f.draft.title).toBe("Chapter 3 reading");
    expect(currentQuestion(f)?.key).toBe("subject");
    f = flow(answer(f, "Math"));
    expect(currentQuestion(f)?.key).toBe("dueDate");
    f = flow(pickDate(f, "2026-11-12"));
    expect(f.pendingDate).toBe("2026-11-12");
    f = flow(confirmTime(f, "15:00"));
    expect(currentQuestion(f)?.key).toBe("estMins");
    f = flow(answer(f, "45"));
    const end = answer(f, "weekly");
    expect(end.done).toEqual({ title: "Chapter 3 reading", subject: "Math", dueDate: "2026-11-12", dueTime: "15:00", estMins: 45, recurrence: "weekly" });
  });

  it("ignores a blank title", () => {
    const f = startAdd(all);
    expect(submitTitle(f, "   ").flow).toBe(f);
  });

  it("with every question off, the title adds the task with no estimate", () => {
    const f = startAdd([]);
    expect(f.draft.estMins).toBe(0);
    expect(submitTitle(f, "Read").done).toMatchObject({ title: "Read", estMins: 0 });
  });

  it("skipping the estimate means no estimate", () => {
    const qs = [QUESTIONS[2]];
    const f = flow(submitTitle(startAdd(qs), "Lab"));
    expect(skip(f).done?.estMins).toBe(0);
  });

  it("skipping 'what time?' keeps the date with no time", () => {
    const qs = [QUESTIONS[1]];
    let f = flow(submitTitle(startAdd(qs), "Essay"));
    f = flow(pickDate(f, "2026-12-01"));
    expect(skip(f).done).toMatchObject({ dueDate: "2026-12-01", dueTime: "" });
  });

  it("skipping the date leaves it blank", () => {
    const f = flow(submitTitle(startAdd([QUESTIONS[1]]), "Essay"));
    expect(skip(f).done).toMatchObject({ dueDate: "", dueTime: "" });
  });

  it("back from 'what time?' returns to the date, then to the previous question", () => {
    let f = flow(submitTitle(startAdd(all), "Quiz"));
    f = flow(answer(f, "Science"));
    f = flow(pickDate(f, "2026-11-20"));
    f = back(f);
    expect(f.pendingDate).toBeNull();
    expect(currentQuestion(f)?.key).toBe("dueDate");
    f = back(f);
    expect(currentQuestion(f)?.key).toBe("subject");
    f = back(f);
    expect(f.step).toBe(-1);
    expect(back(f)).toBe(f);
  });

  it("a preset date opens the date question on 'what time?'", () => {
    let f = startAdd(all, "2026-11-30");
    f = flow(submitTitle(f, "Project"));
    f = flow(answer(f, "Art"));
    expect(currentQuestion(f)?.key).toBe("dueDate");
    expect(f.pendingDate).toBe("2026-11-30");
    f = flow(confirmTime(f, ""));
    expect(f.draft).toMatchObject({ dueDate: "2026-11-30", dueTime: "" });
  });

  it("a preset date with the date question off is just set", () => {
    const f = startAdd([QUESTIONS[0]], "2026-11-30");
    expect(f.draft.dueDate).toBe("2026-11-30");
    expect(f.pendingDate).toBeNull();
  });

  it("answers outside their question change nothing", () => {
    const f = flow(submitTitle(startAdd(all), "X")); // on subject
    expect(pickDate(f, "2026-01-01").flow).toBe(f);
    expect(confirmTime(f, "10:00").flow).toBe(f);
    const onDate = flow(answer(f, "Math"));
    expect(answer(onDate, "Math").flow).toBe(onDate);
  });

  it("caps an estimate to the limits", () => {
    const f = flow(submitTitle(startAdd([QUESTIONS[2]]), "Big"));
    expect(answer(f, 10_000_000).done?.estMins).toBe(100000);
    expect(answer(f, "abc").done?.estMins).toBe(0);
  });
});
