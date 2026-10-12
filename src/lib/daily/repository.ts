import type { SupabaseClient } from "@supabase/supabase-js";
import { cacheRecord, readCachedRecord, type JsonValue } from "@/lib/offline/outbox";
import { dueRoutineIds } from "./rules";
import type { DailyPlan, DailySnapshot, Priority, PriorityTaskLink, Profile, Routine, RoutineLog, Task } from "./types";

export function defaultProfile(userId: string, timeZone = "UTC"): Profile {
  return {
    user_id: userId,
    display_name: null,
    timezone: timeZone,
    units: "metric",
    appearance: "system",
    revision: 1,
  };
}

export function localToday(timeZone: string): string {
  const values = new Map(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date()).map(({ type, value }) => [type, value]),
  );
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function shiftLocalDate(localDate: string, days: number): string {
  const date = new Date(`${localDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function loadProfile(client: SupabaseClient, userId: string): Promise<Profile> {
  const { data, error } = await client.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Profile | null) ?? defaultProfile(userId, Intl.DateTimeFormat().resolvedOptions().timeZone);
}

export async function loadDailySnapshot(
  client: SupabaseClient,
  database: IDBDatabase,
  localDate: string,
): Promise<{ snapshot: DailySnapshot; offline: boolean }> {
  try {
    const { data: planData, error: planError } = await client
      .from("daily_plans")
      .select("*")
      .eq("local_date", localDate)
      .maybeSingle();
    if (planError) throw new Error(planError.message);
    const plan = planData as DailyPlan | null;

    const [priorityRows, taskRows, routineRows, routineLogRows] = await Promise.all([
      plan
        ? client.from("priorities").select("*").eq("daily_plan_id", plan.id).eq("state", "active").order("rank")
        : Promise.resolve({ data: [] as Priority[], error: null }),
      client.from("tasks").select("*").order("sort_order").order("created_at", { ascending: false }).limit(100),
      client.from("routines").select("*").eq("active", true).order("sort_order"),
      client.from("routine_logs").select("*").eq("local_date", localDate),
    ]);

    for (const result of [priorityRows, taskRows, routineRows, routineLogRows]) {
      if (result.error) throw new Error(result.error.message);
    }

    const priorities = (priorityRows.data ?? []) as Priority[];
    const allTasks = (taskRows.data ?? []) as Task[];
    const routineCandidates = (routineRows.data ?? []) as Routine[];
    const routineIds = new Set(dueRoutineIds(
      routineCandidates.map(({ id, days_of_week }) => ({ id, daysOfWeek: days_of_week })),
      localDate,
    ));
    const routines = routineCandidates.filter(({ id }) => routineIds.has(id));
    const routineLogs = (routineLogRows.data ?? []) as RoutineLog[];
    let priorityTaskLinks: PriorityTaskLink[] = [];

    if (priorities.length > 0) {
      const { data, error } = await client
        .from("priority_task_links")
        .select("*")
        .eq("active", true)
        .in("priority_id", priorities.map(({ id }) => id));
      if (error) throw new Error(error.message);
      priorityTaskLinks = (data ?? []) as PriorityTaskLink[];
    }

    const snapshot: DailySnapshot = {
      plan,
      priorities,
      tasks: allTasks,
      priorityTaskLinks,
      routines,
      routineLogs,
    };
    await cacheRecord(database, {
      id: dailySnapshotKey(localDate),
      revision: plan?.revision ?? 0,
      payload: snapshot as unknown as JsonValue,
      cachedAt: Date.now(),
    });
    return { snapshot, offline: false };
  } catch (error) {
    const cached = await readCachedRecord(database, dailySnapshotKey(localDate));
    if (cached) return { snapshot: cached.payload as unknown as DailySnapshot, offline: true };
    throw error;
  }
}

export function dailySnapshotKey(localDate: string): string {
  return `daily-snapshot:${localDate}`;
}

export function getTaskLinksForPriority(
  links: PriorityTaskLink[],
  priorityId: string,
): string[] {
  return links.filter((link) => link.active && link.priority_id === priorityId).map((link) => link.task_id);
}

export function getRoutineLogForDate(
  logs: RoutineLog[],
  routineId: string,
  localDate: string,
): RoutineLog | undefined {
  return logs.find((log) => log.routine_id === routineId && log.local_date === localDate);
}
