import type { QueuedMutation } from "@/lib/offline/outbox";
import type { PlanningSnapshot } from "./types";
import type { LocalCalendarEvent } from "@/lib/calendar/types";
import type { Goal, GoalProjectLink, GoalUpdate, LifeArea } from "@/lib/goals/types";
import type { Project, ProjectStage, ProjectTaskLink } from "@/lib/projects/types";
import type { Task } from "@/lib/daily/types";

const visibleStatuses = new Set(["pending", "sending", "failed", "conflict"]);

export function projectLocalPlanningMutations(
  source: PlanningSnapshot,
  mutations: QueuedMutation[],
): PlanningSnapshot {
  const view: PlanningSnapshot = {
    ...source,
    calendarEvents: [...source.calendarEvents],
    externalCalendars: [...source.externalCalendars],
    importedCalendarEvents: [...source.importedCalendarEvents],
    projects: [...source.projects],
    projectStages: [...source.projectStages],
    projectTaskLinks: [...source.projectTaskLinks],
    tasks: [...source.tasks],
    lifeAreas: [...source.lifeAreas],
    goals: [...source.goals],
    goalUpdates: [...source.goalUpdates],
    goalProjectLinks: [...source.goalProjectLinks],
  };

  for (const mutation of mutations) {
    if (!visibleStatuses.has(mutation.status) || !isObject(mutation.payload)) continue;
    const payload = mutation.payload;
    const revision = mutation.expectedRevision + 1;

    if (mutation.entityType === "calendar_event") {
      const current = view.calendarEvents.find(({ id }) => id === mutation.recordId);
      const event: LocalCalendarEvent = {
        id: mutation.recordId,
        title: stringValue(payload.title, current?.title ?? "New event"),
        description: nullableString(payload.description, current?.description ?? null),
        starts_at: stringValue(payload.starts_at, current?.starts_at ?? ""),
        ends_at: stringValue(payload.ends_at, current?.ends_at ?? ""),
        time_zone: stringValue(payload.time_zone, current?.time_zone ?? "UTC"),
        status: stringValue(payload.status, current?.status ?? "active") as LocalCalendarEvent["status"],
        revision,
      };
      view.calendarEvents = upsert(view.calendarEvents, event);
    }

    if (mutation.entityType === "project") {
      const current = view.projects.find(({ id }) => id === mutation.recordId);
      const project: Project = {
        id: mutation.recordId,
        title: stringValue(payload.title, current?.title ?? "New project"),
        description: nullableString(payload.description, current?.description ?? null),
        status: stringValue(payload.status, current?.status ?? "active") as Project["status"],
        sort_order: numberValue(payload.sort_order, current?.sort_order ?? view.projects.length),
        revision,
      };
      view.projects = upsert(view.projects, project);
      if (Array.isArray(payload.stages)) {
        for (const value of payload.stages) {
          if (!isObject(value) || typeof value.id !== "string") continue;
          const stage: ProjectStage = {
            id: value.id,
            project_id: mutation.recordId,
            name: stringValue(value.name, "New stage"),
            color: nullableString(value.color, null),
            sort_order: numberValue(value.sort_order, view.projectStages.length),
            is_complete: booleanValue(value.is_complete, false),
            is_archived: booleanValue(value.is_archived, false),
            revision: 1,
          };
          view.projectStages = upsert(view.projectStages, stage);
        }
      }
    }

    if (mutation.entityType === "project_stage") {
      const current = view.projectStages.find(({ id }) => id === mutation.recordId);
      const stage: ProjectStage = {
        id: mutation.recordId,
        project_id: stringValue(payload.project_id, current?.project_id ?? ""),
        name: stringValue(payload.name, current?.name ?? "New stage"),
        color: nullableString(payload.color, current?.color ?? null),
        sort_order: numberValue(payload.sort_order, current?.sort_order ?? view.projectStages.length),
        is_complete: booleanValue(payload.is_complete, current?.is_complete ?? false),
        is_archived: booleanValue(payload.is_archived, current?.is_archived ?? false),
        revision,
      };
      view.projectStages = upsert(view.projectStages, stage);
    }

    if (mutation.entityType === "project_task_link") {
      const current = view.projectTaskLinks.find(({ id }) => id === mutation.recordId);
      const link: ProjectTaskLink = {
        id: mutation.recordId,
        project_id: stringValue(payload.project_id, current?.project_id ?? ""),
        task_id: stringValue(payload.task_id, current?.task_id ?? ""),
        stage_id: stringValue(payload.stage_id, current?.stage_id ?? ""),
        sort_order: numberValue(payload.sort_order, current?.sort_order ?? 0),
        active: booleanValue(payload.active, current?.active ?? true),
        revision,
      };
      view.projectTaskLinks = upsert(view.projectTaskLinks, link);
    }

    if (mutation.entityType === "life_area") {
      const current = view.lifeAreas.find(({ id }) => id === mutation.recordId);
      const area: LifeArea = {
        id: mutation.recordId,
        name: stringValue(payload.name, current?.name ?? "New life area"),
        sort_order: numberValue(payload.sort_order, current?.sort_order ?? view.lifeAreas.length),
        is_archived: booleanValue(payload.is_archived, current?.is_archived ?? false),
        revision,
      };
      view.lifeAreas = upsert(view.lifeAreas, area);
    }

    if (mutation.entityType === "goal") {
      const current = view.goals.find(({ id }) => id === mutation.recordId);
      const goal: Goal = {
        id: mutation.recordId,
        title: stringValue(payload.title, current?.title ?? "New goal"),
        description: nullableString(payload.description, current?.description ?? null),
        kind: stringValue(payload.kind, current?.kind ?? "qualitative") as Goal["kind"],
        status: stringValue(payload.status, current?.status ?? "active") as Goal["status"],
        life_area_id: nullableString(payload.life_area_id, current?.life_area_id ?? null),
        baseline_value: nullableNumber(payload.baseline_value, current?.baseline_value ?? null),
        target_value: nullableNumber(payload.target_value, current?.target_value ?? null),
        target_unit: nullableString(payload.target_unit, current?.target_unit ?? null),
        direction: nullableString(payload.direction, current?.direction ?? null) as Goal["direction"],
        due_date: nullableString(payload.due_date, current?.due_date ?? null),
        sort_order: numberValue(payload.sort_order, current?.sort_order ?? view.goals.length),
        revision,
      };
      view.goals = upsert(view.goals, goal);
    }

    if (mutation.entityType === "goal_update") {
      const current = view.goalUpdates.find(({ id }) => id === mutation.recordId);
      const update: GoalUpdate = {
        id: mutation.recordId,
        goal_id: stringValue(payload.goal_id, current?.goal_id ?? ""),
        value: nullableNumber(payload.value, current?.value ?? null),
        unit: nullableString(payload.unit, current?.unit ?? null),
        note: nullableString(payload.note, current?.note ?? null),
        source: stringValue(payload.source, current?.source ?? "Manual"),
        measured_at: stringValue(payload.measured_at, current?.measured_at ?? new Date(mutation.createdAt).toISOString()),
        active: booleanValue(payload.active, current?.active ?? true),
        revision,
      };
      view.goalUpdates = upsert(view.goalUpdates, update);
    }

    if (mutation.entityType === "goal_project_link") {
      const current = view.goalProjectLinks.find(({ id }) => id === mutation.recordId);
      const link: GoalProjectLink = {
        id: mutation.recordId,
        goal_id: stringValue(payload.goal_id, current?.goal_id ?? ""),
        project_id: stringValue(payload.project_id, current?.project_id ?? ""),
        active: booleanValue(payload.active, current?.active ?? true),
        revision,
      };
      view.goalProjectLinks = upsert(view.goalProjectLinks, link);
    }

    if (mutation.entityType === "task") {
      const current = view.tasks.find(({ id }) => id === mutation.recordId);
      const status = stringValue(payload.status, current?.status ?? "open") as Task["status"];
      view.tasks = upsert(view.tasks, {
        id: mutation.recordId,
        title: stringValue(payload.title, current?.title ?? "New task"),
        details: nullableString(payload.details, current?.details ?? null),
        due_date: nullableString(payload.due_date, current?.due_date ?? null),
        status,
        completed_at: status === "done" ? current?.completed_at ?? new Date(mutation.createdAt).toISOString() : null,
        sort_order: numberValue(payload.sort_order, current?.sort_order ?? 0),
        revision,
      });
    }
  }

  return view;
}

function upsert<T extends { id: string }>(rows: T[], row: T): T[] {
  return rows.some(({ id }) => id === row.id)
    ? rows.map((current) => current.id === row.id ? row : current)
    : [...rows, row];
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

function nullableNumber(value: unknown, fallback: number | null): number | null {
  return value === null ? null : typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
