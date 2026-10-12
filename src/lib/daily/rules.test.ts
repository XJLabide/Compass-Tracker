import { describe, expect, it } from "vitest";
import {
  classifyPlanDate,
  dueRoutineIds,
  nextPriorityRank,
  taskBucket,
  validateEndDayReview,
} from "./rules";

describe("daily planning rules", () => {
  it("keeps future drafts separate from today and supports past-date backfill", () => {
    expect(classifyPlanDate("2026-10-10", "2026-10-12")).toBe("backfill");
    expect(classifyPlanDate("2026-10-12", "2026-10-12")).toBe("today");
    expect(classifyPlanDate("2026-10-13", "2026-10-12")).toBe("future");
  });

  it("assigns priorities the first free rank and stops at three", () => {
    expect(nextPriorityRank([{ rank: 1 }, { rank: 3 }])).toBe(2);
    expect(nextPriorityRank([{ rank: 1 }, { rank: 2 }, { rank: 3 }])).toBeUndefined();
  });

  it("requires a user-selected outcome for each priority before ending the day", () => {
    const priorities = [
      { id: "first", rank: 1, title: "Send the draft" },
      { id: "second", rank: 2, title: "Move with intention" },
    ];

    expect(validateEndDayReview(priorities, { first: "done" }, [], 0)).toEqual({
      ok: false,
      reason: "outcomes-required",
      missingPriorityIds: ["second"],
    });
  });

  it("carries only explicitly selected unfinished priorities", () => {
    const priorities = [
      { id: "done", rank: 1, title: "Draft", outcome: "done" as const },
      { id: "partial", rank: 2, title: "Review", outcome: "partly_done" as const },
      { id: "irrelevant", rank: 3, title: "Old note", outcome: "no_longer_relevant" as const },
    ];

    expect(validateEndDayReview(
      priorities,
      { done: "done", partial: "partly_done", irrelevant: "no_longer_relevant" },
      ["partial"],
      1,
    )).toEqual({ ok: true, carryForwardIds: ["partial"] });

    expect(validateEndDayReview(
      priorities,
      { done: "done", partial: "partly_done", irrelevant: "no_longer_relevant" },
      ["done"],
      0,
    )).toEqual({ ok: false, reason: "invalid-carry-forward", priorityId: "done" });
  });

  it("blocks carry-forward choices that would exceed tomorrow's three-priority limit", () => {
    const priorities = [{ id: "partial", rank: 1, title: "Finish review", outcome: "partly_done" as const }];
    expect(validateEndDayReview(priorities, { partial: "partly_done" }, ["partial"], 3)).toEqual({
      ok: false,
      reason: "priority-limit",
    });
  });

  it("schedules routines by local ISO weekday and ignores unscheduled days", () => {
    const routines = [
      { id: "daily", daysOfWeek: [1, 2, 3, 4, 5, 6, 7] },
      { id: "weekday", daysOfWeek: [1, 2, 3, 4, 5] },
      { id: "sunday", daysOfWeek: [7] },
    ];

    expect(dueRoutineIds(routines, "2026-10-11")).toEqual(["daily", "sunday"]);
  });

  it("keeps due dates distinct from inbox tasks", () => {
    expect(taskBucket({ status: "open", dueDate: "2026-10-12" }, "2026-10-12")).toBe("today");
    expect(taskBucket({ status: "open", dueDate: "2026-10-13" }, "2026-10-12")).toBe("upcoming");
    expect(taskBucket({ status: "open", dueDate: null }, "2026-10-12")).toBe("inbox");
    expect(taskBucket({ status: "done", dueDate: null }, "2026-10-12")).toBe("completed");
  });
});
