import { describe, expect, it } from "vitest";
import { summarizeGoalProgress } from "./rules";

describe("summarizeGoalProgress", () => {
  it("calculates measurable progress in the configured direction", () => {
    expect(summarizeGoalProgress(
      { kind: "measurable", baseline_value: 10, target_value: 20, direction: "increase" },
      [
        { value: 12, note: null, source: "Scale", measured_at: "2026-10-10T08:00:00Z" },
        { value: 14, note: null, source: "Scale", measured_at: "2026-10-12T08:00:00Z" },
      ],
    )).toEqual({ latestValue: 14, latestNote: null, change: 2, percentToTarget: 40, source: "Scale" });
  });

  it("supports targets that move downward without reporting false progress", () => {
    expect(summarizeGoalProgress(
      { kind: "measurable", baseline_value: 90, target_value: 50, direction: "decrease" },
      [{ value: 70, note: null, source: "Manual", measured_at: "2026-10-12T08:00:00Z" }],
    )).toMatchObject({ latestValue: 70, change: null, percentToTarget: 50 });
  });

  it("uses the first recorded measurement as a baseline when the goal has no starting value", () => {
    expect(summarizeGoalProgress(
      { kind: "measurable", baseline_value: null, target_value: 10, direction: "increase" },
      [
        { value: 3, note: null, source: "Counter", measured_at: "2026-10-10T08:00:00Z" },
        { value: 4, note: null, source: "Counter", measured_at: "2026-10-12T08:00:00Z" },
      ],
    )).toMatchObject({ latestValue: 4, percentToTarget: 14, change: 1 });
  });

  it("keeps qualitative progress descriptive instead of inventing a numeric score", () => {
    expect(summarizeGoalProgress(
      { kind: "qualitative", baseline_value: null, target_value: null, direction: null },
      [{ value: null, note: "Asked for feedback and set a boundary", source: "Weekly reflection", measured_at: "2026-10-12T08:00:00Z" }],
    )).toEqual({
      latestValue: null,
      latestNote: "Asked for feedback and set a boundary",
      change: null,
      percentToTarget: null,
      source: "Weekly reflection",
    });
  });
});
