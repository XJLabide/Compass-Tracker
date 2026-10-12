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
            { weight: 60, reps: 5 },
            { weight: 70, reps: 3 },
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
            { weight: 55, reps: 5 },
            { weight: 75, reps: 3 },
          ],
        }],
      },
    ]);

    expect(history).toEqual([{
      exercise_id: "squat",
      exercise_name: "Back squat",
      sessions: [
        { workout_id: "workout-1", date: "2026-10-01", estimated_one_rep_max: 77, records: [
          { weight: 60, reps: 5, estimated_one_rep_max: 70 },
          { weight: 70, reps: 3, estimated_one_rep_max: 77 },
        ] },
        { workout_id: "workout-2", date: "2026-10-03", estimated_one_rep_max: 82.5, records: [
          { weight: 75, reps: 3, estimated_one_rep_max: 82.5 },
        ] },
      ],
    }]);
  });

  it("rejects invalid loads and unsupported rep ranges", () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
    expect(estimateOneRepMax(100, 10)).toBeCloseTo(133.33, 2);
    expect(estimateOneRepMax(0, 5)).toBeNull();
    expect(estimateOneRepMax(100, 0)).toBeNull();
    expect(estimateOneRepMax(100, 13)).toBeNull();
  });
});
