"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "@/app/daily-components";
import { HealthSheet } from "@/app/health-sheet";
import { localToday } from "@/lib/daily/repository";
import { isoToLocalDateTimeParts, localDateTimeToIso } from "@/lib/daily/timezone";
import { cacheRecord, deleteCachedRecord, listCachedRecords, listMutations, type JsonValue } from "@/lib/offline/outbox";
import { buildExerciseHistory, convertWeight } from "@/lib/fitness/records";
import { findSuggestedSession, formatPace } from "@/lib/fitness/flow";
import { projectLocalFitnessMutations } from "@/lib/fitness/projection";
import { emptyFitnessSnapshot, type FitnessActivityKind, type FitnessSnapshot, type StrengthProgram, type StrengthProgramDay, type StrengthProgramExercise, type WorkoutDraft, type WorkoutLog } from "@/lib/fitness/types";
import { loadFitnessSnapshot } from "@/lib/planning/repository";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/app/app-workspace";

type FitnessForm = "program" | "exercise" | "activity" | null;
interface WorkoutLogVersion { id: string; revision: number; created_at: string; snapshot: Record<string, unknown>; }

export default function FitnessPage() {
  const { ownerId, profile, database, refreshKey, queueMutation, online } = useWorkspace();
  const [snapshot, setSnapshot] = useState<FitnessSnapshot>(emptyFitnessSnapshot);
  const [drafts, setDrafts] = useState<WorkoutDraft[]>([]);
  const [activeDraft, setActiveDraft] = useState<WorkoutDraft | null>(null);
  const [finishDraft, setFinishDraft] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [editWorkout, setEditWorkout] = useState<WorkoutLog | null>(null);
  const [workoutVersions, setWorkoutVersions] = useState<WorkoutLogVersion[]>([]);
  const [form, setForm] = useState<FitnessForm>(null);
  const [overrideDay, setOverrideDay] = useState<StrengthProgramDay | null>(null);
  const [overrideDate, setOverrideDate] = useState("");
  const [logDay, setLogDay] = useState<StrengthProgramDay | null>(null);
  const [logDate, setLogDate] = useState("");
  const [logExercises, setLogExercises] = useState<StrengthProgramExercise[]>([]);
  const [editProgram, setEditProgram] = useState<StrengthProgram | null>(null);
  const [editDay, setEditDay] = useState<StrengthProgramDay | null>(null);
  const [exerciseDay, setExerciseDay] = useState<StrengthProgramDay | null>(null);
  const [editProgramExercise, setEditProgramExercise] = useState<StrengthProgramExercise | null>(null);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const recoveryShown = useRef(false);
  const editWorkoutId = editWorkout?.id;

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
          const savedDrafts = await listCachedRecords(database!, "fitness-draft:");
          const localDrafts = savedDrafts.map(({ payload }) => payload as unknown as WorkoutDraft);
          setDrafts(localDrafts);
          if (!recoveryShown.current && localDrafts.length) {
            recoveryShown.current = true;
            setRecoveryOpen(true);
          }
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Fitness data could not be loaded.");
      }
    }
    void load();
    return () => { active = false; };
  }, [database, ownerId, refreshKey]);

  useEffect(() => {
    if (!database) return;
    for (const draft of drafts) {
      void cacheRecord(database, { id: `fitness-draft:${draft.id}`, revision: 1, payload: draft as unknown as JsonValue, cachedAt: Date.now() });
    }
  }, [database, drafts]);

  useEffect(() => {
    if (!database || !editWorkoutId) return;
    let active = true;
    void createClient().from("record_versions").select("id,revision,created_at,snapshot")
      .eq("record_type", "workout_logs").eq("record_id", editWorkoutId).order("revision", { ascending: false }).limit(5)
      .then(({ data }) => { if (active) setWorkoutVersions((data ?? []) as unknown as WorkoutLogVersion[]); });
    return () => { active = false; };
  }, [database, editWorkoutId]);

  const records = useMemo(() => buildExerciseHistory(snapshot.workouts.map((workout) => ({
    id: workout.id,
    completed_at: workout.completed_at,
    local_date: workout.local_date,
    exercises: workout.exercises,
  })), profile.units === "metric" ? "kg" : "lb"), [snapshot.workouts, profile.units]);

  const today = localToday(profile.timezone);
  const weekday = ((new Date(`${today}T12:00:00.000Z`).getUTCDay() + 6) % 7) + 1;
  const suggested = findSuggestedSession(snapshot.programs, snapshot.programDays, weekday, today, snapshot.workouts);
  const suggestedOverride = suggested && snapshot.overrides.find(({ program_day_id, local_date }) => program_day_id === suggested.day.id && local_date === today);
  const suggestedBaseExercises = suggested && snapshot.programExercises.filter(({ program_day_id }) => program_day_id === suggested.day.id).sort((left, right) => left.sort_order - right.sort_order);
  const suggestedExercises = suggested ? suggestedOverride?.exercises ?? suggestedBaseExercises ?? [] : [];

  function startGuided(day: StrengthProgramDay, date: string, exercises: StrengthProgramExercise[], programId: string | null) {
    const started = new Date();
    const draft: WorkoutDraft = {
      id: crypto.randomUUID(), program_id: programId, program_day_id: day.id, local_date: date,
      timezone: profile.timezone, title_snapshot: day.title, started_at: started.toISOString(), notes: "",
      exercises: exercises.map((exercise) => ({
        exercise_id: exercise.exercise_id, exercise_name: exercise.exercise_name,
        sets: Array.from({ length: exercise.target_sets }, () => ({ weight: exercise.target_weight ?? 0, reps: exercise.target_reps, weight_unit: exercise.weight_unit })),
      })),
    };
    setDrafts((current) => [draft, ...current]);
    setRecoveryOpen(false);
    setActiveDraft(draft);
    setFinishDraft(false);
  }

  function updateDraft(nextDraft: WorkoutDraft) {
    setDrafts((current) => current.map((draft) => draft.id === nextDraft.id ? nextDraft : draft));
    setActiveDraft(nextDraft);
  }

  async function discardDraft(draft: WorkoutDraft) {
    if (!window.confirm("Discard this unfinished workout? This removes the saved draft.")) return;
    setDrafts((current) => current.filter(({ id }) => id !== draft.id));
    if (database) await deleteCachedRecord(database, `fitness-draft:${draft.id}`);
    setRecoveryOpen(false);
    if (activeDraft?.id === draft.id) setActiveDraft(null);
  }

  async function saveDraftAsWorkout(draft: WorkoutDraft, data: FormData) {
    const localDate = value(data, "finish-date");
    const startedAt = localDateTimeToIso(value(data, "finish-date"), value(data, "finish-start"), draft.timezone);
    const completedAt = localDateTimeToIso(value(data, "finish-date"), value(data, "finish-end"), draft.timezone);
    if (!startedAt || !completedAt || completedAt < startedAt) { setError("Choose a valid start and end time for this workout."); return; }
    const loggedExercises = draft.exercises.filter(({ skipped }) => !skipped).map((exercise) => ({
      exercise_id: exercise.exercise_id, exercise_name: exercise.exercise_name,
      sets: exercise.sets.filter((set) => !set.skipped && set.reps > 0 && set.weight >= 0).map((set) => ({ ...set, weight_unit: set.weight_unit ?? snapshot.exercises.find(({ id }) => id === exercise.exercise_id)?.load_unit ?? "kg" })),
    })).filter(({ sets }) => sets.length > 0);
    if (!loggedExercises.length) { setError("Add at least one completed set, or mark the session as skipped before saving."); return; }
    try {
      await queueMutation({ entityType: "workout_log", recordId: draft.id, expectedRevision: 0, payload: {
        program_id: draft.program_id, program_day_id: draft.program_day_id, local_date: localDate,
        timezone: draft.timezone, title_snapshot: draft.title_snapshot, started_at: startedAt, completed_at: completedAt,
        notes: draft.notes || null, exercises: loggedExercises, status: "logged",
      } as unknown as JsonValue });
      setDrafts((current) => current.filter(({ id }) => id !== draft.id));
      if (database) await deleteCachedRecord(database, `fitness-draft:${draft.id}`);
      setActiveDraft(null); setFinishDraft(false); setRecoveryOpen(false); setError("");
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "The workout could not be saved."); }
  }

  async function saveEditedWorkout(workout: WorkoutLog, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const localDate = value(data, "workout-date");
    const startedAt = localDateTimeToIso(localDate, value(data, "workout-start"), profile.timezone);
    const completedAt = localDateTimeToIso(localDate, value(data, "workout-end"), profile.timezone);
    if (!startedAt || !completedAt || completedAt < startedAt) { setError("Choose a valid start and end time for this workout."); return; }
    const exercises = workout.exercises.map((item) => ({
      exercise_id: item.exercise_id, exercise_name: item.exercise_name,
      sets: parseSetsFromText(value(data, `sets-${item.exercise_id}`), profile.units === "metric" ? "kg" : "lb"),
    })).filter(({ sets }) => sets.length > 0);
    if (!exercises.length) { setError("A saved workout needs at least one completed set."); return; }
    try {
      await queueMutation({ entityType: "workout_log", recordId: workout.id, expectedRevision: workout.revision, payload: {
        local_date: localDate, timezone: profile.timezone, title_snapshot: value(data, "workout-title"), started_at: startedAt,
        completed_at: completedAt, notes: nullableValue(data, "workout-notes"), exercises, status: "logged",
      } as unknown as JsonValue });
      setEditWorkout(null); setError("");
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "The workout could not be updated."); }
  }

  async function restoreWorkoutVersion(workout: WorkoutLog, version: WorkoutLogVersion) {
    const old = version.snapshot;
    try {
      await queueMutation({ entityType: "workout_log", recordId: workout.id, expectedRevision: workout.revision, payload: {
        local_date: old.local_date, timezone: old.timezone, title_snapshot: old.title_snapshot,
        started_at: old.started_at, completed_at: old.completed_at, notes: old.notes,
        exercises: old.exercises, status: "logged",
      } as unknown as JsonValue });
      setEditWorkout(null); setError("");
    } catch (restoreError) { setError(restoreError instanceof Error ? restoreError.message : "That version could not be restored."); }
  }

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
    const distance = numberValue(data, "activity-distance");
    if (kind === "run" && (!distance || distance <= 0)) { setError("Add the run distance to calculate pace."); return; }
    try {
      await queueMutation({ entityType: "fitness_activity_log", recordId: crypto.randomUUID(), expectedRevision: 0, payload: {
        activity_kind: kind, local_date: value(data, "activity-date") || localToday(profile.timezone), title,
        sport: kind === "sport" ? sport : null,
        duration_minutes: duration, distance,
        distance_unit: kind === "run" ? (profile.units === "metric" ? "km" : "mi") : null, intensity: value(data, "activity-intensity") || null,
        notes: nullableValue(data, "activity-notes"),
      } });
      setForm(null); setError("");
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "The activity could not be saved."); }
  }

  async function submitQuickWorkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!logDay) return;
    const data = new FormData(event.currentTarget);
    const localDate = value(data, "workout-date");
    const startedAt = localDateTimeToIso(localDate, value(data, "workout-start"), profile.timezone);
    const completedAt = localDateTimeToIso(localDate, value(data, "workout-end"), profile.timezone);
    if (!startedAt || !completedAt || completedAt < startedAt) { setError("Choose a valid start and end time for this workout."); return; }
    const exercises = logExercises.map((item) => ({
      exercise_id: item.exercise_id, exercise_name: item.exercise_name, sets: parseSetsFromText(value(data, `sets-${item.id}`), item.weight_unit),
    })).filter(({ sets }) => sets.length > 0);
    if (!exercises.length) { setError("Add at least one completed set. The rest can remain skipped."); return; }
    const programId = snapshot.programDays.find(({ id }) => id === logDay.id)?.program_id ?? null;
    try {
      await queueMutation({ entityType: "workout_log", recordId: crypto.randomUUID(), expectedRevision: 0, payload: {
        program_id: programId, program_day_id: logDay.id, local_date: localDate, timezone: profile.timezone,
        title_snapshot: value(data, "workout-title") || logDay.title, started_at: startedAt, completed_at: completedAt,
        notes: nullableValue(data, "workout-notes"), exercises, status: "logged",
      } as unknown as JsonValue });
      setLogDay(null); setLogDate(""); setError("");
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "The workout could not be saved."); }
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
      <section className="fitness-feature" aria-labelledby="fitness-feature-title">
        <div className="fitness-feature-copy">
          <span className="eyebrow">YOUR NEXT SESSION</span>
          <h2 id="fitness-feature-title">{suggested ? suggested.day.title : "Move at your own pace"}</h2>
          <p>{suggested ? `${suggested.program.title} · ${suggested.day.weekday === null ? "Flexible session" : weekdayLabel(suggested.day.weekday)}` : "Create a program or log a run or sport session to start your history."}</p>
          {suggested && suggestedExercises.length > 0 && !suggestedOverride?.skipped && <button className="button button-primary" type="button" onClick={() => startGuided(suggestedOverride?.title ? { ...suggested.day, title: suggestedOverride.title } : suggested.day, today, suggestedExercises, suggested.program.id)}>Start guided session <span aria-hidden="true">→</span></button>}
          {suggested && suggestedExercises.length === 0 && <button className="button button-primary" type="button" onClick={() => setExerciseDay(suggested.day)}>Add session exercises <span aria-hidden="true">→</span></button>}
          {suggested && suggestedOverride?.skipped && <p className="health-muted">This session is skipped today. Choose another session below.</p>}
          {!suggested && <button className="button button-primary" type="button" onClick={() => setForm("program")}>Create a program <span aria-hidden="true">→</span></button>}
        </div>
        <svg className="fitness-feature-art" viewBox="0 0 260 170" role="img" aria-label="Compass fitness illustration with a barbell and rising movement path">
          <path d="M12 147h236" fill="none" stroke="currentColor" strokeOpacity=".14" strokeWidth="2" />
          <path d="M22 133c31-5 41-45 75-45s42 37 74 26 32-38 67-47" fill="none" stroke="#24c8df" strokeLinecap="round" strokeWidth="5" />
          <path d="m224 58 16 7-13 12" fill="none" stroke="#24c8df" strokeLinecap="round" strokeLinejoin="round" strokeWidth="5" />
          <circle cx="97" cy="51" r="16" fill="#f0bd43" fillOpacity=".9" />
          <path d="M82 84c10-9 23-8 31 3l14 20 28 2c8 1 9 13 0 14l-34 2-19-17-15 17-23-2 18-26Z" fill="#efede7" fillOpacity=".86" />
          <path d="m68 119-24 16m70-10 17 20m-61-30-14-28" fill="none" stroke="#efede7" strokeLinecap="round" strokeWidth="8" />
          <path d="M165 36v22m-12-18v14m-7-12h38m-7-4v14" fill="none" stroke="#f0bd43" strokeLinecap="round" strokeWidth="4" />
        </svg>
      </section>
      {drafts.length > 0 && <section className="health-section" aria-labelledby="drafts-title">
        <div className="health-section-heading"><div><span className="eyebrow">SAVED ON THIS DEVICE</span><h2 id="drafts-title">In-progress workouts</h2></div><span className="health-count">{drafts.length} drafts</span></div>
        {drafts.map((draft) => <article className="health-record" key={draft.id}><div><strong>{draft.title_snapshot}</strong><small>Started {isoToLocalDateTimeParts(draft.started_at, draft.timezone).date} · {draft.exercises.length} exercises</small></div><div className="health-actions"><button className="text-button" type="button" onClick={() => { setActiveDraft(draft); setFinishDraft(false); }}>Resume</button><button className="text-button" type="button" onClick={() => { setActiveDraft(draft); setFinishDraft(true); }}>Finish</button><button className="text-button" type="button" onClick={() => void discardDraft(draft)}>Discard</button></div></article>)}
      </section>}
      <section className="health-section" aria-labelledby="programs-title">
        <div className="health-section-heading"><div><span className="eyebrow">STRENGTH</span><h2 id="programs-title">Programs and sessions</h2></div><span className="health-count">{snapshot.programs.filter(({ status }) => status === "active").length} active</span></div>
        {snapshot.programs.filter(({ status }) => status === "active").length === 0 ? <div className="health-empty"><h3>Build a repeatable strength plan.</h3><p>Create a program, add sessions and exercises, then log what you completed.</p><button className="text-button" type="button" onClick={() => setForm("program")}>Create your first program <span aria-hidden="true">→</span></button></div> : <div className="health-program-list">{snapshot.programs.filter(({ status }) => status === "active").map((program) => <ProgramCard key={program.id} program={program} snapshot={snapshot} today={today} onEdit={() => { setEditProgram(program); setForm("program"); }} onArchive={() => void queueMutation({ entityType: "strength_program", recordId: program.id, expectedRevision: program.revision, payload: { title: program.title, notes: program.notes, status: "archived" } })} onAddDay={async () => {
          const dayId = crypto.randomUUID();
          await queueMutation({ entityType: "strength_program_day", recordId: dayId, expectedRevision: 0, payload: { program_id: program.id, title: "New session", weekday: null, sort_order: snapshot.programDays.filter(({ program_id }) => program_id === program.id).length } });
        }} onLog={(day, date, sessionExercises) => { setLogDay(day); setLogDate(date); setLogExercises(sessionExercises); }} onGuided={(day, date, sessionExercises) => startGuided(day, date, sessionExercises, program.id)} onOverride={(day, date) => { setOverrideDay(day); setOverrideDate(date); }} onResetOverride={(override) => void queueMutation({ entityType: "strength_override", recordId: override.id, expectedRevision: override.revision, payload: { program_day_id: override.program_day_id, local_date: override.local_date, title: null, notes: null, skipped: false, exercises: null } })} onAddExercise={setExerciseDay} onEditExercise={(row) => { setEditProgramExercise(row); setExerciseDay(snapshot.programDays.find(({ id }) => id === row.program_day_id) ?? null); }} onEditDay={setEditDay} onMoveExercise={(row, direction) => {
          const peers = snapshot.programExercises.filter(({ program_day_id }) => program_day_id === row.program_day_id).sort((a, b) => a.sort_order - b.sort_order);
          const index = peers.findIndex(({ id }) => id === row.id); const target = peers[index + direction];
          if (!target) return;
          void queueMutation({ entityType: "strength_program_exercise", recordId: row.id, expectedRevision: row.revision, payload: { ...row, sort_order: target.sort_order } });
          void queueMutation({ entityType: "strength_program_exercise", recordId: target.id, expectedRevision: target.revision, payload: { ...target, sort_order: row.sort_order } });
      }} />)}</div>}
      </section>
      <section className="health-section" aria-labelledby="activities-title">
        <div className="health-section-heading"><div><span className="eyebrow">MOVEMENT</span><h2 id="activities-title">Runs and sports</h2></div><button className="text-button" type="button" onClick={() => setForm("activity")}>Log a session <span aria-hidden="true">+</span></button></div>
      {snapshot.activities.length === 0 ? <p className="health-muted">Runs and sports can be logged manually, with no provider connection required.</p> : <div className="health-record-list">{snapshot.activities.slice(0, 12).map((activity) => <article className="health-record" key={activity.id}><div><strong>{activity.title}</strong><small>{activity.local_date} · {activity.activity_kind === "run" ? "Run" : activity.sport || "Sports"}</small></div><span>{activity.duration_minutes} min{activity.distance ? ` · ${activity.distance} ${activity.distance_unit}` : ""}{activity.activity_kind === "run" && activity.distance ? ` · ${formatPace(activity.distance, activity.duration_minutes, activity.distance_unit ?? "km")}` : ""}</span></article>)}</div>}
      </section>
      <section className="health-section" aria-labelledby="workout-history-title">
        <div className="health-section-heading"><div><span className="eyebrow">COMPLETED</span><h2 id="workout-history-title">Workout history</h2></div><span className="health-count">{snapshot.workouts.length} saved</span></div>
        {snapshot.workouts.length === 0 ? <p className="health-muted">Finished strength workouts will appear here. You can edit their details later.</p> : <div className="health-record-list">{snapshot.workouts.slice().sort((a, b) => b.completed_at.localeCompare(a.completed_at)).slice(0, 20).map((workout) => <article className="health-record" key={workout.id}><div><strong>{workout.title_snapshot}</strong><small>{workout.local_date} · {workout.exercises.length} exercises</small></div><div className="health-actions"><span>{workout.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0)} sets</span><button className="text-button" type="button" onClick={() => { setWorkoutVersions([]); setEditWorkout(workout); setError(""); }}>Edit log</button></div></article>)}</div>}
      </section>
      <section className="health-section" aria-labelledby="records-title">
        <div className="health-section-heading"><div><span className="eyebrow">FROM COMPLETED SETS</span><h2 id="records-title">Personal records</h2></div><span className="health-count">{records.length} exercises</span></div>
        {records.length > 0 && <p className="health-muted">Estimated 1RM uses the Epley formula (load × (1 + reps ÷ 30)); singles use the recorded load.</p>}
        {records.length === 0 ? <p className="health-muted">Your PRs and estimated one-rep max history will appear after you log strength sets.</p> : <div className="health-record-list">{records.map((history) => <ExerciseRecordDetail history={history} key={history.exercise_id} />)}</div>}
      </section>
      {form === "program" && <ProgramForm program={editProgram} error={error} firstDay={editProgram ? snapshot.programDays.find(({ program_id }) => program_id === editProgram.id) ?? null : null} onClose={() => { setForm(null); setEditProgram(null); setError(""); }} onSubmit={submitProgram} />}
      {form === "exercise" && <ExerciseForm error={error} onClose={() => { setForm(null); setError(""); }} onSubmit={submitExercise} />}
      {form === "activity" && <ActivityForm error={error} onClose={() => { setForm(null); setError(""); }} onSubmit={submitActivity} timezone={profile.timezone} units={profile.units} recentSports={[...new Set(snapshot.activities.map(({ sport }) => sport).filter((sport): sport is string => Boolean(sport)))]} />}
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
      {overrideDay && <OverrideForm key={`${overrideDay.id}:${overrideDate}:${snapshot.overrides.find((item) => item.program_day_id === overrideDay.id && item.local_date === overrideDate)?.id ?? "new"}`} day={overrideDay} baseExercises={snapshot.programExercises.filter(({ program_day_id }) => program_day_id === overrideDay.id).sort((a, b) => a.sort_order - b.sort_order)} library={snapshot.exercises.filter(({ is_archived }) => !is_archived)} error={error} timezone={profile.timezone} initialDate={overrideDate} existing={snapshot.overrides.find((item) => item.program_day_id === overrideDay.id && item.local_date === overrideDate)} onClose={() => { setOverrideDay(null); setOverrideDate(""); setError(""); }} onSubmit={async (event, overrideExercises) => {
        event.preventDefault(); const data = new FormData(event.currentTarget); const existing = snapshot.overrides.find((item) => item.program_day_id === overrideDay.id && item.local_date === value(data, "override-date"));
        if (data.get("override-skipped") !== "on" && (!overrideExercises.length || overrideExercises.some(({ target_sets, target_reps, target_weight }) => target_sets < 1 || target_reps < 1 || (target_weight !== null && target_weight < 0)))) { setError("Keep one valid exercise in this date plan, or mark the session as skipped."); return; }
        try { await queueMutation({ entityType: "strength_override", recordId: existing?.id ?? crypto.randomUUID(), expectedRevision: existing?.revision ?? 0, payload: {
          program_day_id: overrideDay.id, local_date: value(data, "override-date"), title: nullableValue(data, "override-title"), notes: nullableValue(data, "override-notes"), skipped: data.get("override-skipped") === "on", exercises: overrideExercises,
        } as unknown as JsonValue }); setOverrideDay(null); } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "The override could not be saved."); }
      }} />}
      {logDay && <WorkoutLogForm day={logDay} date={logDate} error={error} exercises={logExercises} timezone={profile.timezone} onClose={() => { setLogDay(null); setLogDate(""); setError(""); }} onSubmit={submitQuickWorkout} />}
      {activeDraft && <GuidedWorkoutSheet draft={activeDraft} finishing={finishDraft} error={error} onChange={updateDraft} onFinish={(event) => { event.preventDefault(); void saveDraftAsWorkout(activeDraft, new FormData(event.currentTarget)); }} onClose={() => { setActiveDraft(null); setFinishDraft(false); setError(""); }} onFinishMode={() => setFinishDraft(true)} />}
      {recoveryOpen && drafts.length > 0 && <RecoverySheet drafts={drafts} onResume={(draft) => { setActiveDraft(draft); setRecoveryOpen(false); setFinishDraft(false); }} onFinish={(draft) => { setActiveDraft(draft); setRecoveryOpen(false); setFinishDraft(true); }} onDiscard={(draft) => void discardDraft(draft)} onClose={() => setRecoveryOpen(false)} />}
      {editWorkout && <CompletedWorkoutForm workout={editWorkout} versions={workoutVersions} displayUnit={profile.units === "metric" ? "kg" : "lb"} error={error} onClose={() => { setEditWorkout(null); setError(""); }} onSubmit={(event) => void saveEditedWorkout(editWorkout, event)} onRestore={(version) => void restoreWorkoutVersion(editWorkout, version)} />}
      {error && <p className="health-toast" role="alert">{error}</p>}
    </div>
  );
}

