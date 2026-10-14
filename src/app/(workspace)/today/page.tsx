"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CaptureButton, CaptureSheet, EndDaySheet, PageHeader, taskPayload } from "@/app/daily-components";
import { useWorkspace } from "@/app/app-workspace";
import { projectLocalDailyMutations } from "@/lib/daily/projection";
import { getRoutineLogForDate, getTaskLinksForPriority, loadDailySnapshot, shiftLocalDate, localToday } from "@/lib/daily/repository";
import { classifyPlanDate, dueRoutineIds, nextPriorityRank } from "@/lib/daily/rules";
import { listMutations } from "@/lib/offline/outbox";
import { createClient } from "@/lib/supabase/client";
import type { DailySnapshot, Priority, Task } from "@/lib/daily/types";

const emptySnapshot: DailySnapshot = {
  plan: null,
  priorities: [],
  tasks: [],
  priorityTaskLinks: [],
  routines: [],
  routineLogs: [],
};

export default function TodayPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedDate = searchParams.get("date");
  const { profile, database, online, refreshKey, queueMutation, setNotice } = useWorkspace();
  const today = localToday(profile.timezone);
  const viewDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : today;
  const [snapshot, setSnapshot] = useState<DailySnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState("");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [endDayOpen, setEndDayOpen] = useState(false);
  const [expandedPriority, setExpandedPriority] = useState<string | null>(null);
  const [linkTarget, setLinkTarget] = useState("");
  const [nextDayPriorityCount, setNextDayPriorityCount] = useState(0);

  const reload = useCallback(async () => {
    if (!database || !viewDate) return;
    setError("");
    try {
      const { snapshot: remoteOrCached, offline: usingCache } = await loadDailySnapshot(
        createClient(),
        database,
        viewDate,
      );
      const localQueue = await listMutations(database);
      setSnapshot(projectLocalDailyMutations(remoteOrCached, localQueue, viewDate));
      setOffline(usingCache);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Today could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [database, viewDate]);

  useEffect(() => {
    const task = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(task);
  }, [reload, refreshKey]);

  const dateKind = viewDate ? classifyPlanDate(viewDate, today) : "today";
  const dateLabel = viewDate
    ? new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })
        .format(new Date(`${viewDate}T12:00:00.000Z`))
    : "";
  const plan = snapshot.plan;
  const activePriorities = snapshot.priorities.filter(({ state }) => state === "active").sort((left, right) => left.rank - right.rank);
  const priorityTaskIds = new Set(snapshot.priorityTaskLinks.filter(({ active }) => active).map(({ task_id }) => task_id));
  const actionTasks = snapshot.tasks
    .filter((task) => task.status !== "archived" && (task.due_date === viewDate || priorityTaskIds.has(task.id)))
    .sort((left, right) => left.sort_order - right.sort_order || left.title.localeCompare(right.title));
  const dueRoutineIdsForDate = useMemo(() => new Set(dueRoutineIds(
    snapshot.routines.map(({ id, days_of_week }) => ({ id, daysOfWeek: days_of_week })),
    viewDate,
  )), [snapshot.routines, viewDate]);
  const dueRoutines = snapshot.routines.filter(({ id, active }) => active && dueRoutineIdsForDate.has(id));
  const completedActions = actionTasks.filter(({ status }) => status === "done").length;
  const canEditPriorities = Boolean(plan && plan.status !== "ended");

  function chooseDate(date: string) {
    router.replace(date === today ? "/today" : `/today?date=${date}`, { scroll: false });
  }

  async function createPlan() {
    const status = dateKind === "today" ? "active" : dateKind === "future" ? "draft" : "backfill";
    try {
      await queueMutation({
        entityType: "daily_plan",
        recordId: crypto.randomUUID(),
        expectedRevision: 0,
        payload: {
          local_date: viewDate,
          timezone: profile.timezone,
          status,
          started_at: status === "active" ? new Date().toISOString() : null,
        },
      });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "This day could not be started.");
    }
  }

  async function toggleTask(task: Task) {
    try {
      await queueMutation({
        entityType: "task",
        recordId: task.id,
        expectedRevision: task.revision,
        payload: taskPayload({
          ...task,
          status: task.status === "done" ? "open" : "done",
          completed_at: task.status === "done" ? null : new Date().toISOString(),
        }),
      });
    } catch (taskError) {
      setNotice(taskError instanceof Error ? taskError.message : "Task update could not be saved.");
    }
  }

  async function toggleRoutine(routineId: string) {
    const log = getRoutineLogForDate(snapshot.routineLogs, routineId, viewDate);
    try {
      await queueMutation({
        entityType: "routine_log",
        recordId: log?.id ?? crypto.randomUUID(),
        expectedRevision: log?.revision ?? 0,
        payload: {
          routine_id: routineId,
          local_date: viewDate,
          completed: !log?.completed,
          note: log?.note ?? null,
        },
      });
    } catch (routineError) {
      setNotice(routineError instanceof Error ? routineError.message : "Routine update could not be saved.");
    }
  }

  async function addTaskLink(priority: Priority) {
    if (!linkTarget) return;
    const task = snapshot.tasks.find(({ id }) => id === linkTarget);
    if (!task) return;
    try {
      await queueMutation({
        entityType: "priority_task_link",
        recordId: crypto.randomUUID(),
        expectedRevision: 0,
        operation: "link",
        payload: { priority_id: priority.id, task_id: task.id, active: true },
      });
      setLinkTarget("");
    } catch (linkError) {
      setNotice(linkError instanceof Error ? linkError.message : "The task could not be linked.");
    }
  }

  async function unlinkTask(linkId: string, revision: number) {
    try {
      await queueMutation({
        entityType: "priority_task_link",
        recordId: linkId,
        expectedRevision: revision,
        operation: "unlink",
        payload: { active: false },
      });
    } catch (linkError) {
      setNotice(linkError instanceof Error ? linkError.message : "The task link could not be removed.");
    }
  }

  async function reopenForBackfill() {
    if (!plan) return;
    try {
      await queueMutation({
        entityType: "daily_plan",
        recordId: plan.id,
        expectedRevision: plan.revision,
        payload: { status: "backfill" },
      });
    } catch (reopenError) {
      setNotice(reopenError instanceof Error ? reopenError.message : "This day could not be reopened for backfill.");
    }
  }

  async function countNextDayPriorities() {
    const nextDate = shiftLocalDate(viewDate, 1);
    if (!online) return 0;
    const supabase = createClient();
    const { data: nextPlan } = await supabase.from("daily_plans").select("id").eq("local_date", nextDate).maybeSingle();
    if (!nextPlan) return 0;
    const { count } = await supabase.from("priorities").select("id", { count: "exact", head: true }).eq("daily_plan_id", nextPlan.id).eq("state", "active");
    return count ?? 0;
  }

  async function openEndDay() {
    try {
      setNextDayPriorityCount(await countNextDayPriorities());
    } catch {
      setNextDayPriorityCount(0);
    }
    setEndDayOpen(true);
  }

  const subtitle = dateKind === "today"
    ? `${dateLabel} · Make room for what matters.`
    : dateKind === "future"
      ? `${dateLabel} · Future plan, separate from today.`
      : `${dateLabel} · Backfill this date without changing today.`;

  return (
    <div className="daily-page">
      <PageHeader title="Today" subtitle={subtitle} action={<CaptureButton onClick={() => setCaptureOpen(true)} />} />
      <div className="day-picker" aria-label="Choose a day">
        <button type="button" onClick={() => chooseDate(shiftLocalDate(viewDate, -1))} aria-label="Previous day">‹</button>
        <label className="sr-only" htmlFor="today-date">View date</label>
        <input id="today-date" type="date" value={viewDate} onChange={(event) => chooseDate(event.target.value)} />
        <button type="button" onClick={() => chooseDate(shiftLocalDate(viewDate, 1))} aria-label="Next day">›</button>
        {viewDate !== today && <button className="today-shortcut" type="button" onClick={() => chooseDate(today)}>Today</button>}
      </div>

      {offline && <div className="offline-banner" role="status"><strong>Offline view.</strong> Showing the last saved copy; new edits stay on this device until sync.</div>}
      {error && <div className="form-message" role="alert">{error}</div>}
      {loading && <div className="surface-card loading-card" role="status">Loading your day…</div>}

      {!loading && !plan && (
        <section className="surface-card start-day-card">
          <span className="eyebrow">{dateKind === "today" ? "A FRESH PAGE" : dateKind === "future" ? "PLAN AHEAD" : "PAST DAY"}</span>
          <h2>{dateKind === "today" ? "Start with what matters." : dateKind === "future" ? "Leave a note for your future self." : "Capture what happened."}</h2>
          <p>{dateKind === "today" ? "Pick up to three priorities. You can always adjust them as your day unfolds." : dateKind === "future" ? "A draft stays separate. It won’t replace or change today’s plan." : "Backfill this date while keeping today’s plan untouched."}</p>
          <button className="button button-primary" type="button" onClick={() => void createPlan()}>
            {dateKind === "today" ? "Start My Day" : dateKind === "future" ? "Create future draft" : "Backfill this day"}
          </button>
        </section>
      )}

      {!loading && plan && (
        <>
          {plan.status === "draft" && <div className="day-mode-banner"><strong>Future draft.</strong> Planning this day will not change the active day.</div>}
          {plan.status === "backfill" && <div className="day-mode-banner"><strong>Backfill mode.</strong> Changes here stay attached to {dateLabel}, not today.</div>}
          {plan.status === "ended" && (
            <div className="day-mode-banner ended-banner">
              <div><strong>Day reviewed.</strong> Your reflection and outcomes are saved.</div>
              <button className="text-button" type="button" onClick={() => void reopenForBackfill()}>Edit this day</button>
            </div>
          )}

          <section className="surface-card" aria-labelledby="priorities-title">
            <div className="surface-heading">
              <h2 id="priorities-title">Your priorities</h2>
              <span>{String(activePriorities.length).padStart(2, "0")} of 03</span>
            </div>
            {activePriorities.length === 0 ? <p className="empty-copy">Choose one important thing to make room for.</p> : activePriorities.map((priority) => {
              const linkedTaskIds = getTaskLinksForPriority(snapshot.priorityTaskLinks, priority.id);
              const linkedTasks = snapshot.tasks.filter((task) => linkedTaskIds.includes(task.id));
              const completedCount = linkedTasks.filter(({ status }) => status === "done").length;
              const expanded = expandedPriority === priority.id;
              return (
                <div className="priority-block" key={priority.id}>
                  <div className="priority-row">
                    <span className={`priority-rank rank-${priority.rank}`}>{String(priority.rank).padStart(2, "0")}</span>
                    <div className="priority-copy">
                      <strong>{priority.title}</strong>
                      <small>{linkedTasks.length > 0 ? `${linkedTasks.length} linked actions · ${completedCount} done` : priority.outcome ? `Outcome · ${outcomeLabel(priority.outcome)}` : "No linked actions yet"}</small>
                    </div>
                    <button className="row-chevron" type="button" aria-label={`${expanded ? "Close" : "Open"} details for ${priority.title}`} aria-expanded={expanded} onClick={() => setExpandedPriority(expanded ? null : priority.id)}>{expanded ? "⌄" : "›"}</button>
                  </div>
                  {priority.outcome && <span className="priority-outcome">{outcomeLabel(priority.outcome)}</span>}
                  {expanded && (
                    <div className="priority-detail">
                      <p className="task-link-heading">Supporting actions</p>
                      {linkedTasks.map((task) => {
                        const link = snapshot.priorityTaskLinks.find((item) => item.active && item.priority_id === priority.id && item.task_id === task.id);
                        return (
                          <div className="linked-task-row" key={task.id}>
                            <span>{task.title}{task.status === "done" ? " · done" : ""}</span>
                            {link && <button className="text-button" type="button" onClick={() => void unlinkTask(link.id, link.revision)} aria-label={`Unlink ${task.title}`}>Unlink</button>}
                          </div>
                        );
                      })}
                      {canEditPriorities && (
                        <div className="link-task-controls">
                          <label className="sr-only" htmlFor={`task-link-${priority.id}`}>Choose a task to link</label>
                          <select id={`task-link-${priority.id}`} value={linkTarget} onChange={(event) => setLinkTarget(event.target.value)}>
                            <option value="">Link a task</option>
                            {snapshot.tasks.filter((task) => !linkedTaskIds.includes(task.id) && task.status !== "archived").map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}
                          </select>
                          <button className="text-button" type="button" disabled={!linkTarget} onClick={() => void addTaskLink(priority)}>Link</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {canEditPriorities && (
              <button className="add-row" type="button" disabled={nextPriorityRank(activePriorities) === undefined} onClick={() => setCaptureOpen(true)}>
                <span aria-hidden="true">+</span><span>{nextPriorityRank(activePriorities) === undefined ? "Three priorities is your daily limit" : "Add one more priority"}</span>
              </button>
            )}
          </section>

          <section className="surface-card" aria-labelledby="today-actions-title">
            <div className="surface-heading">
              <h2 id="today-actions-title">Today’s actions</h2>
              <span>{completedActions} of {actionTasks.length} done</span>
            </div>
            {actionTasks.length === 0 ? (
              <div className="empty-inline"><p>No supporting tasks yet.</p><button className="text-button" type="button" onClick={() => setCaptureOpen(true)}>Add a task</button></div>
            ) : (
              <div className="task-list">
                {actionTasks.map((task) => {
                  const parent = snapshot.priorityTaskLinks.find((link) => link.active && link.task_id === task.id);
                  const priority = parent && activePriorities.find(({ id }) => id === parent.priority_id);
                  return (
                    <label className={task.status === "done" ? "check-row is-complete" : "check-row"} key={task.id}>
                      <input className="native-check" type="checkbox" checked={task.status === "done"} onChange={() => void toggleTask(task)} aria-label={`${task.status === "done" ? "Reopen" : "Complete"} ${task.title}`} />
                      <span className="check-mark" aria-hidden="true"><img src="/icons/checkmark.svg" width="13" height="13" alt="" /></span>
                      <span className="check-row-copy"><strong>{task.title}</strong><small>{priority ? `Supports “${priority.title}”` : task.due_date === viewDate ? "Due today" : "Inbox task"}</small></span>
                    </label>
                  );
                })}
              </div>
            )}
          </section>

          <section className="surface-card routine-card" aria-labelledby="routines-title">
            <div className="surface-heading">
              <h2 id="routines-title">Routines</h2>
              <span>{dueRoutines.length} planned today</span>
            </div>
            {dueRoutines.length === 0 ? (
              <div className="empty-inline"><p>No routines scheduled for this day.</p><a className="text-button" href="/routines">Set up a routine</a></div>
            ) : dueRoutines.map((routine) => {
              const log = getRoutineLogForDate(snapshot.routineLogs, routine.id, viewDate);
              return (
                <label className={log?.completed ? "check-row is-complete" : "check-row"} key={routine.id}>
                  <input className="native-check" type="checkbox" checked={Boolean(log?.completed)} onChange={() => void toggleRoutine(routine.id)} aria-label={`${log?.completed ? "Uncheck" : "Complete"} routine ${routine.title}`} />
                  <span className="check-mark" aria-hidden="true"><img src="/icons/checkmark.svg" width="13" height="13" alt="" /></span>
                  <span className="check-row-copy"><strong>{routine.title}</strong><small>{routine.time_label ? `${routine.time_label} · routine` : "Routine"}</small></span>
                </label>
              );
            })}
          </section>

          {(plan.status === "active" || plan.status === "backfill") && (
            <button className="button button-secondary end-day-button" type="button" onClick={() => void openEndDay()}>
              End Day · review outcomes
            </button>
          )}
        </>
      )}

      {captureOpen && <CaptureSheet plan={plan} priorities={activePriorities} onClose={() => setCaptureOpen(false)} onSaved={() => undefined} />}
      {endDayOpen && plan && <EndDaySheet plan={plan} priorities={activePriorities} nextDayPriorityCount={nextDayPriorityCount} onClose={() => setEndDayOpen(false)} onSaved={() => undefined} />}
    </div>
  );
}

function outcomeLabel(outcome: NonNullable<Priority["outcome"]>) {
  return {
    done: "Done",
    partly_done: "Partly done",
    not_done: "Not done",
    no_longer_relevant: "No longer relevant",
  }[outcome];
}
