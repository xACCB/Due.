import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { firstName, greeting, leftToday, partOfDay } from "./greeting";

const task = (dueDate: string, extra: Partial<Task> = {}): Task => ({
  id: Math.random(), title: "T", subject: "", dueDate, dueTime: "", estMins: 0, done: false, order: 0, ...extra,
});

describe("partOfDay", () => {
  it("is morning from 5, afternoon from noon, evening from 5pm and overnight", () => {
    expect([4, 5, 11, 12, 16, 17, 23, 0].map(partOfDay)).toEqual(
      ["evening", "morning", "morning", "afternoon", "afternoon", "evening", "evening", "evening"]);
  });
});

describe("leftToday", () => {
  it("counts open tasks due today or overdue", () => {
    const tasks = [
      task("2026-11-21"), task("2026-11-20"), task("2026-11-22"), task(""),
      task("2026-11-21", { done: true }), task("2026-11-19", { archived: true }),
    ];
    expect(leftToday(tasks, "2026-11-21")).toBe(2);
  });
});

describe("greeting", () => {
  it("reads as the user wrote it, without a name", () => {
    expect(greeting(19, 3)).toBe("Good evening, 3 things left today");
    expect(greeting(9, 1)).toBe("Good morning, 1 thing left today");
    expect(greeting(14, 0)).toBe("Good afternoon, nothing left for today");
  });
  it("uses the first name when there is one", () => {
    expect(greeting(19, 3, "Aaron Smith")).toBe("Good evening, Aaron. 3 things left today");
    expect(greeting(19, 0, "Aaron")).toBe("Good evening, Aaron. Nothing left for today");
    expect(greeting(19, 2, "  ")).toBe("Good evening, 2 things left today");
  });
  it("takes the first word of a name", () => {
    expect(firstName(" Ada  Lovelace ")).toBe("Ada");
    expect(firstName(null)).toBe("");
  });
});
