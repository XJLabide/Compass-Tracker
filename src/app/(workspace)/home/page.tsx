"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CaptureButton, CaptureSheet, PageHeader } from "@/app/daily-components";
import { useWorkspace } from "@/app/app-workspace";
import { loadDailySnapshot, localToday, shiftLocalDate } from "@/lib/daily/repository";
import { projectLocalDailyMutations } from "@/lib/daily/projection";
import { localDateTimeToIso } from "@/lib/daily/timezone";
import { cacheRecord, listMutations, readCachedRecord, type JsonValue } from "@/lib/offline/outbox";
import { createClient } from "@/lib/supabase/client";
import type { DailyPlan, DailySnapshot, Routine, RoutineLog, Task } from "@/lib/daily/types";

interface HomeProject { id: string; title: string; }
interface HomeWorkout { id: string; local_date: string; exercises: Array<{ exercise_id: string; sets: Array<{ weight: number; reps: number }> }>; }
interface HomeMeal { local_date: string; snapshot: { totals?: { calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number } }; }
interface HomeCheckin { local_date: string; body_weight: number | null; sleep_hours: number | null; }
interface HomeExercise { id: string; name: string; category: string | null; }
interface HomeProgramDay { weekday: number | null; }

interface HomeOverview {
  plans: DailyPlan[];
  openTasks: number;
  activeRoutines: number;
  tasks: Task[];
  projects: HomeProject[];
  routines: Routine[];
  routineLogs: RoutineLog[];
  activeGoals: number;
  activeProjects: number;
  workouts: HomeWorkout[];
  activitiesThisWeek: number;
  meals: HomeMeal[];
  checkins: HomeCheckin[];
  exercises: HomeExercise[];
  programDays: HomeProgramDay[];
  hasNutritionTarget: boolean;
  eventsThisWeek: number;
}

