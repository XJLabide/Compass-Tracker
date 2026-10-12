import type { StrengthProgram, StrengthProgramDay, WorkoutLog } from "./types";

export interface SuggestedSession {
  program: StrengthProgram;
  day: StrengthProgramDay;
}

export function findSuggestedSession(
  programs: StrengthProgram[],
  days: StrengthProgramDay[],
  weekday: number,
  today: string,
  workouts: Pick<WorkoutLog, "program_day_id" | "local_date">[] = [],
): SuggestedSession | null {
  const activePrograms = programs.filter(({ status }) => status === "active");
  const orderedDays = activePrograms.flatMap((program) =>
    days
      .filter(({ program_id }) => program_id === program.id)
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((day) => ({ program, day })),
  );
  const todayScheduled = orderedDays.find(({ day }) => day.weekday === weekday && !workouts.some((workout) => workout.program_day_id === day.id && workout.local_date === today));
  if (todayScheduled) return todayScheduled;
  const lastDone = new Map<string, string>();
  for (const workout of workouts) if (workout.program_day_id) lastDone.set(workout.program_day_id, workout.local_date > (lastDone.get(workout.program_day_id) ?? "") ? workout.local_date : lastDone.get(workout.program_day_id)!);
  const flexible = orderedDays.filter(({ day }) => day.weekday === null).sort((left, right) =>
    (lastDone.get(left.day.id) ?? "").localeCompare(lastDone.get(right.day.id) ?? "") || left.day.sort_order - right.day.sort_order,
  );
  return flexible[0] ?? null;
}

export function formatPace(distance: number, durationMinutes: number, unit: "km" | "mi"): string | null {
  if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
  const pace = durationMinutes / distance;
  const minutes = Math.floor(pace);
  const seconds = Math.round((pace - minutes) * 60);
  const adjustedMinutes = seconds === 60 ? minutes + 1 : minutes;
  return `${adjustedMinutes}:${String(seconds === 60 ? 0 : seconds).padStart(2, "0")} /${unit}`;
}
