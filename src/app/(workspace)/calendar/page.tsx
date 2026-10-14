"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CaptureButton, PageHeader } from "@/app/daily-components";
import { useWorkspace } from "@/app/app-workspace";
import { localDateTimeInput, localDayBounds, localDateTimeToInstant, partitionCalendarDay } from "@/lib/calendar/rules";
import type { LocalCalendarEvent } from "@/lib/calendar/types";
import { loadPlanningSnapshot } from "@/lib/planning/repository";
import { projectLocalPlanningMutations } from "@/lib/planning/projection";
import { emptyPlanningSnapshot, type PlanningSnapshot } from "@/lib/planning/types";
import { listMutations } from "@/lib/offline/outbox";
import { localToday, shiftLocalDate } from "@/lib/daily/repository";
import { createClient } from "@/lib/supabase/client";

interface ProviderCalendarChoice {
  providerCalendarId: string;
  name: string;
  timeZone: string | null;
  selected: boolean;
  externalCalendarId: string | null;
}

export default function CalendarPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedDate = searchParams.get("date");
  const { profile, database, online, refreshKey, queueMutation } = useWorkspace();
  const today = localToday(profile.timezone);
  const viewDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : today;
  const bounds = localDayBounds(viewDate, profile.timezone);
  const [snapshot, setSnapshot] = useState<PlanningSnapshot>(emptyPlanningSnapshot);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<LocalCalendarEvent | null>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [providerConfigured, setProviderConfigured] = useState(true);
  const [providerConnected, setProviderConnected] = useState(false);
  const [providerCalendars, setProviderCalendars] = useState<ProviderCalendarChoice[]>([]);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerError, setProviderError] = useState("");
  const [providerNotice, setProviderNotice] = useState("");

  const reload = useCallback(async () => {
    if (!database) return;
    try {
      const loaded = await loadPlanningSnapshot(
        createClient(), database, new Date(bounds.start).toISOString(), new Date(bounds.end).toISOString(),
      );
      const mutations = await listMutations(database);
      setSnapshot(projectLocalPlanningMutations(loaded.snapshot, mutations));
      setOffline(loaded.offline);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Calendar could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [database, bounds.start, bounds.end]);

  useEffect(() => {
    const task = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(task);
  }, [reload, refreshKey]);

  const visibleEvents = useMemo(() => {
    const local = snapshot.calendarEvents.map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      time_zone: event.time_zone,
      externalCalendarName: null as string | null,
      localEvent: event,
    }));
    const calendarNames = new Map(snapshot.externalCalendars.map(({ id, name }) => [id, name]));
    const imported = snapshot.importedCalendarEvents.map((event) => ({
      id: `imported:${event.id}`,
      title: event.title,
      description: event.description,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      time_zone: event.time_zone,
      externalCalendarName: calendarNames.get(event.external_calendar_id) ?? "Imported calendar",
      localEvent: null as LocalCalendarEvent | null,
    }));
    const combined = [...local, ...imported];
    const { events } = partitionCalendarDay(combined, [], viewDate, profile.timezone);
    const included = new Set(events);
    return combined.filter(({ id }) => included.has(id)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [snapshot, viewDate, profile.timezone]);

  const dueTasks = useMemo(() => snapshot.tasks
    .filter(({ due_date, status }) => due_date === viewDate && status !== "archived")
    .sort((left, right) => left.sort_order - right.sort_order || left.title.localeCompare(right.title)), [snapshot.tasks, viewDate]);
  const selectedCalendarCount = snapshot.externalCalendars.filter(({ selected }) => selected).length;

  function chooseDate(date: string) {
    router.replace(date === today ? "/calendar" : `/calendar?date=${date}`, { scroll: false });
  }

  async function openProviderSettings() {
    setProviderOpen(true);
    setProviderBusy(true);
    setProviderError("");
    setProviderNotice("");
    try {
      const response = await fetch("/api/calendar/google/calendars");
      const result = await response.json() as {
        configured?: boolean;
        connected?: boolean;
        calendars?: ProviderCalendarChoice[];
        error?: string;
      };
      setProviderConfigured(result.configured !== false);
      setProviderConnected(Boolean(result.connected));
      setProviderCalendars(result.calendars ?? []);
      if (!response.ok) setProviderError(result.error ?? "Google calendars could not be loaded.");
    } catch (loadError) {
      setProviderError(loadError instanceof Error ? loadError.message : "Google calendars could not be loaded.");
    } finally {
      setProviderBusy(false);
    }
  }

  async function saveProviderCalendars() {
    setProviderBusy(true);
    setProviderError("");
    setProviderNotice("");
    try {
      const response = await fetch("/api/calendar/google/calendars", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selectedIds: providerCalendars.filter(({ selected }) => selected).map(({ providerCalendarId }) => providerCalendarId) }),
      });
      const result = await response.json() as { error?: string; selectedCount?: number };
      if (!response.ok) throw new Error(result.error ?? "Calendar choices could not be saved.");
      setProviderNotice(`${result.selectedCount ?? 0} calendars selected.`);
      await reload();
      const refresh = await fetch("/api/calendar/google/calendars");
      const refreshed = await refresh.json() as { calendars?: ProviderCalendarChoice[] };
      setProviderCalendars(refreshed.calendars ?? []);
    } catch (saveError) {
      setProviderError(saveError instanceof Error ? saveError.message : "Calendar choices could not be saved.");
    } finally {
      setProviderBusy(false);
    }
  }

  async function importSelectedCalendars() {
    setProviderBusy(true);
    setProviderError("");
    setProviderNotice("");
    try {
      const response = await fetch("/api/calendar/google/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: new Date(bounds.start).toISOString(), through: new Date(bounds.end).toISOString() }),
      });
      const result = await response.json() as { error?: string; imported?: number; message?: string };
      if (!response.ok) throw new Error(result.error ?? "Calendar events could not be imported.");
      setProviderNotice(result.message ?? `${result.imported ?? 0} timed events refreshed.`);
      await reload();
    } catch (importError) {
      setProviderError(importError instanceof Error ? importError.message : "Calendar events could not be imported.");
    } finally {
      setProviderBusy(false);
    }
  }

  async function disconnectGoogleCalendar() {
    setProviderBusy(true);
    setProviderError("");
    try {
      const response = await fetch("/api/calendar/google/disconnect", { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Google Calendar could not be disconnected.");
      setProviderConnected(false);
      setProviderCalendars([]);
      await reload();
    } catch (disconnectError) {
      setProviderError(disconnectError instanceof Error ? disconnectError.message : "Google Calendar could not be disconnected.");
    } finally {
      setProviderBusy(false);
    }
  }

  async function saveEvent(input: Omit<LocalCalendarEvent, "revision"> & { revision: number }) {
    await queueMutation({
      entityType: "calendar_event",
      recordId: input.id,
      expectedRevision: input.revision,
      payload: {
        title: input.title,
        description: input.description,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        time_zone: input.time_zone,
        status: input.status,
      },
    });
  }

  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${viewDate}T12:00:00.000Z`));

  return (
    <div className="daily-page">
      <PageHeader title="Calendar" subtitle="Timed commitments and due work stay distinct" action={<CaptureButton onClick={() => { setEditing(null); setEditorOpen(true); }} />} />
      <div className="day-picker" aria-label="Choose a day">
        <button type="button" onClick={() => chooseDate(shiftLocalDate(viewDate, -1))} aria-label="Previous day">‹</button>
        <label className="sr-only" htmlFor="calendar-date">View date</label>
        <input id="calendar-date" type="date" value={viewDate} onChange={(event) => chooseDate(event.target.value)} />
        <button type="button" onClick={() => chooseDate(shiftLocalDate(viewDate, 1))} aria-label="Next day">›</button>
        {viewDate !== today && <button className="today-shortcut" type="button" onClick={() => chooseDate(today)}>Today</button>}
      </div>

      {offline && <div className="offline-banner" role="status"><strong>Offline view.</strong> Showing the last saved calendar and due work.</div>}
      {error && <div className="form-message" role="alert">{error}</div>}

      <section className="surface-card calendar-events-card" aria-labelledby="calendar-events-title">
        <div className="surface-heading"><h2 id="calendar-events-title">{dateLabel}</h2><span>{visibleEvents.length} timed {visibleEvents.length === 1 ? "event" : "events"}</span></div>
        {loading ? <p className="empty-copy">Loading your calendar…</p> : visibleEvents.length === 0 ? (
          <div className="empty-inline"><p>No timed events planned. Your task due dates are listed separately.</p><button className="text-button" type="button" onClick={() => { setEditing(null); setEditorOpen(true); }}>Add an event</button></div>
        ) : visibleEvents.map((event) => (
          <article className="calendar-event-row" key={event.id}>
            <time className="calendar-event-time" dateTime={event.starts_at}>{formatTime(event.starts_at, event.time_zone)}<small>{formatTime(event.ends_at, event.time_zone)}</small></time>
            <div className="calendar-event-copy"><strong>{event.title}</strong>{event.description && <small>{event.description}</small>}
              {event.externalCalendarName && <small className="calendar-event-source">Read only · {event.externalCalendarName}</small>}
            </div>
            {event.localEvent && <button className="row-chevron" type="button" aria-label={`Edit ${event.title}`} onClick={() => { setEditing(event.localEvent); setEditorOpen(true); }}>›</button>}
            {!event.localEvent && <span className="read-only-mark" aria-label="Read only">↗</span>}
          </article>
        ))}
      </section>

      <section className="surface-card due-work-card" aria-labelledby="due-work-title">
        <div className="surface-heading"><h2 id="due-work-title">Tasks due this day</h2><span>{dueTasks.length} {dueTasks.length === 1 ? "task" : "tasks"}</span></div>
        {dueTasks.length === 0 ? (
          <div className="empty-inline"><p>No tasks are due on {dateLabel}.</p><Link className="text-button" href="/tasks">Open tasks</Link></div>
        ) : dueTasks.map((task) => (
          <div className="calendar-due-task" key={task.id}>
            <span className={task.status === "done" ? "due-task-dot is-complete" : "due-task-dot"} aria-hidden="true" />
            <span><strong>{task.title}</strong><small>{task.status === "done" ? "Completed" : "Due date · no time scheduled"}</small></span>
          </div>
        ))}
      </section>

      <section className="surface-card calendar-import-card" aria-labelledby="calendar-import-title">
        <div className="surface-heading"><div><h2 id="calendar-import-title">External calendars</h2><small>{selectedCalendarCount ? `${selectedCalendarCount} selected` : "No imports selected"}</small></div></div>
        <p className="section-intro">Imported events are read only. Compass never changes the source calendar.</p>
        <div className="calendar-import-actions">
          <button className="button button-secondary" type="button" onClick={() => void openProviderSettings()}>Manage Google calendars</button>
          <button className="text-button" type="button" disabled={!online || selectedCalendarCount === 0 || providerBusy} onClick={() => void importSelectedCalendars()}>
            {providerBusy ? "Importing…" : "Refresh this day"}
          </button>
        </div>
      </section>

      {editorOpen && <CalendarEventSheet
        event={editing}
        localDate={viewDate}
        timeZone={profile.timezone}
        onClose={() => { setEditorOpen(false); setEditing(null); }}
        onSave={saveEvent}
      />}
      {providerOpen && <CalendarProviderSheet
        configured={providerConfigured}
        connected={providerConnected}
        calendars={providerCalendars}
        busy={providerBusy}
        error={providerError}
        notice={providerNotice}
        onClose={() => setProviderOpen(false)}
        onToggle={(id) => setProviderCalendars((current) => current.map((calendar) => calendar.providerCalendarId === id ? { ...calendar, selected: !calendar.selected } : calendar))}
        onSave={() => void saveProviderCalendars()}
        onDisconnect={() => void disconnectGoogleCalendar()}
      />}
    </div>
  );
}

function CalendarEventSheet({ event, localDate, timeZone, onClose, onSave }: {
  event: LocalCalendarEvent | null;
  localDate: string;
  timeZone: string;
  onClose(): void;
  onSave(input: Omit<LocalCalendarEvent, "revision"> & { revision: number }): Promise<void>;
}) {
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [starts, setStarts] = useState(event ? localDateTimeInput(event.starts_at, timeZone) : `${localDate}T09:00`);
  const [ends, setEnds] = useState(event ? localDateTimeInput(event.ends_at, timeZone) : `${localDate}T09:30`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setError("");
    if (!title.trim()) return setError("Give the event a name.");
    try {
      const startsAt = localDateTimeToInstant(starts, timeZone);
      const endsAt = localDateTimeToInstant(ends, timeZone);
      if (Date.parse(endsAt) <= Date.parse(startsAt)) return setError("The end time must come after the start time.");
      setBusy(true);
      await onSave({
        id: event?.id ?? crypto.randomUUID(),
        title: title.trim(),
        description: description.trim() || null,
        starts_at: startsAt,
        ends_at: endsAt,
        time_zone: timeZone,
        status: event?.status ?? "active",
        revision: event?.revision ?? 0,
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Event could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelEvent() {
    if (!event) return;
    setBusy(true);
    try {
      await onSave({ ...event, status: "cancelled" });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Event could not be cancelled.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="event-editor-title">
        <div className="sheet-heading"><div><span className="eyebrow">TIMED EVENT</span><h2 id="event-editor-title">{event ? "Edit event" : "Schedule time"}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close event editor">×</button></div>
        <form className="sheet-form" onSubmit={submit}>
          <label className="field-label" htmlFor="calendar-event-title">Title<input id="calendar-event-title" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="field-label" htmlFor="calendar-event-description">Details <span className="optional-label">Optional</span><textarea id="calendar-event-description" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <label className="field-label" htmlFor="calendar-event-start">Starts<input id="calendar-event-start" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} /></label>
          <label className="field-label" htmlFor="calendar-event-end">Ends<input id="calendar-event-end" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} /></label>
          <p className="more-note">Times use {timeZone}. Task due dates stay separate and do not block calendar time.</p>
          {error && <p className="form-message" role="alert">{error}</p>}
          {event && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void cancelEvent()}>Cancel event</button>}
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : event ? "Save event" : "Add event"}</button>
        </form>
      </section>
    </div>
  );
}

function CalendarProviderSheet({ configured, connected, calendars, busy, error, notice, onClose, onToggle, onSave, onDisconnect }: {
  configured: boolean;
  connected: boolean;
  calendars: ProviderCalendarChoice[];
  busy: boolean;
  error: string;
  notice: string;
  onClose(): void;
  onToggle(id: string): void;
  onSave(): void;
  onDisconnect(): void;
}) {
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="calendar-provider-title">
        <div className="sheet-heading"><div><span className="eyebrow">READ ONLY IMPORT</span><h2 id="calendar-provider-title">Google Calendar</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close calendar settings">×</button></div>
        <p className="sheet-intro">Compass requests read-only event access. Select which calendars to import; source events cannot be edited here.</p>
        {!configured ? <p className="offline-note" role="status">Google Calendar is not configured for this environment. Add its OAuth client and encryption key to the server settings.</p> : !connected ? (
          <a className="button button-primary" href="/api/calendar/google/connect">Connect Google Calendar</a>
        ) : (
          <>
            {calendars.length === 0 && !busy ? <p className="empty-copy">No calendars were returned by Google.</p> : (
              <div className="calendar-provider-list">
                {calendars.map((calendar) => (
                  <label className="check-option calendar-provider-choice" key={calendar.providerCalendarId}>
                    <input type="checkbox" checked={calendar.selected} onChange={() => onToggle(calendar.providerCalendarId)} />
                    <span><strong>{calendar.name}</strong><small>{calendar.timeZone ?? "Calendar timezone"}</small></span>
                  </label>
                ))}
              </div>
            )}
            <button className="button button-primary" type="button" disabled={busy} onClick={onSave}>{busy ? "Saving…" : "Save selected calendars"}</button>
            <button className="text-button" type="button" disabled={busy} onClick={onDisconnect}>Disconnect Google Calendar</button>
          </>
        )}
        {error && <p className="form-message" role="alert">{error}</p>}
        {notice && <p className="form-message" role="status">{notice}</p>}
      </section>
    </div>
  );
}

function formatTime(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(instant));
}