function ProgramCard({ program, snapshot, today, onEdit, onArchive, onAddDay, onLog, onGuided, onOverride, onResetOverride, onAddExercise, onEditExercise, onEditDay, onMoveExercise }: {
  program: StrengthProgram; snapshot: FitnessSnapshot; today: string; onEdit(): void; onArchive(): void; onAddDay(): void; onLog(day: StrengthProgramDay, date: string, exercises: StrengthProgramExercise[]): void;
  onGuided(day: StrengthProgramDay, date: string, exercises: StrengthProgramExercise[]): void; onOverride(day: StrengthProgramDay, date: string): void; onResetOverride(override: FitnessSnapshot["overrides"][number]): void;
  onAddExercise(day: StrengthProgramDay): void; onEditExercise(row: StrengthProgramExercise): void; onEditDay(day: StrengthProgramDay): void;
  onMoveExercise(row: StrengthProgramExercise, direction: number): void;
}) {
  const [selectedDate, setSelectedDate] = useState(today);
  const days = snapshot.programDays.filter(({ program_id }) => program_id === program.id).sort((a, b) => a.sort_order - b.sort_order);
  return <article className="health-program"><div className="health-section-heading"><div><h3>{program.title}</h3>{program.notes && <p>{program.notes}</p>}</div><div className="health-actions"><button className="text-button" type="button" onClick={onEdit}>Edit</button><button className="text-button" type="button" onClick={onArchive}>Archive</button></div></div>
    {days.map((day) => { const baseItems = snapshot.programExercises.filter(({ program_day_id }) => program_day_id === day.id).sort((a, b) => a.sort_order - b.sort_order); const override = snapshot.overrides.find(({ program_day_id, local_date }) => program_day_id === day.id && local_date === selectedDate); const items = override?.exercises ?? baseItems; const session = override?.title ? { ...day, title: override.title } : day; const futureDate = selectedDate > today; return <section className="health-session" key={day.id}>
      <div className="health-session-date"><label className="field-label" htmlFor={`session-date-${day.id}`}>Plan date<input id={`session-date-${day.id}`} type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label></div>
      <div className="health-section-heading"><div><h4>{session.title}</h4><small>{day.weekday === null ? "Flexible session" : weekdayLabel(day.weekday)}</small></div><div className="health-actions"><button className="text-button" type="button" onClick={() => onEditDay(day)}>Edit base</button><button className="text-button" type="button" onClick={() => onOverride(day, selectedDate)}>{override ? "Edit date plan" : "Customize date"}</button>{override && <button className="text-button" type="button" onClick={() => onResetOverride(override)}>Reset date</button>}</div></div>
      {override && <p className="health-banner">{override.skipped ? `Skipped on ${selectedDate}` : `Override for ${selectedDate}${override.title ? ` · ${override.title}` : ""}`}{override.notes ? ` · ${override.notes}` : ""}</p>}
      {items.length === 0 ? <p className="health-muted">Add exercises to make this session ready to log.</p> : <div className="health-program-exercises">{items.map((item, index) => <div className="health-record" key={item.id}><div><strong>{item.exercise_name}</strong><small>{item.target_sets} × {item.target_reps}{item.target_weight ? ` · ${item.target_weight} ${item.weight_unit}` : ""}</small></div>{override?.exercises && <span className="health-count">{index + 1}</span>}{!override?.exercises && <div className="health-actions"><button className="text-button" type="button" onClick={() => onEditExercise(item)}>Edit</button><button className="icon-button" type="button" aria-label={`Move ${item.exercise_name} up`} onClick={() => onMoveExercise(item, -1)} disabled={index === 0}>↑</button><button className="icon-button" type="button" aria-label={`Move ${item.exercise_name} down`} onClick={() => onMoveExercise(item, 1)} disabled={index === items.length - 1}>↓</button></div>}</div>)}</div>}
      <div className="health-actions"><button className="text-button" type="button" onClick={() => onAddExercise(day)}>Add exercise <span aria-hidden="true">+</span></button><button className="button button-secondary" type="button" onClick={() => onLog(session, selectedDate, items)} disabled={!items.length || Boolean(override?.skipped) || futureDate}>Log after workout</button><button className="button button-primary" type="button" onClick={() => onGuided(session, selectedDate, items)} disabled={!items.length || Boolean(override?.skipped) || futureDate}>Start guided</button></div>
    </section>; })}
    <button className="text-button" type="button" onClick={onAddDay}>Add session <span aria-hidden="true">+</span></button>
  </article>;
}

