import { describe, expect, it } from "vitest";
import { projectLocalDailyMutations } from "./projection";
import type { DailySnapshot } from "./types";
import type { QueuedMutation } from "@/lib/offline/outbox";

const snapshot: DailySnapshot = {
  plan: {
    id: "plan-today",
    user_id: "user-a",
    local_date: "2026-10-12",
    timezone: "Asia/Manila",
    status: "active",
    reflection: null,
    started_at: null,
    ended_at: null,
    revision: 1,
  },
  priorities: [
    { id: "priority-a", daily_plan_id: "plan-today", rank: 1, title: "Send the draft", outcome: null, state: "active", revision: 1 },
  ],
  tasks: [
    { id: "task-a", title: "Outline the draft", details: null, due_date: "2026-10-12", status: "open", completed_at: null, sort_order: 0, revision: 1 },
  ],
  priorityTaskLinks: [],
  routines: [],
  routineLogs: [],
};

function queued(overrides: Partial<QueuedMutation>): QueuedMutation {
  return {
    id: "mutation-a",
    recordId: "task-a",
    expectedRevision: 1,
    payload: {},
    createdAt: 1,
    status: "pending",
    ...overrides,
  };
}

describe("offline daily view projection", () => {
  it("shows queued task completion without assigning a priority outcome", () => {
    const view = projectLocalDailyMutations(snapshot, [queued({
      entityType: "task",
      payload: { status: "done" },
    })], "2026-10-12");

    expect(view.tasks[0]).toMatchObject({ status: "done", revision: 2 });
    expect(view.priorities[0].outcome).toBeNull();
  });

  it("keeps future plan drafts isolated from the active day", () => {
    const view = projectLocalDailyMutations(snapshot, [queued({
      id: "future-plan",
      recordId: "plan-future",
      entityType: "daily_plan",
      expectedRevision: 0,
      payload: { local_date: "2026-10-13", timezone: "Asia/Manila", status: "draft" },
    })], "2026-10-12");

    expect(view.plan?.id).toBe("plan-today");
    expect(view.plan?.status).toBe("active");
  });

  it("projects offline End Day as pending while retaining explicit outcomes", () => {
    const view = projectLocalDailyMutations(snapshot, [queued({
      id: "end-day",
      recordId: "plan-today",
      entityType: "end_day",
      payload: {
        reflection: "A thoughtful day.",
        outcomes: [{ priority_id: "priority-a", outcome: "partly_done" }],
        carry_forward: [],
      },
    })], "2026-10-12");

    expect(view.plan).toMatchObject({ status: "ended", reflection: "A thoughtful day." });
    expect(view.priorities[0].outcome).toBe("partly_done");
  });
});
