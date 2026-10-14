"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CaptureSheet, PageHeader, taskPayload } from "@/app/daily-components";
import { useWorkspace } from "@/app/app-workspace";
import { projectLocalDailyMutations } from "@/lib/daily/projection";
import { loadDailySnapshot, localToday } from "@/lib/daily/repository";
import { taskBucket } from "@/lib/daily/rules";
import { listMutations } from "@/lib/offline/outbox";
import { createClient } from "@/lib/supabase/client";
import type { DailySnapshot, Task } from "@/lib/daily/types";

type TaskView = "today" | "upcoming" | "inbox" | "archived";
const noTasks: Task[] = [];

export default function TasksPage() {
  const { profile, database, refreshKey, queueMutation, setNotice } = useWorkspace();
  const today = localToday(profile.timezone);
  const [view, setView] = useState<TaskView>("today");
  const [snapshot, setSnapshot] = useState<DailySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const reload = useCallback(async () => {
    if (!database) return;
    try {
      const { snapshot: remoteOrCached } = await loadDailySnapshot(createClient(), database, today);
      const queued = await listMutations(database);
      setSnapshot(projectLocalDailyMutations(remoteOrCached, queued, today));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Tasks could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [database, today]);

  useEffect(() => {
    const task = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(task);
  }, [reload, refreshKey]);

  const tasks = snapshot?.tasks ?? noTasks;
  const visibleTasks = useMemo(() => tasks.filter((task) => {
    const bucket = taskBucket({ status: task.status, dueDate: task.due_date }, today);
    return view === "archived" ? bucket === "archived" : view === "today" ? bucket === "today" : bucket === view;
  }).sort((left, right) => left.sort_order - right.sort_order || left.title.localeCompare(right.title)), [tasks, today, view]);
  const completedToday = tasks.filter((task) => task.status === "done" && task.due_date === today);
  const labels: Record<TaskView, string> = { today: "Today", upcoming: "Upcoming", inbox: "Inbox", archived: "Archived" };
  const dueDateForNewTask = view === "today" ? today : view === "upcoming" ? undefined : null;

  async function toggleTask(task: Task) {
    try {
      const status = task.status === "done" ? "open" : "done";
      await queueMutation({
        entityType: "task",
        recordId: task.id,
        expectedRevision: task.revision,
        payload: taskPayload({ ...task, status, completed_at: status === "done" ? new Date().toISOString() : null }),
      });
    } catch (saveError) {
      setNotice(saveError instanceof Error ? saveError.message : "The task update could not be saved.");
    }
  }

  return (
    <div className="daily-page">
      <PageHeader title="Tasks" subtitle="Small steps, all in one place" action={<button className="round-add" type="button" onClick={() => setCaptureOpen(true)} aria-label="Add a task">+</button>} />
      <div className="segmented-control task-segments" role="group" aria-label="Task list">
        {(["today", "upcoming", "inbox"] as const).map((item) => (
          <button className={view === item ? "segment is-selected" : "segment"} type="button" aria-pressed={view === item} onClick={() => setView(item)} key={item}>{labels[item]}</button>
        ))}
      </div>

      {error && <div className="offline-banner" role="status">{error}</div>}
      <section className="surface-card task-due-card" aria-labelledby="due-tasks-title">
        <div className="surface-heading"><h2 id="due-tasks-title">{view === "today" ? "Due today" : view === "upcoming" ? "Coming up" : "Your inbox"}</h2><span>{visibleTasks.length} {visibleTasks.length === 1 ? "task" : "tasks"}</span></div>
        {loading ? <p className="empty-copy">Loading tasks…</p> : visibleTasks.length === 0 ? (
          <div className="empty-inline"><p>{view === "today" ? "Nothing due today. A little breathing room." : view === "upcoming" ? "No upcoming tasks. Keep future work here when it’s ready." : "Your inbox is clear."}</p><button className="text-button" type="button" onClick={() => setCaptureOpen(true)}>Add a task</button></div>
        ) : (
          <div className="task-list">
            {visibleTasks.map((task) => <TaskRow key={task.id} task={task} onToggle={() => void toggleTask(task)} onEdit={() => setEditingTask(task)} />)}
          </div>
        )}
      </section>

      {view === "today" && completedToday.length > 0 && (
        <details className="surface-card completed-card">
          <summary><strong>Completed today</strong><span>{completedToday.length} ›</span></summary>
          <div className="task-list completed-list">{completedToday.map((task) => <TaskRow key={task.id} task={task} onToggle={() => void toggleTask(task)} onEdit={() => setEditingTask(task)} />)}</div>
        </details>
      )}

      <div className="task-archive-link">
        <button className="text-button" type="button" onClick={() => setView(view === "archived" ? "inbox" : "archived")}>
          {view === "archived" ? "Back to inbox" : `Archived tasks · ${tasks.filter(({ status }) => status === "archived").length}`}
        </button>
      </div>

      {captureOpen && <CaptureSheet plan={snapshot?.plan ?? null} priorities={snapshot?.priorities ?? []} defaultType="task" defaultTaskDate={dueDateForNewTask} onClose={() => setCaptureOpen(false)} onSaved={() => undefined} />}
      {editingTask && <TaskEditor task={editingTask} onClose={() => setEditingTask(null)} />}
    </div>
  );
}

function TaskRow({ task, onToggle, onEdit }: { task: Task; onToggle(): void; onEdit(): void }) {
  return (
    <div className={task.status === "done" ? "task-row is-complete" : "task-row"}>
      <label className="task-check-label">
        <input className="native-check" type="checkbox" checked={task.status === "done"} onChange={onToggle} aria-label={`${task.status === "done" ? "Reopen" : "Complete"} ${task.title}`} />
        <span className="check-mark" aria-hidden="true"><img src="/icons/checkmark.svg" width="13" height="13" alt="" /></span>
      </label>
      <button className="task-row-content" type="button" onClick={onEdit}>
        <strong>{task.title}</strong>
        <small>{task.details || task.due_date ? `${task.details ?? ""}${task.details && task.due_date ? " · " : ""}${task.due_date ? `Due ${task.due_date}` : ""}` : "No due date"}</small>
      </button>
      <button className="row-chevron" type="button" onClick={onEdit} aria-label={`Edit ${task.title}`}>›</button>
    </div>
  );
}

function TaskEditor({ task, onClose }: { task: Task; onClose(): void }) {
  const { queueMutation } = useWorkspace();
  const [title, setTitle] = useState(task.title);
  const [details, setDetails] = useState(task.details ?? "");
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [status, setStatus] = useState(task.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return setError("Tasks need a title.");
    setBusy(true);
    try {
      await queueMutation({
        entityType: "task",
        recordId: task.id,
        expectedRevision: task.revision,
        payload: {
          title: title.trim(),
          details: details.trim() || null,
          due_date: dueDate || null,
          status,
          completed_at: status === "done" ? (task.completed_at ?? new Date().toISOString()) : null,
          sort_order: task.sort_order,
        },
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Task could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="edit-task-title">
        <div className="sheet-heading"><div><span className="eyebrow">TASK</span><h2 id="edit-task-title">Edit task</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close task editor">×</button></div>
        <form className="sheet-form" onSubmit={save}>
          <label className="field-label" htmlFor="edit-task-name">Title<input id="edit-task-name" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="field-label" htmlFor="edit-task-details">Details <span className="optional-label">Optional</span><textarea id="edit-task-details" maxLength={2000} value={details} onChange={(event) => setDetails(event.target.value)} /></label>
          <label className="field-label" htmlFor="edit-task-due">Due date <span className="optional-label">A due date is not a time block</span><input id="edit-task-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          {task.status === "archived" ? (
            <button className="button button-secondary" type="button" onClick={() => setStatus("open")}>Restore task</button>
          ) : (
            <button className="button button-secondary" type="button" onClick={() => setStatus("archived")}>Archive task</button>
          )}
          {error && <p className="form-message" role="alert">{error}</p>}
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save task"}</button>
        </form>
      </section>
    </div>
  );
}