function ExerciseRecordDetail({ history }: { history: ReturnType<typeof buildExerciseHistory>[number] }) {
  const bestEstimate = Math.max(...history.sessions.map(({ estimated_one_rep_max }) => estimated_one_rep_max));
  const bestByRep = new Map<number, number>();
  for (const session of history.sessions) for (const record of session.records) bestByRep.set(record.reps, Math.max(bestByRep.get(record.reps) ?? 0, record.weight));
  const values = history.sessions.map(({ estimated_one_rep_max }) => estimated_one_rep_max);
  const range = Math.max(...values) - Math.min(...values) || 1;
  const points = values.map((value, index) => `${values.length > 1 ? index / (values.length - 1) * 100 : 50},${26 - (value - Math.min(...values)) / range * 22}`).join(" ");
  return <details className="health-record-detail"><summary><strong>{history.exercise_name}</strong><span>Best estimated 1RM {bestEstimate} {history.weight_unit} · {history.sessions.length} sessions</span></summary><div className="fitness-record-trend"><svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-label={`${history.exercise_name} estimated one-rep-max trend`}><polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg><strong>Estimated 1RM · {history.weight_unit}</strong></div><div className="fitness-rep-records">{[...bestByRep].sort(([left], [right]) => left - right).map(([reps, weight]) => <span key={reps}>{reps} rep{reps === 1 ? "" : "s"}<strong>{weight} {history.weight_unit}</strong></span>)}</div><div className="health-record-history">{history.sessions.slice().reverse().map((session) => <article className="health-record" key={`${session.workout_id}:${session.date}`}><div><strong>{session.date}</strong><small>Estimated 1RM · {session.estimated_one_rep_max} {history.weight_unit}</small></div><span>{session.records.map(({ weight, reps }) => `${weight} × ${reps} ${history.weight_unit}`).join(" · ") || "No new load record"}</span></article>)}</div></details>;
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

function ActivityForm({ error, onClose, onSubmit, timezone, units, recentSports }: { error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void; timezone: string; units: "metric" | "imperial"; recentSports: string[] }) {
  const [kind, setKind] = useState<FitnessActivityKind>("run");
  const [distance, setDistance] = useState("");
  const [duration, setDuration] = useState("");
  const unit = units === "metric" ? "km" : "mi";
  const pace = formatPace(Number(distance), Number(duration), unit);
  return <HealthSheet eyebrow="FITNESS" title="Quick movement log" error={error} onClose={onClose}><form className="sheet-form" onSubmit={onSubmit}>
    <label className="field-label" htmlFor="activity-kind">Activity<select id="activity-kind" name="activity-kind" value={kind} onChange={(event) => setKind(event.target.value as FitnessActivityKind)}><option value="run">Run</option><option value="sport">Sports session</option></select></label>
    {kind === "sport" && <label className="field-label" htmlFor="activity-sport">Sport<input id="activity-sport" name="activity-sport" list="recent-sports" maxLength={80} placeholder="Basketball, pickleball…" required /></label>}
    <label className="field-label" htmlFor="activity-title">Session name <span className="optional-label">Optional</span><input id="activity-title" name="activity-title" maxLength={120} placeholder={kind === "run" ? "Easy morning run" : "Evening game"} /></label>
    <div className="health-form-grid"><label className="field-label" htmlFor="activity-date">Date<input id="activity-date" name="activity-date" type="date" defaultValue={localToday(timezone)} required /></label><label className="field-label" htmlFor="activity-duration">Duration (min)<input id="activity-duration" name="activity-duration" type="number" min="1" step="1" value={duration} onChange={(event) => setDuration(event.target.value)} required /></label></div>
    {kind === "run" && <><div className="health-form-grid"><label className="field-label" htmlFor="activity-distance">Distance<input id="activity-distance" name="activity-distance" type="number" min="0.01" step="any" value={distance} onChange={(event) => setDistance(event.target.value)} required /></label><label className="field-label" htmlFor="activity-distance-unit">Unit<select id="activity-distance-unit" name="activity-distance-unit" value={unit} disabled><option value={unit}>{unit}</option></select></label></div><p className="health-muted">Average pace: <strong>{pace ?? "Add distance and duration"}</strong></p></>}
    <label className="field-label" htmlFor="activity-intensity">Effort <span className="optional-label">Optional</span><select id="activity-intensity" name="activity-intensity" defaultValue=""><option value="">Not recorded</option><option value="easy">Easy</option><option value="moderate">Moderate</option><option value="hard">Hard</option></select></label>
    <label className="field-label" htmlFor="activity-notes">Notes <span className="optional-label">Optional</span><textarea id="activity-notes" name="activity-notes" maxLength={1000} /></label>
    <datalist id="recent-sports">{recentSports.map((sport) => <option value={sport} key={sport} />)}</datalist>
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

function OverrideForm({ day, baseExercises, library, timezone, initialDate, existing, error, onClose, onSubmit }: { day: StrengthProgramDay; baseExercises: StrengthProgramExercise[]; library: FitnessSnapshot["exercises"]; timezone: string; initialDate: string; existing: FitnessSnapshot["overrides"][number] | undefined; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>, exercises: StrengthProgramExercise[]): void }) {
  const [rows, setRows] = useState<StrengthProgramExercise[]>(existing?.exercises ?? baseExercises);
  const [addId, setAddId] = useState("");
  function update(index: number, change: Partial<StrengthProgramExercise>) { setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...change } : row)); }
  function addExercise() {
    const exercise = library.find(({ id }) => id === addId);
    if (!exercise) return;
    setRows((current) => [...current, { id: crypto.randomUUID(), program_day_id: day.id, exercise_id: exercise.id, exercise_name: exercise.name, target_sets: 3, target_reps: 8, target_weight: null, weight_unit: exercise.load_unit, sort_order: current.length, revision: 0 }]);
    setAddId("");
  }
  return <HealthSheet eyebrow="FITNESS" title={`Customize ${day.title}`} error={error} onClose={onClose}><form className="sheet-form" onSubmit={(event) => onSubmit(event, rows)}>
    <label className="field-label" htmlFor="override-date">Date<input id="override-date" name="override-date" type="date" defaultValue={existing?.local_date ?? initialDate ?? localToday(timezone)} required /></label>
    <label className="field-label" htmlFor="override-title">Alternate session name <span className="optional-label">Optional</span><input id="override-title" name="override-title" maxLength={120} defaultValue={existing?.title ?? ""} /></label>
    <label className="field-label" htmlFor="override-notes">Notes <span className="optional-label">Optional</span><textarea id="override-notes" name="override-notes" maxLength={1000} defaultValue={existing?.notes ?? ""} /></label>
    <label className="field-checkbox"><input type="checkbox" name="override-skipped" defaultChecked={existing?.skipped ?? false} /> Skip this session on the selected date</label>
    <div className="override-exercise-list"><strong>Exercises for this date</strong>{rows.map((row, index) => <fieldset className="override-exercise" key={row.id}><legend>{index + 1}. {row.exercise_name}</legend><div className="health-form-grid"><label className="field-label">Sets<input type="number" min="1" max="20" value={row.target_sets} onChange={(event) => update(index, { target_sets: Number(event.target.value) })} /></label><label className="field-label">Reps<input type="number" min="1" max="100" value={row.target_reps} onChange={(event) => update(index, { target_reps: Number(event.target.value) })} /></label></div><label className="field-label">Target load · {row.weight_unit}<input type="number" min="0" step="any" value={row.target_weight ?? ""} onChange={(event) => update(index, { target_weight: event.target.value ? Number(event.target.value) : null })} /></label><div className="health-actions"><button className="text-button" type="button" disabled={index === 0} onClick={() => setRows((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next.map((item, order) => ({ ...item, sort_order: order })); })}>Move up</button><button className="text-button" type="button" onClick={() => setRows((current) => current.filter(({ id }) => id !== row.id).map((item, order) => ({ ...item, sort_order: order })))}>Remove</button></div></fieldset>)}
      {library.length > 0 && <div className="health-actions"><select aria-label="Exercise to add" value={addId} onChange={(event) => setAddId(event.target.value)}><option value="">Add an exercise…</option>{library.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}</select><button className="button button-secondary" type="button" disabled={!addId} onClick={addExercise}>Add</button></div>}
    </div>
    <button className="button button-primary" type="submit">Save date plan</button>
  </form></HealthSheet>;
}

