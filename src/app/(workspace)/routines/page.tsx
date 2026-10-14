"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useWorkspace } from "@/app/app-workspace";
import { PageHeader } from "@/app/daily-components";
import { localToday } from "@/lib/daily/repository";
import { projectLocalDailyMutations } from "@/lib/daily/projection";
import { createClient } from "@/lib/supabase/client";
import { cacheRecord, listMutations, readCachedRecord, type JsonValue } from "@/lib/offline/outbox";
import type { DailySnapshot, Routine } from "@/lib/daily/types";

const weekDays = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

export default function RoutinesPage() {
  const { database, profile, refreshKey, queueMutation } = useWorkspace();
  const today = localToday(profile.timezone);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Routine | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const reload = useCallback(async () => {
    if (!database) return;
    try {
      const { data, error } = await createClient().from("routines").select("*").order("sort_order").order("created_at");
      if (error) throw new Error(error.message);
      await cacheRecord(database, { id: "routines:list", revision: 1, payload: (data ?? []) as unknown as JsonValue, cachedAt: Date.now() });
      const queue = await listMutations(database);
      const base: DailySnapshot = { plan: null, priorities: [], tasks: [], priorityTaskLinks: [], routines: (data ?? []) as Routine[], routineLogs: [] };
      const projected = projectLocalDailyMutations(base, queue, today);
      setRoutines(projected.routines);
      setError("");
    } catch (loadError) {
      const [cached, queue] = await Promise.all([
        readRoutineCache(database),
        listMutations(database),
      ]);
      if (cached) {
        const base: DailySnapshot = { plan: null, priorities: [], tasks: [], priorityTaskLinks: [], routines: cached, routineLogs: [] };
        setRoutines(projectLocalDailyMutations(base, queue, today).routines);
      }
      setError(cached ? "Showing saved routines while offline." : loadError instanceof Error ? loadError.message : "Routines could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [database, today]);

  useEffect(() => {
    const task = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(task);
  }, [reload, refreshKey]);

  const visible = routines.filter(({ active }) => showArchived ? !active : active);

  async function saveRoutine(input: { id: string; revision: number; title: string; days: number[]; timeLabel: string; active: boolean }) {
    if (input.days.length === 0) throw new Error("Choose at least one scheduled day.");
    await queueMutation({
      entityType: "routine",
      recordId: input.id,
      expectedRevision: input.revision,
      payload: {
        title: input.title.trim(),
        days_of_week: input.days,
        time_label: input.timeLabel.trim() || null,
        active: input.active,
        sort_order: visible.length,
      },
    });
  }

  return (
    <div className="daily-page">
      <PageHeader title="Routines" subtitle="Ongoing things, on the days you choose" action={<button className="round-add" type="button" onClick={() => setComposerOpen(true)} aria-label="Add a routine">+</button>} />
      <section className="surface-card">
        <div className="surface-heading"><h2>{showArchived ? "Paused routines" : "Your routines"}</h2><span>{visible.length} {visible.length === 1 ? "routine" : "routines"}</span></div>
        <p className="section-intro">Unscheduled days are just days off. They never count as missed.</p>
        {error && <p className="offline-note" role="status">{error}</p>}
        {loading ? <p className="empty-copy">Loading routines…</p> : visible.length === 0 ? (
          <div className="empty-inline"><p>{showArchived ? "No paused routines." : "Nothing is scheduled yet."}</p>{!showArchived && <button className="text-button" type="button" onClick={() => setComposerOpen(true)}>Set up a routine</button>}</div>
        ) : visible.map((routine) => (
          <button className="routine-management-row" type="button" key={routine.id} onClick={() => setEditing(routine)}>
            <span className="summary-count">↻</span>
            <span className="summary-copy"><strong>{routine.title}</strong><small>{scheduleLabel(routine.days_of_week)}{routine.time_label ? ` · ${routine.time_label}` : ""}</small></span>
            <span className="row-chevron" aria-hidden="true">›</span>
          </button>
        ))}
      </section>
      <div className="page-foot-links">
        <button className="text-button" type="button" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "View active routines" : `Paused routines · ${routines.filter(({ active }) => !active).length}`}</button>
      </div>
      {(composerOpen || editing) && (
        <RoutineSheet
          routine={editing}
          onClose={() => { setComposerOpen(false); setEditing(null); }}
          onSave={saveRoutine}
        />
      )}
    </div>
  );
}

function RoutineSheet({ routine, onClose, onSave }: {
  routine: Routine | null;
  onClose(): void;
  onSave(input: { id: string; revision: number; title: string; days: number[]; timeLabel: string; active: boolean }): Promise<void>;
}) {
  const [title, setTitle] = useState(routine?.title ?? "");
  const [days, setDays] = useState<number[]>(routine?.days_of_week ?? [1, 2, 3, 4, 5]);
  const [timeLabel, setTimeLabel] = useState(routine?.time_label ?? "");
  const [active, setActive] = useState(routine?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return setError("Give the routine a name.");
    if (days.length === 0) return setError("Choose at least one day.");
    setBusy(true);
    try {
      await onSave({
        id: routine?.id ?? crypto.randomUUID(),
        revision: routine?.revision ?? 0,
        title,
        days,
        timeLabel,
        active,
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Routine could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="routine-title">
        <div className="sheet-heading"><div><span className="eyebrow">ROUTINE</span><h2 id="routine-title">{routine ? "Edit routine" : "A small rhythm"}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close routine editor">×</button></div>
        <form className="sheet-form" onSubmit={submit}>
          <label className="field-label" htmlFor="routine-name">Name<input id="routine-name" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <fieldset className="routine-days">
            <legend>Scheduled days</legend>
            <div className="checkbox-grid">
              {weekDays.map((day) => (
                <label className="checkbox-choice" key={day.value}>
                  <input type="checkbox" checked={days.includes(day.value)} onChange={(event) => setDays((current) => event.target.checked ? [...current, day.value].sort() : current.filter((value) => value !== day.value))} />
                  {day.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field-label" htmlFor="routine-time">Time of day <span className="optional-label">Optional label</span><input id="routine-time" maxLength={40} placeholder="Morning" value={timeLabel} onChange={(event) => setTimeLabel(event.target.value)} /></label>
          {routine && <label className="check-option"><input type="checkbox" checked={!active} onChange={(event) => setActive(!event.target.checked)} /><span>Pause this routine</span></label>}
          {error && <p className="form-message" role="alert">{error}</p>}
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : routine ? "Save routine" : "Create routine"}</button>
        </form>
      </section>
    </div>
  );
}

function scheduleLabel(days: number[]) {
  if (days.length === 7) return "Every day";
  if (days.length === 5 && days.every((day) => day <= 5)) return "Weekdays";
  return days.map((day) => weekDays.find((item) => item.value === day)?.label).filter(Boolean).join(", ");
}

async function readRoutineCache(database: IDBDatabase) {
  const cached = await readCachedRecord(database, "routines:list");
  if (!cached || !Array.isArray(cached.payload)) return undefined;
  return cached.payload as unknown as Routine[];
}
