import type { SupabaseClient } from "@supabase/supabase-js";
import { cacheRecord, readCachedRecord, type JsonValue } from "@/lib/offline/outbox";
import type { LocalCalendarEvent, ExternalCalendar, ImportedCalendarEvent } from "@/lib/calendar/types";
import type { Goal, GoalProjectLink, GoalUpdate, LifeArea } from "@/lib/goals/types";
import type { Project, ProjectStage, ProjectTaskLink } from "@/lib/projects/types";
import type { Task } from "@/lib/daily/types";
import type { FitnessSnapshot } from "@/lib/fitness/types";
import type { MealTemplateItem, NutritionSnapshot } from "@/lib/nutrition/types";
import { emptyPlanningSnapshot, type PlanningSnapshot } from "./types";

export async function loadPlanningSnapshot(
  client: SupabaseClient,
  database: IDBDatabase,
  from: string,
  through: string,
): Promise<{ snapshot: PlanningSnapshot; offline: boolean }> {
  const cacheId = planningSnapshotKey(from, through);
  try {
    const results = await Promise.all([
      client.from("calendar_events").select("*").eq("status", "active").lt("starts_at", through).gt("ends_at", from).order("starts_at"),
      client.from("external_calendars").select("*").order("name"),
      client.from("external_calendar_events").select("*").lt("starts_at", through).gt("ends_at", from).order("starts_at"),
      client.from("projects").select("*").order("sort_order").order("created_at"),
      client.from("project_stages").select("*").order("sort_order"),
      client.from("project_task_links").select("*").eq("active", true).order("sort_order"),
      client.from("tasks").select("*").order("sort_order").order("created_at", { ascending: false }).limit(1000),
      client.from("life_areas").select("*").order("sort_order").order("name"),
      client.from("goals").select("*").order("sort_order").order("created_at"),
      client.from("goal_updates").select("*").eq("active", true).order("measured_at", { ascending: false }).limit(2000),
      client.from("goal_project_links").select("*").eq("active", true),
    ]);
    const error = results.find((result) => result.error)?.error;
    if (error) throw new Error(error.message);

    const externalCalendars = (results[1].data ?? []) as ExternalCalendar[];
    const selectedIds = new Set(externalCalendars.filter(({ selected }) => selected).map(({ id }) => id));
    const snapshot: PlanningSnapshot = {
      calendarEvents: (results[0].data ?? []) as LocalCalendarEvent[],
      externalCalendars,
      importedCalendarEvents: (results[2].data ?? []).filter((event) => selectedIds.has(event.external_calendar_id)) as ImportedCalendarEvent[],
      projects: (results[3].data ?? []) as Project[],
      projectStages: (results[4].data ?? []) as ProjectStage[],
      projectTaskLinks: (results[5].data ?? []) as ProjectTaskLink[],
      tasks: (results[6].data ?? []) as Task[],
      lifeAreas: (results[7].data ?? []) as LifeArea[],
      goals: (results[8].data ?? []) as Goal[],
      goalUpdates: (results[9].data ?? []) as GoalUpdate[],
      goalProjectLinks: (results[10].data ?? []) as GoalProjectLink[],
    };
    await cacheRecord(database, {
      id: cacheId,
      revision: 1,
      payload: snapshot as unknown as JsonValue,
      cachedAt: Date.now(),
    });
    return { snapshot, offline: false };
  } catch (error) {
    const cached = await readCachedRecord(database, cacheId);
    if (cached) return { snapshot: cached.payload as unknown as PlanningSnapshot, offline: true };
    throw error;
  }
}

export function planningSnapshotKey(from: string, through: string): string {
  return `planning-snapshot:${from}:${through}`;
}

export async function loadFitnessSnapshot(
  client: SupabaseClient,
  database: IDBDatabase,
): Promise<{ snapshot: FitnessSnapshot; offline: boolean }> {
  const cacheId = "health-snapshot:fitness";
  try {
    const results = await Promise.all([
      client.from("fitness_exercises").select("*").order("name"),
      client.from("strength_programs").select("*").order("created_at", { ascending: false }),
      client.from("strength_program_days").select("*").order("sort_order"),
      client.from("strength_program_exercises").select("*").order("sort_order"),
      client.from("strength_session_overrides").select("*").order("local_date", { ascending: false }),
      client.from("workout_logs").select("*").eq("status", "logged").order("completed_at", { ascending: false }).limit(2000),
      client.from("fitness_activity_logs").select("*").order("local_date", { ascending: false }).limit(2000),
    ]);
    const error = results.find((result) => result.error)?.error;
    if (error) throw new Error(error.message);
    const snapshot: FitnessSnapshot = {
      exercises: (results[0].data ?? []) as FitnessSnapshot["exercises"],
      programs: (results[1].data ?? []) as FitnessSnapshot["programs"],
      programDays: (results[2].data ?? []) as FitnessSnapshot["programDays"],
      programExercises: (results[3].data ?? []) as FitnessSnapshot["programExercises"],
      overrides: (results[4].data ?? []) as FitnessSnapshot["overrides"],
      workouts: (results[5].data ?? []) as FitnessSnapshot["workouts"],
      activities: (results[6].data ?? []) as FitnessSnapshot["activities"],
    };
    await cacheRecord(database, { id: cacheId, revision: 1, payload: snapshot as unknown as JsonValue, cachedAt: Date.now() });
    return { snapshot, offline: false };
  } catch (error) {
    const cached = await readCachedRecord(database, cacheId);
    if (cached) return { snapshot: cached.payload as unknown as FitnessSnapshot, offline: true };
    throw error;
  }
}

