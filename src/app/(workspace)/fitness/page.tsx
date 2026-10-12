"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { PageHeader } from "@/app/daily-components";
import { HealthSheet } from "@/app/health-sheet";
import { localToday } from "@/lib/daily/repository";
import { listMutations } from "@/lib/offline/outbox";
import { buildExerciseHistory } from "@/lib/fitness/records";
import { projectLocalFitnessMutations } from "@/lib/fitness/projection";
import { emptyFitnessSnapshot, type FitnessActivityKind, type FitnessSnapshot, type StrengthProgram, type StrengthProgramDay, type StrengthProgramExercise } from "@/lib/fitness/types";
import { loadFitnessSnapshot } from "@/lib/planning/repository";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/app/app-workspace";

type FitnessForm = "program" | "exercise" | "activity" | null;

export default function FitnessPage() {
  const { ownerId, profile, database, refreshKey, queueMutation, online } = useWorkspace();
  const [snapshot, setSnapshot] = useState<FitnessSnapshot>(emptyFitnessSnapshot);
  const [form, setForm] = useState<FitnessForm>(null);
  const [overrideDay, setOverrideDay] = useState<StrengthProgramDay | null>(null);
  const [overrideDate, setOverrideDate] = useState("");
  const [logDay, setLogDay] = useState<StrengthProgramDay | null>(null);
  const [logDate, setLogDate] = useState("");
  const [editProgram, setEditProgram] = useState<StrengthProgram | null>(null);
  const [editDay, setEditDay] = useState<StrengthProgramDay | null>(null);
  const [exerciseDay, setExerciseDay] = useState<StrengthProgramDay | null>(null);
  const [editProgramExercise, setEditProgramExercise] = useState<StrengthProgramExercise | null>(null);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!database) return;
    let active = true;
    async function load() {
      try {
        const [loaded, mutations] = await Promise.all([
          loadFitnessSnapshot(createClient(), database!),
          listMutations(database!),
        ]);
        if (active) {
          setSnapshot(projectLocalFitnessMutations(loaded.snapshot, mutations));
          setOffline(loaded.offline);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Fitness data could not be loaded.");
      }
    }
    void load();
    return () => { active = false; };
  }, [database, ownerId, refreshKey]);

  const records = useMemo(() => buildExerciseHistory(snapshot.workouts.map((workout) => ({
    id: workout.id,
    completed_at: workout.completed_at,
    local_date: workout.local_date,
    exercises: workout.exercises,
  }))), [snapshot.workouts]);

  async function submitProgram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = value(data, "program-title");
    const sessionTitle = value(data, "session-title");
    if (!title || !sessionTitle) { setError("Add a program and session name."); return; }
    setError("");
    try {
      const programId = editProgram?.id ?? crypto.randomUUID();
      await queueMutation({
        entityType: "strength_program", recordId: programId, expectedRevision: editProgram?.revision ?? 0,
        payload: { title, notes: nullableValue(data, "program-notes"), status: editProgram?.status ?? "active" },
      });
      const day = editProgram && snapshot.programDays.find(({ program_id }) => program_id === editProgram.id);
      const dayId = day?.id ?? crypto.randomUUID();
      await queueMutation({
        entityType: "strength_program_day", recordId: dayId, expectedRevision: day?.revision ?? 0,
        payload: { program_id: programId, title: sessionTitle, weekday: numberValue(data, "session-weekday"), sort_order: day?.sort_order ?? snapshot.programDays.length },
      });
      setForm(null);
      setEditProgram(null);
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "The program could not be saved."); }
  }

  async function submitExercise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = value(data, "exercise-name");
    if (!name) { setError("Add an exercise name."); return; }
    try {
      await queueMutation({ entityType: "fitness_exercise", recordId: crypto.randomUUID(), expectedRevision: 0,
        payload: { name, category: nullableValue(data, "exercise-category"), load_unit: value(data, "exercise-unit") || "kg", is_archived: false } });
      setForm(null); setError("");
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "The exercise could not be saved."); }
  }

  async function submitActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const kind = value(data, "activity-kind") as FitnessActivityKind;
    const sport = value(data, "activity-sport");
    if (kind === "sport" && !sport) { setError("Name the sport for this session."); return; }
    const title = value(data, "activity-title") || (kind === "run" ? "Run" : sport);
    const duration = numberValue(data, "activity-duration");
    if (!duration || duration < 1) { setError("Add the session duration in minutes."); return; }
    try {
      await queueMutation({ entityType: "fitness_activity_log", recordId: crypto.randomUUID(), expectedRevision: 0, payload: {
        activity_kind: kind, local_date: value(data, "activity-date") || localToday(profile.timezone), title,
        sport: kind === "sport" ? sport : null,
        duration_minutes: duration, distance: numberValue(data, "activity-distance"),
        distance_unit: value(data, "activity-distance-unit") || null, intensity: value(data, "activity-intensity") || null,
        notes: nullableValue(data, "activity-notes"),
      } });
      setForm(null); setError("");
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "The activity could not be saved."); }
  }

  async function submitDay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editDay) return;
    const data = new FormData(event.currentTarget);
    const title = value(data, "session-edit-title");
    if (!title) { setError("Add a session name."); return; }
    try {
      await queueMutation({ entityType: "strength_program_day", recordId: editDay.id, expectedRevision: editDay.revision, payload: {
        program_id: editDay.program_id, title, weekday: numberValue(data, "session-edit-weekday"), sort_order: editDay.sort_order,
      } });
      setEditDay(null);
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "The session could not be saved."); }
  }

  return (
    <div className="health-page">
      <PageHeader title="Fitness" subtitle="Strength work, movement, and the records you build" />
      <div className="health-toolbar"><span className="health-sync">{offline ? "Offline · showing saved records" : online ? "Manual logging ready" : "Offline · logs save on this device"}</span><div className="health-actions"><button className="button button-secondary" type="button" onClick={() => setForm("exercise")}>Add exercise</button><button className="button button-secondary" type="button" onClick={() => setForm("activity")}>Quick log</button><button className="button button-primary" type="button" onClick={() => { setEditProgram(null); setForm("program"); }}>New program</button></div></div>
      {error && <p className="form-message" role="alert">{error}</p>}
      <section className="health-section" aria-labelledby="programs-title">
        <div className="health-section-heading"><div><span className="eyebrow">STRENGTH</span><h2 id="programs-title">Programs and sessions</h2></div><span className="health-count">{snapshot.programs.filter(({ status }) => status === "active").length} active</span></div>
        {snapshot.programs.filter(({ status }) => status === "active").length === 0 ? <div className="health-empty"><h3>Build a repeatable strength plan.</h3><p>Create a program, add sessions and exercises, then log what you completed.</p><button className="text-button" type="button" onClick={() => setForm("program")}>Create your first program <span aria-hidden="true">→</span></button></div> : <div className="health-program-list">{snapshot.programs.filter(({ status }) => status === "active").map((program) => <ProgramCard key={program.id} program={program} snapshot={snapshot} today={localToday(profile.timezone)} onEdit={() => { setEditProgram(program); setForm("program"); }} onArchive={() => void queueMutation({ entityType: "strength_program", recordId: program.id, expectedRevision: program.revision, payload: { title: program.title, notes: program.notes, status: "archived" } })} onAddDay={async () => {
          const dayId = crypto.randomUUID();
          await queueMutation({ entityType: "strength_program_day", recordId: dayId, expectedRevision: 0, payload: { program_id: program.id, title: "New session", weekday: null, sort_order: snapshot.programDays.filter(({ program_id }) => program_id === program.id).length } });
        }} onLog={(day, date) => { setLogDay(day); setLogDate(date); }} onOverride={(day, date) => { setOverrideDay(day); setOverrideDate(date); }} onAddExercise={setExerciseDay} onEditExercise={(row) => { setEditProgramExercise(row); setExerciseDay(snapshot.programDays.find(({ id }) => id === row.program_day_id) ?? null); }} onEditDay={setEditDay} onMoveExercise={(row, direction) => {
          const peers = snapshot.programExercises.filter(({ program_day_id }) => program_day_id === row.program_day_id).sort((a, b) => a.sort_order - b.sort_order);
          const index = peers.findIndex(({ id }) => id === row.id); const target = peers[index + direction];
          if (!target) return;
          void queueMutation({ entityType: "strength_program_exercise", recordId: row.id, expectedRevision: row.revision, payload: { ...row, sort_order: target.sort_order } });
          void queueMutation({ entityType: "strength_program_exercise", recordId: target.id, expectedRevision: target.revision, payload: { ...target, sort_order: row.sort_order } });
        }} />)}</div>}
      </section>
      <section className="health-section" aria-labelledby="activities-title">
        <div className="health-section-heading"><div><span className="eyebrow">MOVEMENT</span><h2 id="activities-title">Runs and sports</h2></div><button className="text-button" type="button" onClick={() => setForm("activity")}>Log a session <span aria-hidden="true">+</span></button></div>
        {snapshot.activities.length === 0 ? <p className="health-muted">Runs and sports can be logged manually, with no provider connection required.</p> : <div className="health-record-list">{snapshot.activities.slice(0, 12).map((activity) => <article className="health-record" key={activity.id}><div><strong>{activity.title}</strong><small>{activity.local_date} · {activity.activity_kind === "run" ? "Run" : activity.sport || "Sports"}</small></div><span>{activity.duration_minutes} min{activity.distance ? ` · ${activity.distance} ${activity.distance_unit}` : ""}</span></article>)}</div>}
      </section>
      <section className="health-section" aria-labelledby="records-title">
        <div className="health-section-heading"><div><span className="eyebrow">FROM COMPLETED SETS</span><h2 id="records-title">Personal records</h2></div><span className="health-count">{records.length} exercises</span></div>
        {records.length > 0 && <p className="health-muted">Estimated 1RM uses the Epley formula (load × (1 + reps ÷ 30)); singles use the recorded load.</p>}
        {records.length === 0 ? <p className="health-muted">Your PRs and estimated one-rep max history will appear after you log strength sets.</p> : <div className="health-record-list">{records.map((history) => <details className="health-record-detail" key={history.exercise_id}><summary><strong>{history.exercise_name}</strong><span>Best estimated 1RM {Math.max(...history.sessions.map(({ estimated_one_rep_max }) => estimated_one_rep_max))} · {history.sessions.length} sessions</span></summary><div className="health-record-history">{history.sessions.slice().reverse().map((session) => <article className="health-record" key={`${session.workout_id}:${session.date}`}><div><strong>{session.date}</strong><small>Estimated 1RM · {session.estimated_one_rep_max}</small></div><span>{session.records.map(({ weight, reps, estimated_one_rep_max }) => `${weight} × ${reps} (${estimated_one_rep_max})`).join(" · ") || "No new PR"}</span></article>)}</div></details>)}</div>}
      </section>
      {form === "program" && <ProgramForm program={editProgram} error={error} firstDay={editProgram ? snapshot.programDays.find(({ program_id }) => program_id === editProgram.id) ?? null : null} onClose={() => { setForm(null); setEditProgram(null); setError(""); }} onSubmit={submitProgram} />}
      {form === "exercise" && <ExerciseForm error={error} onClose={() => { setForm(null); setError(""); }} onSubmit={submitExercise} />}
      {form === "activity" && <ActivityForm error={error} onClose={() => { setForm(null); setError(""); }} onSubmit={submitActivity} timezone={profile.timezone} />}
      {editDay && <SessionEditForm day={editDay} error={error} onClose={() => { setEditDay(null); setError(""); }} onSubmit={submitDay} />}
      {exerciseDay && <ProgramExerciseForm day={exerciseDay} editing={editProgramExercise} error={error} exercises={snapshot.exercises.filter(({ is_archived }) => !is_archived)} onClose={() => { setExerciseDay(null); setEditProgramExercise(null); setError(""); }} onSubmit={async (event) => {
        event.preventDefault(); const data = new FormData(event.currentTarget); const exercise = snapshot.exercises.find(({ id }) => id === (editProgramExercise?.exercise_id ?? value(data, "program-exercise-id")));
        if (!exercise) { setError("Choose an exercise first."); return; }
        try { await queueMutation({ entityType: "strength_program_exercise", recordId: editProgramExercise?.id ?? crypto.randomUUID(), expectedRevision: editProgramExercise?.revision ?? 0, payload: {
          program_day_id: exerciseDay.id, exercise_id: exercise.id, exercise_name: exercise.name, target_sets: numberValue(data, "exercise-sets") || 3,
          target_reps: numberValue(data, "exercise-reps") || 8, target_weight: numberValue(data, "exercise-weight"), weight_unit: exercise.load_unit,
          sort_order: editProgramExercise?.sort_order ?? snapshot.programExercises.filter(({ program_day_id }) => program_day_id === exerciseDay.id).length,
        } }); setExerciseDay(null); setEditProgramExercise(null); } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "The exercise could not be saved."); }
      }} />}
      {overrideDay && <OverrideForm day={overrideDay} error={error} timezone={profile.timezone} initialDate={overrideDate} existing={snapshot.overrides.find((item) => item.program_day_id === overrideDay.id && item.local_date === overrideDate)} onClose={() => { setOverrideDay(null); setOverrideDate(""); setError(""); }} onSubmit={async (event) => {
        event.preventDefault(); const data = new FormData(event.currentTarget); const existing = snapshot.overrides.find((item) => item.program_day_id === overrideDay.id && item.local_date === value(data, "override-date"));
        try { await queueMutation({ entityType: "strength_override", recordId: existing?.id ?? crypto.randomUUID(), expectedRevision: existing?.revision ?? 0, payload: {
          program_day_id: overrideDay.id, local_date: value(data, "override-date"), title: nullableValue(data, "override-title"), notes: nullableValue(data, "override-notes"), skipped: data.get("override-skipped") === "on",
        } }); setOverrideDay(null); } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "The override could not be saved."); }
      }} />}
      {logDay && <WorkoutLogForm day={logDay} date={logDate} error={error} exercises={snapshot.programExercises.filter(({ program_day_id }) => program_day_id === logDay.id).sort((a, b) => a.sort_order - b.sort_order)} timezone={profile.timezone} onClose={() => { setLogDay(null); setLogDate(""); setError(""); }} onSubmit={async (event) => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        const loggedExercises = snapshot.programExercises.filter(({ program_day_id }) => program_day_id === logDay.id).map((item) => ({
          exercise_id: item.exercise_id, exercise_name: item.exercise_name,
          sets: parseSets(value(data, `sets-${item.id}`), item),
        })).filter(({ sets }) => sets.length > 0);
        if (!loggedExercises.length) { setError("Add at least one valid set to log this workout."); return; }
        const programId = snapshot.programDays.find(({ id }) => id === logDay.id)?.program_id ?? null;
        try { await queueMutation({ entityType: "workout_log", recordId: crypto.randomUUID(), expectedRevision: 0, payload: {
          program_id: programId, program_day_id: logDay.id, local_date: logDate, timezone: profile.timezone,
          title_snapshot: value(data, "workout-title") || logDay.title, completed_at: new Date().toISOString(), notes: nullableValue(data, "workout-notes"), exercises: loggedExercises, status: "logged",
        } }); setLogDay(null); } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "The workout could not be logged."); }
      }} />}
      {error && <p className="health-toast" role="alert">{error}</p>}
    </div>
  );
}

