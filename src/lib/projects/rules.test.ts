import { describe, expect, it } from "vitest";
import { projectBoardColumns } from "./rules";

describe("projectBoardColumns", () => {
  it("orders configurable stages and places linked tasks without cloning task records", () => {
    const sharedTask = { id: "task-1", title: "Draft the proposal", status: "open" as const };
    const tasks = [sharedTask, { id: "task-2", title: "Review feedback", status: "done" as const }];
    const columns = projectBoardColumns("project-1", [
      { id: "stage-review", project_id: "project-1", name: "Review", sort_order: 2, is_archived: false, is_complete: false },
      { id: "stage-plan", project_id: "project-1", name: "Plan", sort_order: 1, is_archived: false, is_complete: false },
      { id: "stage-old", project_id: "project-1", name: "Old lane", sort_order: 0, is_archived: true, is_complete: false },
      { id: "stage-other", project_id: "project-2", name: "Other project", sort_order: 0, is_archived: false, is_complete: false },
    ], [
      { stage_id: "stage-review", task_id: "task-2", sort_order: 0 },
      { stage_id: "stage-plan", task_id: "task-1", sort_order: 0 },
      { stage_id: "stage-old", task_id: "task-2", sort_order: 0 },
    ], tasks);

    expect(columns.map(({ stage }) => stage.name)).toEqual(["Plan", "Review"]);
    expect(columns[0].tasks[0]).toBe(sharedTask);
    expect(columns[1].tasks[0].id).toBe("task-2");
    expect(tasks).toEqual([sharedTask, { id: "task-2", title: "Review feedback", status: "done" }]);
  });
});