export async function loadNutritionSnapshot(
  client: SupabaseClient,
  database: IDBDatabase,
  localDate: string,
): Promise<{ snapshot: NutritionSnapshot; offline: boolean }> {
  const cacheId = `health-snapshot:nutrition:${localDate}`;
  const firstDay = new Date(`${localDate}T00:00:00.000Z`);
  firstDay.setUTCDate(firstDay.getUTCDate() - 30);
  const fromDate = firstDay.toISOString().slice(0, 10);
  try {
    const results = await Promise.all([
      client.from("nutrition_targets").select("*").lte("effective_from", localDate).order("effective_from", { ascending: false }).limit(1),
      client.from("meal_templates").select("*").eq("active", true).order("name"),
      client.from("meal_template_items").select("*").eq("is_archived", false).order("sort_order"),
      client.from("meal_logs").select("*").eq("active", true).gte("local_date", fromDate).lte("local_date", localDate).order("logged_at", { ascending: false }).limit(500),
      client.from("nutrition_checkins").select("*").gte("local_date", fromDate).lte("local_date", localDate).order("local_date", { ascending: false }),
    ]);
    const error = results.find((result) => result.error)?.error;
    if (error) throw new Error(error.message);
    const items = (results[2].data ?? []) as MealTemplateItem[];
    const snapshot: NutritionSnapshot = {
      target: ((results[0].data ?? [])[0] ?? null) as NutritionSnapshot["target"],
      templates: ((results[1].data ?? []) as NutritionSnapshot["templates"]).map((template) => ({
        ...template,
        ingredients: items.filter((item) => item.template_id === template.id).map((item) => ({
          id: item.id, name: item.name, quantity: item.quantity, unit: item.unit, calories: item.calories,
          protein_g: item.protein_g, carbs_g: item.carbs_g, fat_g: item.fat_g, revision: item.revision, sort_order: item.sort_order,
        })),
      })),
      mealLogs: (results[3].data ?? []) as NutritionSnapshot["mealLogs"],
      checkins: (results[4].data ?? []) as NutritionSnapshot["checkins"],
    };
    await cacheRecord(database, { id: cacheId, revision: 1, payload: snapshot as unknown as JsonValue, cachedAt: Date.now() });
    return { snapshot, offline: false };
  } catch (error) {
    const cached = await readCachedRecord(database, cacheId);
    if (cached) return { snapshot: cached.payload as unknown as NutritionSnapshot, offline: true };
    throw error;
  }
}

export async function loadProjectsSnapshot(
  client: SupabaseClient,
  database: IDBDatabase,
): Promise<{ snapshot: PlanningSnapshot; offline: boolean }> {
  const cacheId = "planning-snapshot:projects";
  try {
    const results = await Promise.all([
      client.from("projects").select("*").order("sort_order").order("created_at"),
      client.from("project_stages").select("*").order("sort_order"),
      client.from("project_task_links").select("*").order("sort_order"),
      client.from("tasks").select("*").order("sort_order").order("created_at", { ascending: false }).limit(1000),
    ]);
    const error = results.find((result) => result.error)?.error;
    if (error) throw new Error(error.message);
    const snapshot = {
      ...emptyPlanningSnapshot,
      projects: (results[0].data ?? []) as Project[],
      projectStages: (results[1].data ?? []) as ProjectStage[],
      projectTaskLinks: (results[2].data ?? []) as ProjectTaskLink[],
      tasks: (results[3].data ?? []) as Task[],
    };
    await cacheRecord(database, { id: cacheId, revision: 1, payload: snapshot as unknown as JsonValue, cachedAt: Date.now() });
    return { snapshot, offline: false };
  } catch (error) {
    const cached = await readCachedRecord(database, cacheId);
    if (cached) return { snapshot: cached.payload as unknown as PlanningSnapshot, offline: true };
    throw error;
  }
}

export async function loadGoalsSnapshot(
  client: SupabaseClient,
  database: IDBDatabase,
): Promise<{ snapshot: PlanningSnapshot; offline: boolean }> {
  const cacheId = "planning-snapshot:goals";
  try {
    const results = await Promise.all([
      client.from("life_areas").select("*").order("sort_order").order("name"),
      client.from("goals").select("*").order("sort_order").order("created_at"),
      client.from("goal_updates").select("*").eq("active", true).order("measured_at", { ascending: false }).limit(2000),
      client.from("goal_project_links").select("*").order("created_at"),
      client.from("projects").select("*").order("title"),
    ]);
    const error = results.find((result) => result.error)?.error;
    if (error) throw new Error(error.message);
    const snapshot = {
      ...emptyPlanningSnapshot,
      lifeAreas: (results[0].data ?? []) as LifeArea[],
      goals: (results[1].data ?? []) as Goal[],
      goalUpdates: (results[2].data ?? []) as GoalUpdate[],
      goalProjectLinks: (results[3].data ?? []) as GoalProjectLink[],
      projects: (results[4].data ?? []) as Project[],
    };
    await cacheRecord(database, { id: cacheId, revision: 1, payload: snapshot as unknown as JsonValue, cachedAt: Date.now() });
    return { snapshot, offline: false };
  } catch (error) {
    const cached = await readCachedRecord(database, cacheId);
    if (cached) return { snapshot: cached.payload as unknown as PlanningSnapshot, offline: true };
    throw error;
  }
}
