import type { QueuedMutation } from "@/lib/offline/outbox";
import type { MealLog, MealTemplate, NutritionCheckin, NutritionSnapshot, NutritionTarget } from "./types";

const visible = new Set(["pending", "sending", "failed", "conflict"]);

export function projectLocalNutritionMutations(source: NutritionSnapshot, mutations: QueuedMutation[]): NutritionSnapshot {
  const view = { ...source, templates: [...source.templates], mealLogs: [...source.mealLogs], checkins: [...source.checkins] };
  for (const mutation of mutations) {
    if (!visible.has(mutation.status) || !isObject(mutation.payload)) continue;
    const payload = mutation.payload;
    const revision = mutation.expectedRevision + 1;
    if (mutation.entityType === "nutrition_target") {
      view.target = {
        id: mutation.recordId, calories: number(payload.calories, 0), protein_g: number(payload.protein_g, 0),
        carbs_g: number(payload.carbs_g, 0), fat_g: number(payload.fat_g, 0), effective_from: string(payload.effective_from, ""), revision,
      } satisfies NutritionTarget;
    }
    if (mutation.entityType === "meal_template") {
      view.templates = upsert(view.templates, {
        id: mutation.recordId, name: string(payload.name, "New meal"), meal_type: string(payload.meal_type, "snack") as MealTemplate["meal_type"],
        notes: nullableString(payload.notes, null), active: bool(payload.active, true), ingredients: [], revision,
      });
    }
    if (mutation.entityType === "meal_template_item") {
      const templateId = string(payload.template_id, "");
      const template = view.templates.find(({ id }) => id === templateId);
      if (template) {
        const ingredient = {
          id: mutation.recordId, name: string(payload.name, "Ingredient"), quantity: number(payload.quantity, 0), unit: string(payload.unit, "g"),
          calories: number(payload.calories, 0), protein_g: number(payload.protein_g, 0), carbs_g: number(payload.carbs_g, 0), fat_g: number(payload.fat_g, 0),
        };
        const ingredients = upsert(template.ingredients, ingredient);
        view.templates = view.templates.map((row) => row.id === templateId ? { ...row, ingredients } : row);
      }
    }
    if (mutation.entityType === "meal_template_item_archive") {
      view.templates = view.templates.map((template) => ({
        ...template,
        ingredients: template.ingredients.filter(({ id }) => id !== mutation.recordId),
      }));
    }
    if (mutation.entityType === "meal_log") {
      view.mealLogs = upsert(view.mealLogs, {
        id: mutation.recordId, local_date: string(payload.local_date, ""), logged_at: string(payload.logged_at, new Date(mutation.createdAt).toISOString()),
        meal_type: string(payload.meal_type, "snack") as MealLog["meal_type"], snapshot: payload.snapshot as unknown as MealLog["snapshot"],
        active: bool(payload.active, true), revision,
      });
    }
    if (mutation.entityType === "nutrition_checkin") {
      view.checkins = upsert(view.checkins, {
        id: mutation.recordId, local_date: string(payload.local_date, ""), body_weight: nullableNumber(payload.body_weight, null),
        weight_unit: nullableString(payload.weight_unit, null) as NutritionCheckin["weight_unit"], energy: nullableNumber(payload.energy, null),
        appetite: nullableNumber(payload.appetite, null), sleep_hours: nullableNumber(payload.sleep_hours, null), note: nullableString(payload.note, null), revision,
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
