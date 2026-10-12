export type GoalKind = "qualitative" | "measurable";
export type GoalStatus = "active" | "completed" | "archived";
export type GoalDirection = "increase" | "decrease";

export interface LifeArea {
  id: string;
  name: string;
  sort_order: number;
  is_archived: boolean;
  revision: number;
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  kind: GoalKind;
  status: GoalStatus;
  life_area_id: string | null;
  baseline_value: number | null;
  target_value: number | null;
  target_unit: string | null;
  direction: GoalDirection | null;
  due_date: string | null;
  sort_order: number;
  revision: number;
}

export interface GoalUpdate {
  id: string;
  goal_id: string;
  value: number | null;
  unit: string | null;
  note: string | null;
  source: string;
  measured_at: string;
  active: boolean;
  revision: number;
}

export interface GoalProjectLink {
  id: string;
  goal_id: string;
  project_id: string;
  active: boolean;
  revision: number;
}