export default function HomePage() {
  const { profile, database, refreshKey, queueMutation } = useWorkspace();
  const today = localToday(profile.timezone);
  const monday = weekStart(today);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, index) => shiftLocalDate(monday, index)), [monday]);
  const [overview, setOverview] = useState<HomeOverview | null>(null);
  const [todaySnapshot, setTodaySnapshot] = useState<DailySnapshot | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!database) return;
    setError("");
    const supabase = createClient();
    try {
      const weekStartInstant = localDateTimeToIso(weekDates[0], "00:00", profile.timezone);
      const weekEndInstant = localDateTimeToIso(shiftLocalDate(weekDates[6], 1), "00:00", profile.timezone);
      const [plansResult, taskResult, routineResult, routineLogResult, goalResult, projectResult, projectPreviewResult, workoutResult, activityResult, mealResult, checkinResult, exerciseResult, programDayResult, targetResult, eventResult, dayResult] = await Promise.all([
        supabase.from("daily_plans").select("*").gte("local_date", weekDates[0]).lte("local_date", weekDates[6]),
        supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "open"),
        supabase.from("routines").select("*").eq("active", true).order("sort_order"),
        supabase.from("routine_logs").select("*").gte("local_date", shiftLocalDate(today, -59)).lte("local_date", today),
        supabase.from("goals").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("projects").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("projects").select("id,title").eq("status", "active").order("sort_order").limit(2),
        supabase.from("workout_logs").select("id,local_date,exercises").eq("status", "logged").gte("local_date", shiftLocalDate(today, -83)).lte("local_date", today),
        supabase.from("fitness_activity_logs").select("id", { count: "exact", head: true }).gte("local_date", weekDates[0]).lte("local_date", weekDates[6]),
        supabase.from("meal_logs").select("local_date,snapshot").gte("local_date", shiftLocalDate(today, -55)).lte("local_date", today).eq("active", true),
        supabase.from("nutrition_checkins").select("local_date,body_weight,sleep_hours").gte("local_date", shiftLocalDate(today, -55)).lte("local_date", today),
        supabase.from("fitness_exercises").select("id,name,category"),
        supabase.from("strength_program_days").select("weekday,strength_programs!inner(status)").eq("strength_programs.status", "active").not("weekday", "is", null),
        supabase.from("nutrition_targets").select("id", { count: "exact", head: true }).lte("effective_from", today),
        supabase.from("calendar_events").select("id", { count: "exact", head: true }).eq("status", "active").gte("starts_at", weekStartInstant ?? `${weekDates[0]}T00:00:00.000Z`).lt("starts_at", weekEndInstant ?? `${shiftLocalDate(weekDates[6], 1)}T00:00:00.000Z`),
        loadDailySnapshot(supabase, database, today),
      ]);
      for (const result of [plansResult, taskResult, routineResult, routineLogResult, goalResult, projectResult, projectPreviewResult, workoutResult, activityResult, mealResult, checkinResult, exerciseResult, programDayResult, targetResult, eventResult]) if (result.error) throw new Error(result.error.message);
      const queued = await listMutations(database);
      const localDaily = projectLocalDailyMutations(dayResult.snapshot, queued, today);
      const taskDelta = queued.filter(({ entityType, status }) => entityType === "task" && status !== "synced" && status !== "resolved").reduce((delta, mutation) => {
        const payload = mutation.payload as { status?: string };
        const currentTask = dayResult.snapshot.tasks.find(({ id }) => id === mutation.recordId);
        if (mutation.expectedRevision === 0) return delta + (payload.status === "open" ? 1 : 0);
        if (currentTask?.status === "open" && payload.status && payload.status !== "open") return delta - 1;
        if (currentTask && currentTask.status !== "open" && payload.status === "open") return delta + 1;
        return delta;
      }, 0);
      const nextOverview = {
        plans: (plansResult.data ?? []) as DailyPlan[],
        openTasks: Math.max(0, (taskResult.count ?? 0) + taskDelta),
        activeRoutines: routineResult.data?.length ?? 0,
        tasks: localDaily.tasks.filter(({ status }) => status === "open").slice(0, 3),
        projects: (projectPreviewResult.data ?? []) as HomeProject[],
        routines: (routineResult.data ?? []) as Routine[],
        routineLogs: (routineLogResult.data ?? []) as RoutineLog[],
        activeGoals: goalResult.count ?? 0,
        activeProjects: projectResult.count ?? 0,
        workouts: (workoutResult.data ?? []) as HomeWorkout[],
        activitiesThisWeek: activityResult.count ?? 0,
        meals: (mealResult.data ?? []) as HomeMeal[],
        checkins: (checkinResult.data ?? []) as HomeCheckin[],
        exercises: (exerciseResult.data ?? []) as HomeExercise[],
        programDays: (programDayResult.data ?? []) as HomeProgramDay[],
        hasNutritionTarget: (targetResult.count ?? 0) > 0,
        eventsThisWeek: eventResult.count ?? 0,
      };
      await cacheRecord(database, {
        id: `home-overview:${weekDates[0]}`,
        revision: 1,
        payload: nextOverview as unknown as JsonValue,
        cachedAt: Date.now(),
      });
      setOverview(nextOverview);
      setTodaySnapshot(localDaily);
    } catch (loadError) {
      const cached = await readCachedRecord(database, `home-overview:${weekDates[0]}`);
      if (cached && typeof cached.payload === "object" && cached.payload && !Array.isArray(cached.payload)) {
        setOverview(cached.payload as unknown as HomeOverview);
      }
      const todayCache = await readCachedRecord(database, `daily-snapshot:${today}`);
      if (todayCache) setTodaySnapshot(todayCache.payload as unknown as DailySnapshot);
      setError(cached ? "Showing saved Home details while offline." : loadError instanceof Error ? loadError.message : "Home could not be loaded.");
    }
  }, [database, profile.timezone, today, weekDates]);

  useEffect(() => {
    const task = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(task);
  }, [load, refreshKey]);

  const plannedToday = overview?.plans.find(({ local_date }) => local_date === today);
  const todayPriorities = todaySnapshot?.priorities.filter(({ state }) => state === "active").length ?? 0;
  const todayWeekday = ((new Date(`${today}T12:00:00.000Z`).getUTCDay() + 6) % 7) + 1;
  const habits = summarizeHabits(overview?.routines ?? [], overview?.routineLogs ?? [], today);
  const sleepCheckins = (overview?.checkins ?? []).filter(({ local_date, sleep_hours }) => local_date >= shiftLocalDate(today, -13) && sleep_hours !== null);
  const sleepConsistency = sleepCheckins.length ? Math.round(sleepCheckins.filter(({ sleep_hours }) => (sleep_hours ?? 0) >= 7).length / sleepCheckins.length * 100) : 0;
  const workoutsThisWeek = (overview?.workouts ?? []).filter(({ local_date }) => local_date >= weekDates[0] && local_date <= today);
  const setsByMuscle = summarizeMuscleVolume(overview?.workouts ?? [], overview?.exercises ?? [], shiftLocalDate(today, -29));
  const sevenDayMeals = (overview?.meals ?? []).filter(({ local_date }) => local_date >= shiftLocalDate(today, -6));
  const proteinByDay = summarizeDailyProtein(sevenDayMeals);
  const averageProtein = average(Object.values(proteinByDay));
  const recentCheckins = (overview?.checkins ?? []).filter(({ local_date }) => local_date >= shiftLocalDate(today, -6));
  const averageSleep = average(recentCheckins.map(({ sleep_hours }) => sleep_hours).filter((hours): hours is number => hours !== null));
  const latestWeight = mostRecentWeight(overview?.checkins ?? [], today);
  const lastWeekWeight = mostRecentWeight(overview?.checkins ?? [], shiftLocalDate(today, -7));
  const weeklyPlanned = (overview?.programDays ?? []).length;
  const weekActivity = Array.from({ length: 12 }, (_, index) => {
    const start = shiftLocalDate(weekStart(today), (index - 11) * 7);
    return Array.from({ length: 7 }, (_, day) => {
      const date = shiftLocalDate(start, day);
      return (overview?.workouts ?? []).filter((workout) => workout.local_date === date).length;
    });
  });
  const proteinTrend = summarizeWeeklyProtein(overview?.meals ?? [], today);
  const sleepTrend = summarizeWeeklyCheckins(overview?.checkins ?? [], today, "sleep_hours");
  const recentWeight = [...(overview?.checkins ?? [])].filter(({ local_date, body_weight }) => local_date >= shiftLocalDate(today, -55) && body_weight !== null).sort((a, b) => a.local_date.localeCompare(b.local_date)).map(({ body_weight }) => body_weight as number);
  const recentSetVolumes = summarizeWeeklyVolume(overview?.workouts ?? [], today);

  async function completeTask(task: Task) {
    try {
      await queueMutation({ entityType: "task", recordId: task.id, expectedRevision: task.revision, payload: {
        title: task.title, details: task.details, due_date: task.due_date, status: "done",
        completed_at: new Date().toISOString(), sort_order: task.sort_order,
      } });
      setOverview((current) => current ? { ...current, openTasks: Math.max(0, current.openTasks - 1), tasks: current.tasks.filter(({ id }) => id !== task.id) } : current);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The task could not be updated.");
    }
  }

  return (
    <div className="daily-page home-dashboard">
      <PageHeader title="Home" subtitle="Your day and progress across Compass" action={<CaptureButton onClick={() => setCaptureOpen(true)} />} />
      {error && <div className="offline-banner" role="status">{error}</div>}
      <section className="home-dashboard-section" aria-labelledby="daily-title">
        <h2 id="daily-title">Daily</h2>
        <div className="home-daily-grid">
          <article className="home-dashboard-panel"><div className="home-panel-heading"><h3><span className="home-panel-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11" /></svg></span>Todos</h3><Link href="/tasks">Open <span>→</span></Link></div>{overview?.tasks.length ? <ul className="home-preview-list">{overview.tasks.map((task) => <li key={task.id}><button className="home-open-circle" type="button" aria-label={`Complete ${task.title}`} onClick={() => void completeTask(task)} />{task.title}</li>)}</ul> : <p className="home-empty-copy">No open tasks. Add one in Tasks.</p>}</article>
          <article className="home-dashboard-panel"><div className="home-panel-heading"><h3><span className="home-panel-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M9 8v8m6-8v8" /></svg></span>Projects</h3><Link href="/projects">Open <span>→</span></Link></div>{overview?.projects.length ? <ul className="home-preview-list project-preview">{overview.projects.map((project) => <li key={project.id}>{project.title}</li>)}</ul> : <p className="home-empty-copy">No active projects. Create one from Projects.</p>}</article>
          <article className="home-dashboard-panel"><div className="home-panel-heading"><h3><span className="home-panel-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 9a7 7 0 0 1 11.8-2L20 12M4 12l2.1 5a7 7 0 0 0 11.8-2" /></svg></span>Today&apos;s habits</h3><Link href="/routines">Open <span>→</span></Link></div><div className="home-habit-progress"><strong>{habits.completedToday}<small> / {habits.scheduledToday} done</small></strong><span>{habits.todayPercent}%</span><div className="home-progress-track"><span style={{ width: `${habits.todayPercent}%` }} /></div></div><div className="home-habit-list">{(overview?.routines ?? []).filter(({ days_of_week }) => days_of_week.includes(todayWeekday)).slice(0, 4).map((routine) => <span key={routine.id}><i aria-hidden="true" />{routine.title}</span>)}{habits.scheduledToday === 0 && <small>No habits scheduled for today</small>}</div></article>
          <article className="home-dashboard-panel home-finance-panel"><div className="home-panel-heading"><h3><span className="home-panel-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M3 9h18M16 15h2M7 6V4h10v2" /></svg></span>Finances · {new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(`${today}T12:00:00.000Z`))}</h3></div><p className="home-empty-copy">Finance tracking isn&apos;t available in Compass yet.</p><span className="home-finance-placeholder">Add an expense or income when this space is ready.</span></article>
        </div>
      </section>

      <section className="home-dashboard-section" aria-labelledby="habits-title">
        <h2 id="habits-title">Habits</h2>
        <div className="home-insight-grid">
          <article className="home-dashboard-panel home-habit-streak"><div className="home-insight-heading"><span>STREAK</span><small>last 60 days</small></div><div className="home-streak-value"><span aria-hidden="true">♨</span><strong>{habits.currentStreak}<small> DAYS</small></strong><span className="home-best-streak">{habits.bestStreak}<small>BEST</small></span></div><p>{habits.currentStreak ? "Keep showing up to extend your streak." : "Complete a scheduled habit to start a streak."}</p></article>
          <article className="home-dashboard-panel"><div className="home-insight-heading"><span>CONSISTENCY</span><small>last 14 days</small></div><div className="home-consistency-list"><ConsistencyRing value={habits.consistency} label="HABITS" /><ConsistencyRing value={sevenDayMeals.length ? Math.min(100, Math.round(sevenDayMeals.length / 21 * 100)) : 0} label="NUTRITION" /><ConsistencyRing value={sleepConsistency} label="SLEEP ≥7H" /></div></article>
        </div>
      </section>

      <section className="home-dashboard-section" aria-labelledby="fitness-title">
        <div className="home-dashboard-section-heading"><h2 id="fitness-title">Fitness</h2><Link className="text-button" href="/fitness">Open fitness <span aria-hidden="true">→</span></Link></div>
        <div className="home-insight-grid">
          <article className="home-dashboard-panel"><div className="home-insight-heading"><span>This week</span><small>{formatWeekRange(weekDates[0], weekDates[6])}</small></div><div className="home-fitness-metrics"><Metric label="Workouts" value={`${workoutsThisWeek.length}${weeklyPlanned ? ` / ${weeklyPlanned}` : ""}`} /><Metric label="Avg protein" value={averageProtein === null ? "—" : `${Math.round(averageProtein)} g`} /><Metric label="Avg sleep" value={averageSleep === null ? "—" : `${averageSleep.toFixed(1)} h`} /><Metric label="Weight Δ vs. last wk" value={latestWeight === null || lastWeekWeight === null ? "—" : `${(latestWeight - lastWeekWeight).toFixed(1)} ${profile.units === "metric" ? "kg" : "lb"}`} /></div></article>
          <article className="home-dashboard-panel"><div className="home-insight-heading"><span>Trends</span><small>Last 8 weeks</small></div><div className="home-trend-grid"><TrendMetric label="Bodyweight" values={recentWeight.slice(-8)} unit={profile.units === "metric" ? "kg" : "lb"} /><TrendMetric label="Volume / week" values={recentSetVolumes} unit="sets" /><TrendMetric label="Protein" values={proteinTrend} unit="g avg" /><TrendMetric label="Sleep" values={sleepTrend} unit="h avg" /></div></article>
        </div>
        <div className="home-insight-grid home-fitness-detail-grid">
          <article className="home-dashboard-panel"><div className="home-insight-heading"><span>Activity</span><small>last 12 weeks</small></div><div className="home-activity-heatmap" aria-label="Workout activity over the last 12 weeks">{weekActivity.flatMap((week, weekIndex) => week.map((count, dayIndex) => <span key={`${weekIndex}-${dayIndex}`} className={count > 0 ? "is-active" : ""} title={`${count} workouts`} />))}</div></article>
          <article className="home-dashboard-panel"><div className="home-insight-heading"><span>Volume by muscle</span><small>last 30 days</small></div>{setsByMuscle.length ? <div className="home-muscle-volume">{setsByMuscle.slice(0, 5).map(({ label, sets, percent }) => <div key={label}><span>{label}</span><div className="home-progress-track"><span style={{ width: `${percent}%` }} /></div><small>{sets}</small></div>)}</div> : <p className="home-empty-copy">Log a few strength sessions to see your training volume here.</p>}</article>
        </div>
      </section>

      <section className="surface-card home-all-spaces" aria-labelledby="all-spaces-title"><div className="surface-heading"><h2 id="all-spaces-title">Across your spaces</h2><Link className="text-button" href="/more">See all</Link></div><div className="home-space-grid"><SpaceSummary count={String(todayPriorities).padStart(2, "0")} label="Today" detail={plannedToday ? `${todayPriorities} priorities planned today` : "No plan started yet"} href="/today" /><SpaceSummary count={String(overview?.eventsThisWeek ?? 0).padStart(2, "0")} label="Calendar" detail={`${overview?.eventsThisWeek ?? 0} events this week`} href="/calendar" /><SpaceSummary count={String(overview?.openTasks ?? 0).padStart(2, "0")} label="Tasks" detail={`${overview?.openTasks ?? 0} open`} href="/tasks" gold /><SpaceSummary count={String(overview?.activeRoutines ?? 0).padStart(2, "0")} label="Routines" detail="Scheduled behaviors" href="/routines" /><SpaceSummary count={String(overview?.activeProjects ?? 0).padStart(2, "0")} label="Projects" detail="Active projects" href="/projects" /><SpaceSummary count={String(overview?.activeGoals ?? 0).padStart(2, "0")} label="Goals" detail="Active directions" href="/goals" gold /><SpaceSummary count={String((overview?.workouts ?? []).filter(({ local_date }) => local_date >= weekDates[0] && local_date <= today).length + (overview?.activitiesThisWeek ?? 0)).padStart(2, "0")} label="Fitness" detail="Sessions this week" href="/fitness" /><SpaceSummary count={String(sevenDayMeals.length).padStart(2, "0")} label="Nutrition" detail={`${sevenDayMeals.length} meals this week`} href="/nutrition" gold /></div></section>

      {captureOpen && <CaptureSheet plan={todaySnapshot?.plan ?? null} priorities={todaySnapshot?.priorities ?? []} onClose={() => setCaptureOpen(false)} onSaved={() => undefined} />}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="home-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function TrendMetric({ label, values, unit }: { label: string; values: number[]; unit: string }) {
  const current = values.at(-1);
  const points = values.length > 1 ? values.map((value, index) => {
    const range = Math.max(...values) - Math.min(...values) || 1;
    const x = (index / (values.length - 1)) * 100;
    const y = 28 - ((value - Math.min(...values)) / range) * 22;
    return `${x},${y}`;
  }).join(" ") : "";
  return <div className="home-trend-metric"><div><span>{label}</span><strong>{current === undefined ? "—" : `${formatMetric(current)} ${unit}`}</strong></div>{values.length >= 3 ? <svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-label={`${label} trend`}><polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg> : <small>Log 3 entries to see your trend</small>}</div>;
}

