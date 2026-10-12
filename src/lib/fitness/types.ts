import type { LoggedStrengthExercise, LoggedStrengthSet } from "./records";

export type FitnessActivityKind = "run" | "sport";
export type WorkoutLogStatus = "logged" | "void";

export interface FitnessExercise {
  id: string;
  name: string;
  category: string | null;
  load_unit: "kg" | "lb";
  is_archived: boolean;
  revision: number;
}

export interface StrengthProgram {
  id: string;
  title: string;
  notes: string | null;
  status: "active" | "archived";
  revision: number;
}

export interface StrengthProgramDay {
  id: string;
  program_id: string;
  title: string;
  weekday: number | null;
  sort_order: number;
  revision: number;
}

export interface StrengthProgramExercise {
  id: string;
  program_day_id: string;
  exercise_id: string;
  exercise_name: string;
  target_sets: number;
  target_reps: number;
  target_weight: number | null;
  weight_unit: "kg" | "lb";
  sort_order: number;
  revision: number;
}

export interface StrengthSessionOverride {
  id: string;
  program_day_id: string;
  local_date: string;
  title: string | null;
  notes: string | null;
  skipped: boolean;
  exercises: StrengthProgramExercise[] | null;
  revision: number;
}

export interface WorkoutLog {
  id: string;
  program_id: string | null;
  program_day_id: string | null;
  local_date: string;
  timezone: string;
  title_snapshot: string;
  started_at: string | null;
  completed_at: string;
  notes: string | null;
  exercises: LoggedStrengthExercise[];
  status: WorkoutLogStatus;
  revision: number;
}

export interface WorkoutDraft {
  id: string;
  program_id: string | null;
  program_day_id: string | null;
  local_date: string;
  timezone: string;
  title_snapshot: string;
  started_at: string;
  notes: string;
  exercises: Array<Omit<LoggedStrengthExercise, "sets"> & { skipped?: boolean; sets: Array<LoggedStrengthSet & { skipped?: boolean }> }>;
}

export interface FitnessActivityLog {
  id: string;
  activity_kind: FitnessActivityKind;
  local_date: string;
  title: string;
  sport: string | null;
  duration_minutes: number;
  distance: number | null;
  distance_unit: "km" | "mi" | null;
  intensity: "easy" | "moderate" | "hard" | null;
  notes: string | null;
  revision: number;
}

export interface FitnessSnapshot {
  exercises: FitnessExercise[];
  programs: StrengthProgram[];
  programDays: StrengthProgramDay[];
  programExercises: StrengthProgramExercise[];
  overrides: StrengthSessionOverride[];
  workouts: WorkoutLog[];
  activities: FitnessActivityLog[];
}

export const emptyFitnessSnapshot: FitnessSnapshot = {
  exercises: [],
  programs: [],
  programDays: [],
  programExercises: [],
  overrides: [],
  workouts: [],
  activities: [],
};