function WorkoutLogForm({ day, date, exercises, timezone, error, onClose, onSubmit }: { day: StrengthProgramDay; date: string; exercises: StrengthProgramExercise[]; timezone: string; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  const now = new Date();
  const localDate = date || localToday(timezone);
  const startDate = new Date(now.getTime() - 30 * 60000);
  const endTime = isoToLocalDateTimeParts(now.toISOString(), timezone).time;
  const startTime = isoToLocalDateTimeParts(startDate.toISOString(), timezone).time;
  return <HealthSheet eyebrow="FITNESS" title={`Log ${day.title}`} error={error} onClose={onClose}><form className="sheet-form" onSubmit={onSubmit}>
    <label className="field-label" htmlFor="workout-title">Workout name<input id="workout-title" name="workout-title" maxLength={120} defaultValue={day.title} required /></label>
    <p className="health-muted">Quick entry after your workout. Leave unfinished exercises blank; saved sets keep their original names and targets.</p>
    {exercises.map((exercise) => <label className="field-label" htmlFor={`sets-${exercise.id}`} key={exercise.id}>{exercise.exercise_name}<small>{exercise.target_sets} planned sets · {exercise.target_reps} target reps · {exercise.weight_unit}</small><input id={`sets-${exercise.id}`} name={`sets-${exercise.id}`} defaultValue={exercise.target_weight === null ? "" : Array.from({ length: exercise.target_sets }, () => `${exercise.target_weight}x${exercise.target_reps}`).join(", ")} placeholder="60x8, 60x8, 55x8" /></label>)}
    <div className="health-form-grid"><label className="field-label" htmlFor="workout-date">Workout date<input id="workout-date" name="workout-date" type="date" defaultValue={localDate} required /></label><label className="field-label" htmlFor="workout-start">Started<input id="workout-start" name="workout-start" type="time" defaultValue={startTime} required /></label><label className="field-label" htmlFor="workout-end">Finished<input id="workout-end" name="workout-end" type="time" defaultValue={endTime} required /></label></div>
    <label className="field-label" htmlFor="workout-notes">Notes <span className="optional-label">Optional</span><textarea id="workout-notes" name="workout-notes" maxLength={2000} /></label>
    <button className="button button-primary" type="submit">Save completed workout</button>
  </form></HealthSheet>;
}

function GuidedWorkoutSheet({ draft, finishing, error, onChange, onFinish, onClose, onFinishMode }: { draft: WorkoutDraft; finishing: boolean; error: string; onChange(draft: WorkoutDraft): void; onFinish(event: FormEvent<HTMLFormElement>): void; onClose(): void; onFinishMode(): void }) {
  const [startParts] = useState(() => isoToLocalDateTimeParts(draft.started_at, draft.timezone));
  const now = new Date();
  const endTime = isoToLocalDateTimeParts(now.toISOString(), draft.timezone).time;
  function patchExercise(index: number, update: Partial<WorkoutDraft["exercises"][number]>) {
    onChange({ ...draft, exercises: draft.exercises.map((exercise, exerciseIndex) => exerciseIndex === index ? { ...exercise, ...update } : exercise) });
  }
  function patchSet(exerciseIndex: number, setIndex: number, update: Partial<WorkoutDraft["exercises"][number]["sets"][number]>) {
    onChange({ ...draft, exercises: draft.exercises.map((exercise, index) => index === exerciseIndex ? { ...exercise, sets: exercise.sets.map((set, row) => row === setIndex ? { ...set, ...update } : set) } : exercise) });
  }
  return <HealthSheet eyebrow="GUIDED WORKOUT" title={draft.title_snapshot} error={error} onClose={onClose}><form className="sheet-form guided-workout" onSubmit={onFinish}>
    <label className="field-label" htmlFor="draft-title">Workout name<input id="draft-title" value={draft.title_snapshot} onChange={(event) => onChange({ ...draft, title_snapshot: event.target.value })} required /></label>
    {draft.exercises.map((exercise, exerciseIndex) => <fieldset className={`guided-exercise${exercise.skipped ? " is-skipped" : ""}`} key={exercise.exercise_id}>
      <legend>{exerciseIndex + 1}. {exercise.exercise_name}</legend>
      <label className="field-checkbox"><input type="checkbox" checked={exercise.skipped ?? false} onChange={(event) => patchExercise(exerciseIndex, { skipped: event.target.checked })} /> Skip this exercise</label>
      {!exercise.skipped && <><div className="guided-set-heading"><span>Set</span><span>Target</span><span>Actual load</span><span>Reps</span><span>Skip</span></div>
        {exercise.sets.map((set, setIndex) => <div className={`guided-set-row${set.skipped ? " is-skipped" : ""}`} key={`${exercise.exercise_id}:${setIndex}`}><strong>{setIndex + 1}</strong><small>{set.reps} reps</small><input aria-label={`${exercise.exercise_name} set ${setIndex + 1} load`} type="number" min="0" step="any" value={set.weight} disabled={set.skipped} onChange={(event) => patchSet(exerciseIndex, setIndex, { weight: Number(event.target.value) || 0 })} /><input aria-label={`${exercise.exercise_name} set ${setIndex + 1} reps`} type="number" min="1" step="1" value={set.reps} disabled={set.skipped} onChange={(event) => patchSet(exerciseIndex, setIndex, { reps: Number(event.target.value) || 1 })} /><input aria-label={`Skip ${exercise.exercise_name} set ${setIndex + 1}`} type="checkbox" checked={set.skipped ?? false} onChange={(event) => patchSet(exerciseIndex, setIndex, { skipped: event.target.checked })} /></div>)}
        <button className="text-button" type="button" onClick={() => onChange({ ...draft, exercises: draft.exercises.map((item, index) => index === exerciseIndex ? { ...item, sets: [...item.sets, { weight: item.sets.at(-1)?.weight ?? 0, reps: item.sets.at(-1)?.reps ?? 8, weight_unit: item.sets.at(-1)?.weight_unit ?? "kg" }] } : item) })}>Add set <span aria-hidden="true">+</span></button>
      </>}
    </fieldset>)}
    <label className="field-label" htmlFor="draft-notes">Notes <span className="optional-label">Optional</span><textarea id="draft-notes" value={draft.notes} onChange={(event) => onChange({ ...draft, notes: event.target.value })} /></label>
    {finishing ? <><p className="health-muted">Confirm the workout date and time. Skipped sets and exercises will be left out.</p><div className="health-form-grid"><label className="field-label" htmlFor="finish-date">Workout date<input id="finish-date" name="finish-date" type="date" defaultValue={draft.local_date || startParts.date} required /></label><label className="field-label" htmlFor="finish-start">Started<input id="finish-start" name="finish-start" type="time" defaultValue={startParts.time} required /></label><label className="field-label" htmlFor="finish-end">Finished<input id="finish-end" name="finish-end" type="time" defaultValue={endTime} required /></label></div><button className="button button-primary" type="submit">Finish and save workout</button></> : <div className="guided-actions"><button className="button button-secondary" type="button" onClick={onClose}>Save draft and close</button><button className="button button-primary" type="button" onClick={onFinishMode}>Finish and save</button></div>}
  </form></HealthSheet>;
}

function RecoverySheet({ drafts, onResume, onFinish, onDiscard, onClose }: { drafts: WorkoutDraft[]; onResume(draft: WorkoutDraft): void; onFinish(draft: WorkoutDraft): void; onDiscard(draft: WorkoutDraft): void; onClose(): void }) {
  return <HealthSheet eyebrow="WORKOUT RECOVERY" title="You have unfinished workouts" error="" onClose={onClose}><div className="sheet-form"><p className="health-muted">Pick up where you left off, finish a workout with its correct date and time, or discard its saved draft.</p>{drafts.map((draft) => <article className="health-record" key={draft.id}><div><strong>{draft.title_snapshot}</strong><small>{isoToLocalDateTimeParts(draft.started_at, draft.timezone).date} · {draft.exercises.length} exercises</small></div><div className="recovery-actions"><button className="text-button" type="button" onClick={() => onResume(draft)}>Resume</button><button className="text-button" type="button" onClick={() => onFinish(draft)}>Finish and save</button><button className="text-button" type="button" onClick={() => onDiscard(draft)}>Discard</button></div></article>)}</div></HealthSheet>;
}

function CompletedWorkoutForm({ workout, versions, displayUnit, error, onClose, onSubmit, onRestore }: { workout: WorkoutLog; versions: WorkoutLogVersion[]; displayUnit: "kg" | "lb"; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void; onRestore(version: WorkoutLogVersion): void }) {
  const timezone = workout.timezone;
  const startValue = workout.started_at ?? new Date(new Date(workout.completed_at).getTime() - 30 * 60000).toISOString();
  const start = isoToLocalDateTimeParts(startValue, timezone);
  const end = isoToLocalDateTimeParts(workout.completed_at, timezone);
  return <HealthSheet eyebrow="WORKOUT HISTORY" title="Edit completed workout" error={error} onClose={onClose}><form className="sheet-form" onSubmit={onSubmit}>
    <label className="field-label" htmlFor="workout-title">Workout name<input id="workout-title" name="workout-title" defaultValue={workout.title_snapshot} required /></label>
    {workout.exercises.map((exercise) => <label className="field-label" htmlFor={`sets-${exercise.exercise_id}`} key={exercise.exercise_id}>{exercise.exercise_name}<small>Saved exercise snapshot · shown in {displayUnit}</small><input id={`sets-${exercise.exercise_id}`} name={`sets-${exercise.exercise_id}`} defaultValue={exercise.sets.map(({ weight, reps, weight_unit }) => `${roundWeight(convertWeight(weight, weight_unit ?? displayUnit, displayUnit))}x${reps}`).join(", ")} /></label>)}
    <div className="health-form-grid"><label className="field-label" htmlFor="workout-date">Workout date<input id="workout-date" name="workout-date" type="date" defaultValue={workout.local_date} required /></label><label className="field-label" htmlFor="workout-start">Started<input id="workout-start" name="workout-start" type="time" defaultValue={start.time} required /></label><label className="field-label" htmlFor="workout-end">Finished<input id="workout-end" name="workout-end" type="time" defaultValue={end.time} required /></label></div>
    <label className="field-label" htmlFor="workout-notes">Notes <span className="optional-label">Optional</span><textarea id="workout-notes" name="workout-notes" defaultValue={workout.notes ?? ""} /></label>
    <p className="health-muted">Your previous saved version remains recoverable if you need to undo this edit.</p>
    {versions.length > 0 && <details className="health-record-detail"><summary><strong>Previous versions</strong><span>{versions.length} saved</span></summary><div className="workout-version-list">{versions.map((version) => <div className="health-record" key={version.id}><div><strong>Version {version.revision}</strong><small>{new Date(version.created_at).toLocaleString()}</small></div><button className="text-button" type="button" onClick={() => onRestore(version)}>Restore</button></div>)}</div></details>}
    <button className="button button-primary" type="submit">Save workout changes</button>
  </form></HealthSheet>;
}

function SessionEditForm({ day, error, onClose, onSubmit }: { day: StrengthProgramDay; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  return <HealthSheet eyebrow="FITNESS" title="Edit session" error={error} onClose={onClose}><form className="sheet-form" onSubmit={onSubmit}>
    <label className="field-label" htmlFor="session-edit-title">Session name<input id="session-edit-title" name="session-edit-title" required maxLength={120} defaultValue={day.title} /></label>
    <label className="field-label" htmlFor="session-edit-weekday">Scheduled day<select id="session-edit-weekday" name="session-edit-weekday" defaultValue={day.weekday ?? ""}><option value="">Flexible</option>{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((name, index) => <option value={index + 1} key={name}>{name}</option>)}</select></label>
    <button className="button button-primary" type="submit">Save session</button>
  </form></HealthSheet>;
}


function parseSetsFromText(input: string, weightUnit: "kg" | "lb") {
  return input.split(",").map((part) => {
    const match = part.trim().match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+)$/i);
    if (!match) return null;
    const weight = Number(match[1]); const reps = Number(match[2]);
    return weight >= 0 && reps > 0 ? { weight, reps, weight_unit: weightUnit } : null;
  }).filter((set): set is { weight: number; reps: number; weight_unit: "kg" | "lb" } => set !== null);
}
function value(data: FormData, key: string): string { return String(data.get(key) ?? "").trim(); }
function nullableValue(data: FormData, key: string): string | null { return value(data, key) || null; }
function numberValue(data: FormData, key: string): number | null { const parsed = Number(value(data, key)); return value(data, key) && Number.isFinite(parsed) ? parsed : null; }
function roundWeight(weight: number): number { return Math.round(weight * 100) / 100; }
function weekdayLabel(day: number): string { return ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][day] ?? "Flexible session"; }