function ProgramCard({ program, snapshot, today, onEdit, onArchive, onAddDay, onLog, onOverride, onAddExercise, onEditExercise, onEditDay, onMoveExercise }: {
  program: StrengthProgram; snapshot: FitnessSnapshot; today: string; onEdit(): void; onArchive(): void; onAddDay(): void; onLog(day: StrengthProgramDay, date: string): void;
  onOverride(day: StrengthProgramDay, date: string): void; onAddExercise(day: StrengthProgramDay): void; onEditExercise(row: StrengthProgramExercise): void; onEditDay(day: StrengthProgramDay): void;
  onMoveExercise(row: StrengthProgramExercise, direction: number): void;
}) {
  const [selectedDate, setSelectedDate] = useState(today);
  const days = snapshot.programDays.filter(({ program_id }) => program_id === program.id).sort((a, b) => a.sort_order - b.sort_order);
  return <article className="health-program"><div className="health-section-heading"><div><h3>{program.title}</h3>{program.notes && <p>{program.notes}</p>}</div><div className="health-actions"><button className="text-button" type="button" onClick={onEdit}>Edit</button><button className="text-button" type="button" onClick={onArchive}>Archive</button></div></div>
    {days.map((day) => { const items = snapshot.programExercises.filter(({ program_day_id }) => program_day_id === day.id).sort((a, b) => a.sort_order - b.sort_order); const override = snapshot.overrides.find(({ program_day_id, local_date }) => program_day_id === day.id && local_date === selectedDate); const futureDate = selectedDate > today; return <section className="health-session" key={day.id}>
      <div className="health-session-date"><label className="field-label" htmlFor={`session-date-${day.id}`}>Plan date<input id={`session-date-${day.id}`} type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label></div>
      <div className="health-section-heading"><div><h4>{day.title}</h4><small>{day.weekday === null ? "Flexible session" : weekdayLabel(day.weekday)}</small></div><div className="health-actions"><button className="text-button" type="button" onClick={() => onEditDay(day)}>Edit</button><button className="text-button" type="button" onClick={() => onOverride(day, selectedDate)}>Override date</button><button className="button button-primary" type="button" onClick={() => onLog(override?.title ? { ...day, title: override.title } : day, selectedDate)} disabled={!items.length || Boolean(override?.skipped) || futureDate}>{override?.skipped ? "Skipped" : futureDate ? "Future session" : "Log workout"}</button></div></div>
      {override && <p className="health-banner">{override.skipped ? `Skipped on ${selectedDate}` : `Override for ${selectedDate}${override.title ? ` · ${override.title}` : ""}`}{override.notes ? ` · ${override.notes}` : ""}</p>}
      {items.length === 0 ? <p className="health-muted">Add exercises to make this session ready to log.</p> : <div className="health-program-exercises">{items.map((item, index) => <div className="health-record" key={item.id}><div><strong>{item.exercise_name}</strong><small>{item.target_sets} × {item.target_reps}{item.target_weight ? ` · ${item.target_weight} ${item.weight_unit}` : ""}</small></div><div className="health-actions"><button className="text-button" type="button" onClick={() => onEditExercise(item)}>Edit</button><button className="icon-button" type="button" aria-label={`Move ${item.exercise_name} up`} onClick={() => onMoveExercise(item, -1)} disabled={index === 0}>↑</button><button className="icon-button" type="button" aria-label={`Move ${item.exercise_name} down`} onClick={() => onMoveExercise(item, 1)} disabled={index === items.length - 1}>↓</button></div></div>)}</div>}
      <button className="text-button" type="button" onClick={() => onAddExercise(day)}>Add exercise <span aria-hidden="true">+</span></button>
    </section>; })}
    <button className="text-button" type="button" onClick={onAddDay}>Add session <span aria-hidden="true">+</span></button>
  </article>;
}