function ConsistencyRing({ value, label }: { value: number; label: string }) {
  return <div className="home-consistency-ring"><span style={{ background: `conic-gradient(var(--accent) ${value}%, var(--panel-raised) 0)` }}><i>{value}%</i></span><small>{label}</small></div>;
}

function SpaceSummary({ count, label, detail, href, gold = false }: { count: string; label: string; detail: string; href: string; gold?: boolean }) {
  return (
    <Link className="space-summary-row" href={href}>
      <span className={gold ? "summary-count gold" : "summary-count"}>{count}</span>
      <span className="summary-copy"><strong>{label}</strong><small>{detail}</small></span>
      <span className="row-chevron" aria-hidden="true">›</span>
    </Link>
  );
}

function summarizeHabits(routines: Routine[], logs: RoutineLog[], today: string) {
  const completed = new Set(logs.filter(({ completed }) => completed).map(({ routine_id, local_date }) => `${routine_id}:${local_date}`));
  const todayWeekday = dateWeekday(today);
  const todayScheduled = routines.filter(({ days_of_week }) => days_of_week.includes(todayWeekday));
  const completedToday = todayScheduled.filter(({ id }) => completed.has(`${id}:${today}`)).length;
  let scheduledTotal = 0;
  let completedTotal = 0;
  let currentStreak = 0;
  let bestStreak = 0;
  let streak = 0;
  for (let offset = -59; offset <= 0; offset += 1) {
    const date = shiftLocalDate(today, offset);
    const scheduledToday = routines.filter(({ days_of_week }) => days_of_week.includes(dateWeekday(date)));
    if (!scheduledToday.length) continue;
    const done = scheduledToday.filter(({ id }) => completed.has(`${id}:${date}`)).length;
    scheduledTotal += scheduledToday.length;
    completedTotal += done;
    if (done === scheduledToday.length) streak += 1;
    else streak = 0;
    bestStreak = Math.max(bestStreak, streak);
    if (offset === 0 || (currentStreak === 0 && offset === -1)) currentStreak = streak;
  }
  const last14 = Array.from({ length: 14 }, (_, index) => shiftLocalDate(today, index - 13));
  const scheduled14 = last14.flatMap((date) => routines.filter(({ days_of_week }) => days_of_week.includes(dateWeekday(date))).map((routine) => `${routine.id}:${date}`));
  const consistency = scheduled14.length ? Math.round(scheduled14.filter((key) => completed.has(key)).length / scheduled14.length * 100) : 0;
  return {
    completedToday, scheduledToday: todayScheduled.length,
    todayPercent: todayScheduled.length ? Math.round(completedToday / todayScheduled.length * 100) : 0,
    currentStreak, bestStreak, consistency, scheduledTotal, completedTotal,
  };
}

