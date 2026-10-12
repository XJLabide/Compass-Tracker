import type { QueuedMutation } from "@/lib/offline/outbox";
import type { DailyPlan, DailySnapshot, Priority, PriorityTaskLink, Routine, RoutineLog, Task } from "./types";

const locallyVisibleStates = new Set(["pending", "sending", "failed", "conflict"]);

export function projectLocalDailyMutations(
  source: DailySnapshot,
  mutations: QueuedMutation[],
  localDate: string,
): DailySnapshot {
  const view: DailySnapshot = {
    ...source,
    priorities: [...source.priorities],
    tasks: [...source.tasks],
    priorityTaskLinks: [...source.priorityTaskLinks],
    routines: [...source.routines],
    routineLogs: [...source.routineLogs],
  };

  for (const mutation of mutations) {
    if (!locallyVisibleStates.has(mutation.status) || !isObject(mutation.payload)) continue;
    const payload = mutation.payload;
    const nextRevision = mutation.expectedRevision + 1;

    if (mutation.entityType === "daily_plan" && payload.local_date === localDate) {
      view.plan = {
        ...(view.plan ?? {
          id: mutation.recordId,
          user_id: "",
          local_date: localDate,
          timezone: stringValue(payload.timezone, "UTC"),
          reflection: null,
          started_at: null,
          ended_at: null,
        }),
        id: mutation.recordId,
        local_date: localDate,
        timezone: stringValue(payload.timezone, view.plan?.timezone ?? "UTC"),
        status: stringValue(payload.status, view.plan?.status ?? "draft") as DailyPlan["status"],
        reflection: nullableString(payload.reflection, view.plan?.reflection ?? null),
        started_at: nullableString(payload.started_at, view.plan?.started_at ?? null),
        ended_at: nullableString(payload.ended_at, view.plan?.ended_at ?? null),
        revision: nextRevision,
      };
    }

    if (mutation.entityType === "priority" && view.plan?.id === payload.daily_plan_id) {
      const existing = view.priorities.find(({ id }) => id === mutation.recordId);
      const projected: Priority = {
        id: mutation.recordId,
        daily_plan_id: view.plan.id,
        rank: numberValue(payload.rank, existing?.rank ?? 1),
        title: stringValue(payload.title, existing?.title ?? ""),
        outcome: nullableOutcome(payload.outcome, existing?.outcome ?? null),
        state: stringValue(payload.state, existing?.state ?? "active") as Priority["state"],
        revision: nextRevision,
      };
      view.priorities = existing
        ? view.priorities.map((priority) => priority.id === projected.id ? projected : priority)
        : [...view.priorities, projected].sort((left, right) => left.rank - right.rank);
    }

    if (mutation.entityType === "task") {
      const existing = view.tasks.find(({ id }) => id === mutation.recordId);
      const status = stringValue(payload.status, existing?.status ?? "open") as Task["status"];
      const projected: Task = {
        id: mutation.recordId,
        title: stringValue(payload.title, existing?.title ?? "New task"),
        details: nullableString(payload.details, existing?.details ?? null),
        due_date: nullableString(payload.due_date, existing?.due_date ?? null),
        status,
        completed_at: status === "done" ? (existing?.completed_at ?? new Date(mutation.createdAt).toISOString()) : null,
        sort_order: numberValue(payload.sort_order, existing?.sort_order ?? 0),
        revision: nextRevision,
      };
      view.tasks = existing
        ? view.tasks.map((task) => task.id === projected.id ? projected : task)
        : [...view.tasks, projected];
    }

    if (mutation.entityType === "priority_task_link") {
      const existing = view.priorityTaskLinks.find(({ id }) => id === mutation.recordId);
      const projected: PriorityTaskLink = {
        id: mutation.recordId,
        priority_id: stringValue(payload.priority_id, existing?.priority_id ?? ""),
        task_id: stringValue(payload.task_id, existing?.task_id ?? ""),
        active: payload.active === undefined ? (existing?.active ?? true) : Boolean(payload.active),
        revision: nextRevision,
      };
      view.priorityTaskLinks = existing
        ? view.priorityTaskLinks.map((link) => link.id === projected.id ? projected : link)
        : [...view.priorityTaskLinks, projected];
    }

    if (mutation.entityType === "routine") {
      const existing = view.routines.find(({ id }) => id === mutation.recordId);
      const projected: Routine = {
        id: mutation.recordId,
        title: stringValue(payload.title, existing?.title ?? "New routine"),
        days_of_week: numberArray(payload.days_of_week, existing?.days_of_week ?? []),
        time_label: nullableString(payload.time_label, existing?.time_label ?? null),
        active: payload.active === undefined ? (existing?.active ?? true) : Boolean(payload.active),
        sort_order: numberValue(payload.sort_order, existing?.sort_order ?? 0),
        revision: nextRevision,
      };
      view.routines = existing
        ? view.routines.map((routine) => routine.id === projected.id ? projected : routine)
        : [...view.routines, projected];
    }

    if (mutation.entityType === "routine_log" && payload.local_date === localDate) {
      const existing = view.routineLogs.find(({ id }) => id === mutation.recordId);
      const completed = payload.completed === undefined ? (existing?.completed ?? false) : Boolean(payload.completed);
      const projected: RoutineLog = {
        id: mutation.recordId,
        routine_id: stringValue(payload.routine_id, existing?.routine_id ?? ""),
        local_date: localDate,
        completed,
        completed_at: completed ? (existing?.completed_at ?? new Date(mutation.createdAt).toISOString()) : null,
        note: nullableString(payload.note, existing?.note ?? null),
        revision: nextRevision,
      };
      view.routineLogs = existing
        ? view.routineLogs.map((log) => log.id === projected.id ? projected : log)
        : [...view.routineLogs, projected];
    }

    if (mutation.entityType === "end_day" && view.plan?.id === mutation.recordId) {
      const outcomes = Array.isArray(payload.outcomes) ? payload.outcomes : [];
      view.priorities = view.priorities.map((priority) => {
        const row = outcomes.find((entry) => isObject(entry) && entry.priority_id === priority.id);
        return row && isObject(row) && typeof row.outcome === "string"
          ? { ...priority, outcome: row.outcome as Priority["outcome"] }
          : priority;
      });
      view.plan = {
        ...view.plan,
        status: "ended",
        reflection: nullableString(payload.reflection, null),
        ended_at: new Date(mutation.createdAt).toISOString(),
        revision: nextRevision,
      };
    }
  }

  return view;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown, fallback: string | null): string | null {
  return value === null ? null : typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberArray(value: unknown, fallback: number[]): number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "number")
    ? value as number[]
    : fallback;
}

function nullableOutcome(value: unknown, fallback: Priority["outcome"]): Priority["outcome"] {
  return value === null ? null : typeof value === "string" ? value as Priority["outcome"] : fallback;
}
