import type { MealIngredient, MealLogSnapshot, MealTemplateInput } from "./meals";

export interface NutritionTarget {
  id: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  effective_from: string;
  revision: number;
}

export interface MealTemplate extends MealTemplateInput {
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  notes: string | null;
  active: boolean;
  revision: number;
}

export interface MealTemplateItem extends MealIngredient {
  template_id: string;
  sort_order: number;
  revision: number;
}

export interface MealLog {
  id: string;
  local_date: string;
  logged_at: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  snapshot: MealLogSnapshot;
  active: boolean;
  revision: number;
}

export interface NutritionCheckin {
  id: string;
  local_date: string;
  body_weight: number | null;
  weight_unit: "kg" | "lb" | null;
  energy: number | null;
  appetite: number | null;
  sleep_hours: number | null;
  note: string | null;
  revision: number;
}

export interface NutritionSnapshot {
  target: NutritionTarget | null;
  templates: MealTemplate[];
  mealLogs: MealLog[];
  checkins: NutritionCheckin[];
}

export const emptyNutritionSnapshot: NutritionSnapshot = {
  target: null,
  templates: [],
  mealLogs: [],
  checkins: [],
};