function summarizeDailyProtein(meals: HomeMeal[]) {
  const byDate = new Map<string, number>();
  for (const meal of meals) byDate.set(meal.local_date, (byDate.get(meal.local_date) ?? 0) + Number(meal.snapshot.totals?.protein_g ?? 0));
  return Object.fromEntries(byDate);
}

function summarizeWeeklyProtein(meals: HomeMeal[], today: string) {
  const daily = summarizeDailyProtein(meals);
  return Array.from({ length: 8 }, (_, index) => {
    const start = shiftLocalDate(weekStart(today), (index - 7) * 7);
    const dates = Array.from({ length: 7 }, (_, offset) => shiftLocalDate(start, offset));
    const values = dates.map((date) => daily[date]).filter((value): value is number => value !== undefined);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }).filter((value): value is number => value !== null);
}

function summarizeWeeklyCheckins(checkins: HomeCheckin[], today: string, field: "sleep_hours") {
  return Array.from({ length: 8 }, (_, index) => {
    const start = shiftLocalDate(weekStart(today), (index - 7) * 7);
    const end = shiftLocalDate(start, 6);
    return average(checkins.filter(({ local_date }) => local_date >= start && local_date <= end).map(({ [field]: value }) => value).filter((value): value is number => value !== null));
  }).filter((value): value is number => value !== null);
}