function ProgramForm({ program, firstDay, error, onClose, onSubmit }: { program: StrengthProgram | null; firstDay: StrengthProgramDay | null; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  return <HealthSheet eyebrow="FITNESS" title={program ? "Edit strength program" : "Create strength program"} error={error} onClose={onClose}>
    <form className="sheet-form" onSubmit={onSubmit}>
      <label className="field-label" htmlFor="program-title">Program name<input id="program-title" name="program-title" required maxLength={160} defaultValue={program?.title ?? ""} /></label>
      <label className="field-label" htmlFor="program-notes">Notes <span className="optional-label">Optional</span><textarea id="program-notes" name="program-notes" maxLength={2000} defaultValue={program?.notes ?? ""} /></label>
      <label className="field-label" htmlFor="session-title">{program ? "First session name" : "First session"}<input id="session-title" name="session-title" required maxLength={120} defaultValue={firstDay?.title ?? ""} placeholder="Upper body, Long run prep…" /></label>
      <label className="field-label" htmlFor="session-weekday">Scheduled day<select id="session-weekday" name="session-weekday" defaultValue={firstDay?.weekday ?? ""}><option value="">Flexible</option>{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day, index) => <option value={index + 1} key={day}>{day}</option>)}</select></label>
      <button className="button button-primary" type="submit">{program ? "Save program" : "Create program"}</button>
    </form>
  </HealthSheet>;
}

