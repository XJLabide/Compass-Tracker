export interface GoalProgressEntry {
  value: number | null;
  note: string | null;
  source: string;
  measured_at: string;
}

export interface MeasurableGoalProgress {
  kind: "measurable" | "qualitative";
  baseline_value: number | null;
  target_value: number | null;
  direction: "increase" | "decrease" | null;
}

export interface GoalProgressSummary {
  latestValue: number | null;
  latestNote: string | null;
  change: number | null;
  percentToTarget: number | null;
  source: string | null;
}

export function summarizeGoalProgress(
  goal: MeasurableGoalProgress,
  entries: GoalProgressEntry[],
): GoalProgressSummary {
  const sorted = entries
    .filter((entry) => Number.isFinite(Date.parse(entry.measured_at)))
    .slice()
    .sort((left, right) => Date.parse(left.measured_at) - Date.parse(right.measured_at));
  const latest = sorted.at(-1);
  const previous = sorted.at(-2);
  const latestValue = latest?.value ?? null;
  const change = latest?.value !== null && latest?.value !== undefined
    && previous?.value !== null && previous?.value !== undefined
    ? latest.value - previous.value
    : null;

  return {
    latestValue,
    latestNote: latest?.note ?? null,
    change,
    percentToTarget: progressPercent(goal, latestValue, sorted[0]?.value ?? null),
    source: latest?.source ?? null,
  };
}

function progressPercent(goal: MeasurableGoalProgress, latestValue: number | null, firstRecordedValue: number | null): number | null {
  const baseline = goal.baseline_value ?? firstRecordedValue;
  const target = goal.target_value;
  if (goal.kind !== "measurable" || latestValue === null || baseline === null || target === null || !goal.direction) {
    return null;
  }

  const distanceToTarget = goal.direction === "increase" ? target - baseline : baseline - target;
  if (distanceToTarget <= 0) return null;

  const progress = goal.direction === "increase"
    ? (latestValue - baseline) / distanceToTarget
    : (baseline - latestValue) / distanceToTarget;
  return Math.round(Math.min(1, Math.max(0, progress)) * 100);
}