function summarizeWeeklyVolume(workouts: HomeWorkout[], today: string) {
  return Array.from({ length: 8 }, (_, index) => {
    const start = shiftLocalDate(weekStart(today), (index - 7) * 7);
    const end = shiftLocalDate(start, 6);
    return workouts.filter(({ local_date }) => local_date >= start && local_date <= end).reduce((sum, workout) => sum + workout.exercises.reduce((exerciseSum, exercise) => exerciseSum + exercise.sets.length, 0), 0);
  });
}

function summarizeMuscleVolume(workouts: HomeWorkout[], exercises: HomeExercise[], since: string) {
  const categoryById = new Map(exercises.map(({ id, category }) => [id, category || "Other"]));
  const sets = new Map<string, number>();
  for (const workout of workouts.filter(({ local_date }) => local_date >= since)) {
    for (const exercise of workout.exercises) sets.set(categoryById.get(exercise.exercise_id) ?? "Other", (sets.get(categoryById.get(exercise.exercise_id) ?? "Other") ?? 0) + exercise.sets.length);
  }
  const max = Math.max(1, ...sets.values());
  return [...sets].map(([label, count]) => ({ label, sets: count, percent: Math.round(count / max * 100) })).sort((left, right) => right.sets - left.sets);
}

function mostRecentWeight(checkins: HomeCheckin[], before: string): number | null {
  return [...checkins].filter(({ local_date, body_weight }) => local_date <= before && body_weight !== null).sort((left, right) => right.local_date.localeCompare(left.local_date))[0]?.body_weight ?? null;
}

function average(values: number[]): number | null { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function dateWeekday(date: string): number { return ((new Date(`${date}T12:00:00.000Z`).getUTCDay() + 6) % 7) + 1; }
function formatMetric(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }

function weekStart(localDate: string) {
  const date = new Date(`${localDate}T12:00:00.000Z`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return shiftLocalDate(localDate, -mondayOffset);
}

function formatWeekRange(start: string, end: string) {
  const first = new Date(`${start}T12:00:00.000Z`);
  const last = new Date(`${end}T12:00:00.000Z`);
  const startMonth = new Intl.DateTimeFormat(undefined, { month: "long", timeZone: "UTC" }).format(first);
  const endMonth = new Intl.DateTimeFormat(undefined, { month: "long", timeZone: "UTC" }).format(last);
  return startMonth === endMonth
    ? `${startMonth} ${first.getUTCDate()} – ${last.getUTCDate()}`
    : `${startMonth} ${first.getUTCDate()} – ${endMonth} ${last.getUTCDate()}`;
}
