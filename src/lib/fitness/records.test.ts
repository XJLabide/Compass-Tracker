import { describe, expect, it } from "vitest";
import { buildExerciseHistory, estimateOneRepMax } from "./records";

describe("strength records derived from logged sets", () => {
  it("tracks per-rep personal records and daily estimated one-rep max history", () => {
    const history = buildExerciseHistory([
      {
        id: "workout-1",
        completed_at: "2026-10-01T09:00:00.000Z",
        exercises: [{
          exercise_id: "squat",
          exercise_name: "Back squat",
          sets: [
            { weight: 60, reps: 5, weight_unit: "kg" },
            { weight: 70, reps: 3, weight_unit: "kg" },
          ],
        }],
      },
      {
        id: "workout-2",
        completed_at: "2026-10-03T09:00:00.000Z",
        exercises: [{
          exercise_id: "squat",
          exercise_name: "Back squat",
          sets: [
            { weight: 55, reps: 5, weight_unit: "kg" },
            { weight: 75, reps: 3, weight_unit: "kg" },
          ],
        }],
      },
    ]);

    expect(history).toEqual([{
      exercise_id: "squat",
      exercise_name: "Back squat",
      weight_unit: "kg",
      sessions: [
        { workout_id: "workout-1", date: "2026-10-01", estimated_one_rep_max: 77, records: [
          { weight: 60, reps: 5, weight_unit: "kg", estimated_one_rep_max: 70 },
          { weight: 70, reps: 3, weight_unit: "kg", estimated_one_rep_max: 77 },
        ] },
        { workout_id: "workout-2", date: "2026-10-03", estimated_one_rep_max: 82.5, records: [
          { weight: 75, reps: 3, weight_unit: "kg", estimated_one_rep_max: 82.5 },
        ] },
      ],
    }]);
  });

  it("normalizes mixed recorded units before comparing load PRs and e1RM", () => {
    const history = buildExerciseHistory([
      { id: "metric", completed_at: "2026-10-01T09:00:00.000Z", exercises: [{ exercise_id: "press", exercise_name: "Press", sets: [{ weight: 60, reps: 5, weight_unit: "kg" }] }] },
      { id: "imperial", completed_at: "2026-10-03T09:00:00.000Z", exercises: [{ exercise_id: "press", exercise_name: "Press", sets: [{ weight: 140, reps: 5, weight_unit: "lb" }] }] },
    ], "kg");

    expect(history[0].sessions[1].records[0].weight).toBe(63.5);
    expect(history[0].sessions[1].records[0].weight_unit).toBe("kg");
    expect(history[0].sessions[1].estimated_one_rep_max).toBe(74.08);
  });

  it("rejects invalid loads and unsupported rep ranges", () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
    expect(estimateOneRepMax(100, 10)).toBeCloseTo(133.33, 2);
    expect(estimateOneRepMax(0, 5)).toBeNull();
    expect(estimateOneRepMax(100, 0)).toBeNull();
    expect(estimateOneRepMax(100, 13)).toBeNull();
  });
});
