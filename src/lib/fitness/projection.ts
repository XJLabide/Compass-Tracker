import type { QueuedMutation } from "@/lib/offline/outbox";
import type { FitnessActivityLog, FitnessExercise, FitnessSnapshot, StrengthProgram, StrengthProgramExercise, WorkoutLog } from "./types";

const visible = new Set(["pending", "sending", "failed", "conflict"]);

export function projectLocalFitnessMutations(source: FitnessSnapshot, mutations: QueuedMutation[]): FitnessSnapshot {
  const view = {
    exercises: [...source.exercises], programs: [...source.programs], programDays: [...source.programDays],
    programExercises: [...source.programExercises], overrides: [...source.overrides], workouts: [...source.workouts], activities: [...source.activities],
  };
  for (const mutation of mutations) {
    if (!visible.has(mutation.status) || !isObject(mutation.payload)) continue;
    const payload = mutation.payload;
    const revision = mutation.expectedRevision + 1;
    if (mutation.entityType === "fitness_exercise") {
      view.exercises = upsert(view.exercises, {
        id: mutation.recordId, name: string(payload.name, "New exercise"), category: nullableString(payload.category, null),
        load_unit: string(payload.load_unit, "kg") as FitnessExercise["load_unit"], is_archived: bool(payload.is_archived, false), revision,
      });
    }
    if (mutation.entityType === "strength_program") {
      view.programs = upsert(view.programs, {
        id: mutation.recordId, title: string(payload.title, "New program"), notes: nullableString(payload.notes, null),
        status: string(payload.status, "active") as StrengthProgram["status"], revision,
      });
    }
    if (mutation.entityType === "strength_program_day") {
      view.programDays = upsert(view.programDays, {
        id: mutation.recordId, program_id: string(payload.program_id, ""), title: string(payload.title, "New session"),
        weekday: nullableNumber(payload.weekday, null), sort_order: number(payload.sort_order, view.programDays.length), revision,
      });
    }
    if (mutation.entityType === "strength_program_exercise") {
      view.programExercises = upsert(view.programExercises, {
        id: mutation.recordId, program_day_id: string(payload.program_day_id, ""), exercise_id: string(payload.exercise_id, ""),
        exercise_name: string(payload.exercise_name, "Exercise"), target_sets: number(payload.target_sets, 3), target_reps: number(payload.target_reps, 8),
        target_weight: nullableNumber(payload.target_weight, null), weight_unit: string(payload.weight_unit, "kg") as StrengthProgramExercise["weight_unit"],
        sort_order: number(payload.sort_order, view.programExercises.length), revision,
      });
    }
    if (mutation.entityType === "strength_override") {
      view.overrides = upsert(view.overrides, {
        id: mutation.recordId, program_day_id: string(payload.program_day_id, ""), local_date: string(payload.local_date, ""),
        title: nullableString(payload.title, null), notes: nullableString(payload.notes, null), skipped: bool(payload.skipped, false),
        exercises: Array.isArray(payload.exercises) ? payload.exercises as unknown as FitnessSnapshot["programExercises"] : null, revision,
      });
    }
    if (mutation.entityType === "workout_log") {
      view.workouts = upsert(view.workouts, {
        id: mutation.recordId, program_id: nullableString(payload.program_id, null), program_day_id: nullableString(payload.program_day_id, null),
        local_date: string(payload.local_date, ""), timezone: string(payload.timezone, "UTC"), title_snapshot: string(payload.title_snapshot, "Workout"),
        started_at: nullableString(payload.started_at, null),
        completed_at: string(payload.completed_at, new Date(mutation.createdAt).toISOString()), notes: nullableString(payload.notes, null),
        exercises: Array.isArray(payload.exercises) ? payload.exercises as unknown as WorkoutLog["exercises"] : [],
        status: string(payload.status, "logged") as WorkoutLog["status"], revision,
      });
    }
    if (mutation.entityType === "fitness_activity_log") {
      view.activities = upsert(view.activities, {
        id: mutation.recordId, activity_kind: string(payload.activity_kind, "run") as FitnessActivityLog["activity_kind"],
        local_date: string(payload.local_date, ""), title: string(payload.title, "Activity"), sport: nullableString(payload.sport, null),
        duration_minutes: number(payload.duration_minutes, 0), distance: nullableNumber(payload.distance, null),
        distance_unit: nullableString(payload.distance_unit, null) as FitnessActivityLog["distance_unit"],
        intensity: nullableString(payload.intensity, null) as FitnessActivityLog["intensity"], notes: nullableString(payload.notes, null), revision,
      });
    }
  }
  return view;
}

function upsert<T extends { id: string }>(rows: T[], item: T): T[] {
  return rows.some(({ id }) => id === item.id) ? rows.map((row) => row.id === item.id ? item : row) : [...rows, item];
}
function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function string(value: unknown, fallback: string): string { return typeof value === "string" ? value : fallback; }
function nullableString(value: unknown, fallback: string | null): string | null { return value === null ? null : typeof value === "string" ? value : fallback; }
function number(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function nullableNumber(value: unknown, fallback: number | null): number | null { return value === null ? null : typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function bool(value: unknown, fallback: boolean): boolean { return typeof value === "boolean" ? value : fallback; }
