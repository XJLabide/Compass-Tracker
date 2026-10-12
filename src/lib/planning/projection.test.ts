import { describe, expect, it } from "vitest";
import type { QueuedMutation } from "@/lib/offline/outbox";
import { emptyPlanningSnapshot } from "./types";
import { projectLocalPlanningMutations } from "./projection";

function queued(
  id: string,
  entityType: QueuedMutation["entityType"],
  recordId: string,
  payload: QueuedMutation["payload"],
): QueuedMutation {
  return { id, entityType, recordId, expectedRevision: 0, payload, createdAt: 1, status: "pending" };
}

describe("projectLocalPlanningMutations", () => {
  it("projects timed events separately from existing date-only tasks", () => {
    const source = {
      ...emptyPlanningSnapshot,
      tasks: [{ id: "task-1", title: "Send the agenda", details: null, due_date: "2026-10-12", status: "open" as const, completed_at: null, sort_order: 0, revision: 1 }],
    };
    const result = projectLocalPlanningMutations(source, [queued("m1", "calendar_event", "event-1", {
      title: "Planning call",
      starts_at: "2026-10-12T01:00:00Z",
      ends_at: "2026-10-12T01:30:00Z",
      time_zone: "Asia/Manila",
      description: null,
      status: "active",
    })]);

    expect(result.calendarEvents).toMatchObject([{ id: "event-1", title: "Planning call", starts_at: "2026-10-12T01:00:00Z" }]);
    expect(result.tasks).toEqual(source.tasks);
  });

  it("projects project stages and task placement without removing the shared task", () => {
    const task = { id: "task-1", title: "Write the brief", details: null, due_date: null, status: "open" as const, completed_at: null, sort_order: 0, revision: 1 };
    const result = projectLocalPlanningMutations({ ...emptyPlanningSnapshot, tasks: [task] }, [
      queued("m1", "project", "project-1", { title: "Launch", description: null, status: "active", sort_order: 0, stages: [{ id: "stage-1", name: "Backlog", sort_order: 0, is_complete: false, is_archived: false }] }),
      queued("m2", "project_stage", "stage-2", { project_id: "project-1", name: "Next", color: null, sort_order: 1, is_complete: false, is_archived: false }),
      queued("m3", "project_task_link", "link-1", { project_id: "project-1", task_id: "task-1", stage_id: "stage-2", sort_order: 0, active: true }),
    ]);

    expect(result.projects).toMatchObject([{ id: "project-1", title: "Launch" }]);
    expect(result.projectStages).toMatchObject([
      { id: "stage-1", project_id: "project-1", name: "Backlog" },
      { id: "stage-2", project_id: "project-1", name: "Next" },
    ]);
    expect(result.projectTaskLinks).toMatchObject([{ id: "link-1", task_id: "task-1", stage_id: "stage-2" }]);
    expect(result.tasks).toEqual([task]);
  });

  it("projects a goal measurement with its source as an offline trend entry", () => {
    const result = projectLocalPlanningMutations({ ...emptyPlanningSnapshot, goals: [
      { id: "goal-1", title: "Build a reading habit", description: null, kind: "measurable", status: "active", life_area_id: null, baseline_value: 0, target_value: 12, target_unit: "books", direction: "increase", due_date: null, sort_order: 0, revision: 1 },
    ] }, [queued("m1", "goal_update", "update-1", {
      goal_id: "goal-1", value: 2, unit: "books", note: "Finished two novels", source: "Manual check-in", measured_at: "2026-10-12T08:00:00Z", active: true,
    })]);

    expect(result.goalUpdates).toMatchObject([{ id: "update-1", goal_id: "goal-1", value: 2, source: "Manual check-in" }]);
  });
});
