import { describe, expect, it } from "vitest";
import type { QueuedMutation } from "@/lib/offline/outbox";
import { projectLocalFitnessMutations } from "./projection";
import { emptyFitnessSnapshot } from "./types";

describe("offline fitness projection", () => {
  it("shows a pending workout in derived exercise history without duplicating the source", () => {
    const mutation: QueuedMutation = {
      id: "mutation-1", recordId: "workout-1", entityType: "workout_log", expectedRevision: 0,
      payload: {
        local_date: "2026-10-14", timezone: "Asia/Manila", title_snapshot: "Leg day", completed_at: "2026-10-14T02:00:00Z",
        exercises: [{ exercise_id: "squat", exercise_name: "Back squat", sets: [{ weight: 80, reps: 3 }] }],
      },
      createdAt: 1, status: "conflict",
    };
    const projected = projectLocalFitnessMutations(emptyFitnessSnapshot, [mutation]);

    expect(projected.workouts).toHaveLength(1);
    expect(projected.workouts[0]).toMatchObject({ id: "workout-1", status: "logged", exercises: [{ exercise_id: "squat" }] });
    expect(emptyFitnessSnapshot.workouts).toHaveLength(0);
  });
});
