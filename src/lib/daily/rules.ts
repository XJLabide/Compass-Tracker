export const MAX_PRIORITIES_PER_DAY = 3;

export type PriorityOutcome = "done" | "partly_done" | "not_done" | "no_longer_relevant";
export type PlanDateKind = "backfill" | "today" | "future";
export type TaskBucket = "today" | "upcoming" | "inbox" | "completed" | "archived";

const priorityOutcomes = new Set<PriorityOutcome>([
  "done",
  "partly_done",
  "not_done",
  "no_longer_relevant",
]);

export function classifyPlanDate(localDate: string, today: string): PlanDateKind {
  if (localDate < today) return "backfill";
  if (localDate > today) return "future";
  return "today";
}

export function nextPriorityRank(priorities: Array<{ rank: number }>): number | undefined {
  const used = new Set(priorities.map(({ rank }) => rank));
  for (let rank = 1; rank <= MAX_PRIORITIES_PER_DAY; rank += 1) {
    if (!used.has(rank)) return rank;
  }
  return undefined;
}

export function validateEndDayReview(
  priorities: Array<{ id: string; rank: number; title: string }>,
  outcomes: Record<string, string>,
  carryForwardIds: string[],
  nextPlanPriorityCount: number,
):
  | { ok: true; carryForwardIds: string[] }
  | { ok: false; reason: "outcomes-required"; missingPriorityIds: string[] }
  | { ok: false; reason: "invalid-carry-forward"; priorityId: string }
  | { ok: false; reason: "priority-limit" } {
  const missingPriorityIds = priorities
    .filter(({ id }) => !isPriorityOutcome(outcomes[id]))
    .map(({ id }) => id);
  if (missingPriorityIds.length > 0) {
    return { ok: false, reason: "outcomes-required", missingPriorityIds };
  }

  const byId = new Map(priorities.map((priority) => [priority.id, priority]));
  const uniqueCarryIds = [...new Set(carryForwardIds)];
  for (const priorityId of uniqueCarryIds) {
    const priority = byId.get(priorityId);
    const outcome = outcomes[priorityId] as PriorityOutcome | undefined;
    if (!priority || outcome === "done" || outcome === "no_longer_relevant") {
      return { ok: false, reason: "invalid-carry-forward", priorityId };
    }
  }

  if (nextPlanPriorityCount + uniqueCarryIds.length > MAX_PRIORITIES_PER_DAY) {
    return { ok: false, reason: "priority-limit" };
  }

  return { ok: true, carryForwardIds: uniqueCarryIds };
}

export function isPriorityOutcome(value: string | undefined): value is PriorityOutcome {
  return value !== undefined && priorityOutcomes.has(value as PriorityOutcome);
}

export function dueRoutineIds(
  routines: Array<{ id: string; daysOfWeek: number[] }>,
  localDate: string,
): string[] {
  const weekday = new Date(`${localDate}T00:00:00.000Z`).getUTCDay() || 7;
  return routines.filter(({ daysOfWeek }) => daysOfWeek.includes(weekday)).map(({ id }) => id);
}

export function taskBucket(
  task: { status: "open" | "done" | "archived"; dueDate: string | null },
  localDate: string,
): TaskBucket {
  if (task.status === "archived") return "archived";
  if (task.status === "done") return "completed";
  if (task.dueDate === null) return "inbox";
  return task.dueDate <= localDate ? "today" : "upcoming";
}
