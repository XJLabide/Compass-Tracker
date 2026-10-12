import type { JsonValue } from "@/lib/offline/outbox";
import type { PriorityOutcome } from "./rules";

export type Appearance = "system" | "light" | "dark";
export type Units = "metric" | "imperial";
export type DailyPlanStatus = "draft" | "active" | "backfill" | "ended";
export type TaskStatus = "open" | "done" | "archived";

export interface Profile {
  user_id: string;
  display_name: string | null;
  timezone: string;
  units: Units;
  appearance: Appearance;
  revision: number;
}

export interface DailyPlan {
  id: string;
  user_id: string;
  local_date: string;
  timezone: string;
  status: DailyPlanStatus;
  reflection: string | null;
  started_at: string | null;
  ended_at: string | null;
  revision: number;
}

export interface Priority {
  id: string;
  daily_plan_id: string;
  rank: number;
  title: string;
  outcome: PriorityOutcome | null;
  state: "active" | "archived";
  revision: number;
}

export interface Task {
  id: string;
  title: string;
  details: string | null;
  due_date: string | null;
  status: TaskStatus;
  completed_at: string | null;
  sort_order: number;
  revision: number;
}

export interface PriorityTaskLink {
  id: string;
  priority_id: string;
  task_id: string;
  active: boolean;
  revision: number;
}

export interface Routine {
  id: string;
  title: string;
  days_of_week: number[];
  time_label: string | null;
  active: boolean;
  sort_order: number;
  revision: number;
}

export interface RoutineLog {
  id: string;
  routine_id: string;
  local_date: string;
  completed: boolean;
  completed_at: string | null;
  note: string | null;
  revision: number;
}

export interface DailySnapshot {
  plan: DailyPlan | null;
  priorities: Priority[];
  tasks: Task[];
  priorityTaskLinks: PriorityTaskLink[];
  routines: Routine[];
  routineLogs: RoutineLog[];
}

export interface DailyMutationInput {
  entityType: "profile" | "daily_plan" | "priority" | "priority_task_link" | "task" | "routine" | "routine_log" | "end_day";
  recordId: string;
  expectedRevision: number;
  payload: JsonValue;
  operation?: "upsert" | "link" | "unlink";
}