function ExerciseForm({ error, onClose, onSubmit }: { error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  return <HealthSheet eyebrow="FITNESS" title="Add an exercise" error={error} onClose={onClose}><form className="sheet-form" onSubmit={onSubmit}>
    <label className="field-label" htmlFor="exercise-name">Exercise name<input id="exercise-name" name="exercise-name" required maxLength={120} autoFocus /></label>
    <label className="field-label" htmlFor="exercise-category">Muscle group <span className="optional-label">Optional</span><input id="exercise-category" name="exercise-category" maxLength={80} placeholder="Legs, chest, back…" /></label>
    <label className="field-label" htmlFor="exercise-unit">Load unit<select id="exercise-unit" name="exercise-unit" defaultValue="kg"><option value="kg">kg</option><option value="lb">lb</option></select></label>
    <button className="button button-primary" type="submit">Save exercise</button>
  </form></HealthSheet>;
}

function ActivityForm({ error, onClose, onSubmit, timezone }: { error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void; timezone: string }) {
  return <HealthSheet eyebrow="FITNESS" title="Quick movement log" error={error} onClose={onClose}><form className="sheet-form" onSubmit={onSubmit}>
    <label className="field-label" htmlFor="activity-kind">Activity<select id="activity-kind" name="activity-kind"><option value="run">Run</option><option value="sport">Sports session</option></select></label>
    <label className="field-label" htmlFor="activity-title">Session name <span className="optional-label">Optional</span><input id="activity-title" name="activity-title" maxLength={120} placeholder="Easy morning run" /></label>
    <label className="field-label" htmlFor="activity-sport">Sport <span className="optional-label">For sports sessions</span><input id="activity-sport" name="activity-sport" maxLength={80} placeholder="Basketball, pickleball…" /></label>
    <div className="health-form-grid"><label className="field-label" htmlFor="activity-date">Date<input id="activity-date" name="activity-date" type="date" defaultValue={localToday(timezone)} required /></label><label className="field-label" htmlFor="activity-duration">Duration (min)<input id="activity-duration" name="activity-duration" type="number" min="1" step="1" required /></label></div>
    <div className="health-form-grid"><label className="field-label" htmlFor="activity-distance">Distance <span className="optional-label">Optional</span><input id="activity-distance" name="activity-distance" type="number" min="0" step="any" /></label><label className="field-label" htmlFor="activity-distance-unit">Unit<select id="activity-distance-unit" name="activity-distance-unit"><option value="km">km</option><option value="mi">mi</option></select></label></div>
    <label className="field-label" htmlFor="activity-intensity">Effort <span className="optional-label">Optional</span><select id="activity-intensity" name="activity-intensity" defaultValue=""><option value="">Not recorded</option><option value="easy">Easy</option><option value="moderate">Moderate</option><option value="hard">Hard</option></select></label>
    <label className="field-label" htmlFor="activity-notes">Notes <span className="optional-label">Optional</span><textarea id="activity-notes" name="activity-notes" maxLength={1000} /></label>
    <button className="button button-primary" type="submit">Save activity</button>
  </form></HealthSheet>;
}

function ProgramExerciseForm({ day, exercises, editing, error, onClose, onSubmit }: { day: StrengthProgramDay; exercises: FitnessSnapshot["exercises"]; editing: StrengthProgramExercise | null; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  return <HealthSheet eyebrow="FITNESS" title={editing ? `Edit ${editing.exercise_name}` : `Add to ${day.title}`} error={error} onClose={onClose}><form className="sheet-form" onSubmit={onSubmit}>
    {editing ? <><label className="field-label" htmlFor="program-exercise-name">Exercise<input id="program-exercise-name" value={editing.exercise_name} readOnly /></label><input type="hidden" name="program-exercise-id" value={editing.exercise_id} /></> : exercises.length ? <label className="field-label" htmlFor="program-exercise-id">Exercise<select id="program-exercise-id" name="program-exercise-id" required defaultValue="">{exercises.map((exercise) => <option value={exercise.id} key={exercise.id}>{exercise.name}</option>)}</select></label> : <p className="health-banner">Add an exercise to your library first.</p>}
    <div className="health-form-grid"><label className="field-label" htmlFor="exercise-sets">Sets<input id="exercise-sets" name="exercise-sets" type="number" min="1" max="20" defaultValue={editing?.target_sets ?? 3} /></label><label className="field-label" htmlFor="exercise-reps">Target reps<input id="exercise-reps" name="exercise-reps" type="number" min="1" max="100" defaultValue={editing?.target_reps ?? 8} /></label></div>
    <label className="field-label" htmlFor="exercise-weight">Target load in the exercise&apos;s saved unit <span className="optional-label">Optional</span><input id="exercise-weight" name="exercise-weight" type="number" min="0" step="any" defaultValue={editing?.target_weight ?? ""} /></label>
    <button className="button button-primary" type="submit" disabled={!editing && !exercises.length}>{editing ? "Save exercise" : "Add exercise"}</button>
  </form></HealthSheet>;
}

function OverrideForm({ day, timezone, initialDate, existing, error, onClose, onSubmit }: { day: StrengthProgramDay; timezone: string; initialDate: string; existing: FitnessSnapshot["overrides"][number] | undefined; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  return <HealthSheet eyebrow="FITNESS" title={`Override ${day.title}`} error={error} onClose={onClose}><form className="sheet-form" onSubmit={onSubmit}>
    <label className="field-label" htmlFor="override-date">Date<input id="override-date" name="override-date" type="date" defaultValue={existing?.local_date ?? initialDate ?? localToday(timezone)} required /></label>
    <label className="field-label" htmlFor="override-title">Alternate session name <span className="optional-label">Optional</span><input id="override-title" name="override-title" maxLength={120} defaultValue={existing?.title ?? ""} /></label>
    <label className="field-label" htmlFor="override-notes">Notes <span className="optional-label">Optional</span><textarea id="override-notes" name="override-notes" maxLength={1000} defaultValue={existing?.notes ?? ""} /></label>
    <label className="field-checkbox"><input type="checkbox" name="override-skipped" defaultChecked={existing?.skipped ?? false} /> Skip this session on the selected date</label>
    <button className="button button-primary" type="submit">Save date override</button>
  </form></HealthSheet>;
}

function WorkoutLogForm({ day, date, exercises, timezone, error, onClose, onSubmit }: { day: StrengthProgramDay; date: string; exercises: StrengthProgramExercise[]; timezone: string; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  return <HealthSheet eyebrow="FITNESS" title={`Log ${day.title}`} error={error} onClose={onClose}><form className="sheet-form" onSubmit={onSubmit}>
    <label className="field-label" htmlFor="workout-title">Workout name<input id="workout-title" name="workout-title" maxLength={120} defaultValue={day.title} required /></label>
    <p className="health-muted">Enter completed sets as load × reps separated by commas. These values become the permanent workout record.</p>
    {exercises.map((exercise) => <label className="field-label" htmlFor={`sets-${exercise.id}`} key={exercise.id}>{exercise.exercise_name}<small>{exercise.target_sets} planned sets · {exercise.target_reps} target reps · {exercise.weight_unit}</small><input id={`sets-${exercise.id}`} name={`sets-${exercise.id}`} defaultValue={exercise.target_weight === null ? "" : Array.from({ length: exercise.target_sets }, () => `${exercise.target_weight}x${exercise.target_reps}`).join(", ")} placeholder="60x8, 60x8, 55x8" /></label>)}
    <label className="field-label" htmlFor="workout-notes">Notes <span className="optional-label">Optional</span><textarea id="workout-notes" name="workout-notes" maxLength={2000} /></label>
    <p className="health-muted">Recorded for {date || localToday(timezone)} in {timezone}.</p>
    <button className="button button-primary" type="submit">Save completed workout</button>
  </form></HealthSheet>;
}

function SessionEditForm({ day, error, onClose, onSubmit }: { day: StrengthProgramDay; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  return <HealthSheet eyebrow="FITNESS" title="Edit session" error={error} onClose={onClose}><form className="sheet-form" onSubmit={onSubmit}>
    <label className="field-label" htmlFor="session-edit-title">Session name<input id="session-edit-title" name="session-edit-title" required maxLength={120} defaultValue={day.title} /></label>
    <label className="field-label" htmlFor="session-edit-weekday">Scheduled day<select id="session-edit-weekday" name="session-edit-weekday" defaultValue={day.weekday ?? ""}><option value="">Flexible</option>{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((name, index) => <option value={index + 1} key={name}>{name}</option>)}</select></label>
    <button className="button button-primary" type="submit">Save session</button>
  </form></HealthSheet>;
}


function parseSets(input: string, exercise: StrengthProgramExercise) {
  return input.split(",").map((part) => {
    const match = part.trim().match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+)$/i);
    if (!match) return null;
    const weight = Number(match[1]); const reps = Number(match[2]);
    return weight >= 0 && reps > 0 ? { weight, reps, weight_unit: exercise.weight_unit } : null;
  }).filter((set): set is { weight: number; reps: number; weight_unit: "kg" | "lb" } => set !== null);
}
function value(data: FormData, key: string): string { return String(data.get(key) ?? "").trim(); }
function nullableValue(data: FormData, key: string): string | null { return value(data, key) || null; }
function numberValue(data: FormData, key: string): number | null { const parsed = Number(value(data, key)); return value(data, key) && Number.isFinite(parsed) ? parsed : null; }
function weekdayLabel(day: number): string { return ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][day] ?? "Flexible session"; }
