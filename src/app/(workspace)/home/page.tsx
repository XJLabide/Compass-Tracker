"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CaptureButton, CaptureSheet, PageHeader } from "@/app/daily-components";
import { useWorkspace } from "@/app/app-workspace";
import { loadDailySnapshot, localToday, shiftLocalDate } from "@/lib/daily/repository";
import { cacheRecord, readCachedRecord, type JsonValue } from "@/lib/offline/outbox";
import { createClient } from "@/lib/supabase/client";
import type { DailyPlan, DailySnapshot } from "@/lib/daily/types";

interface HomeOverview {
  plans: DailyPlan[];
  openTasks: number;
  activeRoutines: number;
}

export default function HomePage() {
  const { profile, database, refreshKey } = useWorkspace();
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
      const [plansResult, taskResult, routineResult, dayResult] = await Promise.all([
        supabase.from("daily_plans").select("*").gte("local_date", weekDates[0]).lte("local_date", weekDates[6]),
        supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "open"),
        supabase.from("routines").select("id", { count: "exact", head: true }).eq("active", true),
        loadDailySnapshot(supabase, database, today),
      ]);
      for (const result of [plansResult, taskResult, routineResult]) if (result.error) throw new Error(result.error.message);
      const nextOverview = {
        plans: (plansResult.data ?? []) as DailyPlan[],
        openTasks: taskResult.count ?? 0,
        activeRoutines: routineResult.count ?? 0,
      };
      await cacheRecord(database, {
        id: `home-overview:${weekDates[0]}`,
        revision: 1,
        payload: nextOverview as unknown as JsonValue,
        cachedAt: Date.now(),
      });
      setOverview(nextOverview);
      setTodaySnapshot(dayResult.snapshot);
    } catch (loadError) {
      const cached = await readCachedRecord(database, `home-overview:${weekDates[0]}`);
      if (cached && typeof cached.payload === "object" && cached.payload && !Array.isArray(cached.payload)) {
        setOverview(cached.payload as unknown as HomeOverview);
      }
      const todayCache = await readCachedRecord(database, `daily-snapshot:${today}`);
      if (todayCache) setTodaySnapshot(todayCache.payload as unknown as DailySnapshot);
      setError(cached ? "Showing saved Home details while offline." : loadError instanceof Error ? loadError.message : "Home could not be loaded.");
    }
  }, [database, today, weekDates]);

  useEffect(() => {
    const task = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(task);
  }, [load, refreshKey]);

  const plannedDates = new Set(overview?.plans.map(({ local_date }) => local_date) ?? []);
  const plannedToday = overview?.plans.find(({ local_date }) => local_date === today);
  const todayPriorities = todaySnapshot?.priorities.filter(({ state }) => state === "active").length ?? 0;

  return (
    <div className="daily-page">
      <PageHeader title="Home" subtitle="A wider view of your week" action={<CaptureButton onClick={() => setCaptureOpen(true)} />} />
      {error && <div className="offline-banner" role="status">{error}</div>}
      <section className="surface-card week-overview" aria-labelledby="week-title">
        <div className="week-overview-heading">
          <div><h2 id="week-title">{formatWeekRange(weekDates[0], weekDates[6])}</h2><small>THIS WEEK</small></div>
          <span>{plannedDates.size} {plannedDates.size === 1 ? "day" : "days"} planned</span>
        </div>
        <div className="week-strip">
          {weekDates.map((date) => {
            const day = new Date(`${date}T12:00:00.000Z`);
            const weekday = new Intl.DateTimeFormat(undefined, { weekday: "narrow", timeZone: "UTC" }).format(day);
            const number = day.getUTCDate();
            const selected = date === today;
            return (
              <Link className={`week-day${selected ? " is-selected" : ""}${selected ? " is-today" : ""}`} href={`/today?date=${date}`} key={date} aria-label={`${weekday} ${number}${plannedDates.has(date) ? ", planned" : ""}`}>
                <span className="week-day-label">{weekday}</span>
                <span className="week-day-number">{number}</span>
                {plannedDates.has(date) && <span className="planned-dot" aria-hidden="true" />}
              </Link>
            );
          })}
        </div>
      </section>

      <section className="surface-card" aria-labelledby="across-title">
        <div className="surface-heading"><h2 id="across-title">Across your spaces</h2><Link className="text-button" href="/more">See all</Link></div>
        <SpaceSummary count={String(todayPriorities).padStart(2, "0")} label="Today" detail={plannedToday ? `${todayPriorities} priorities planned today` : "No plan started yet"} href="/today" />
        <div className="card-divider" />
        <SpaceSummary count={String(overview?.openTasks ?? 0).padStart(2, "0")} label="Tasks" detail={`${overview?.openTasks ?? 0} open across your list`} href="/tasks" gold />
        <div className="card-divider" />
        <SpaceSummary count={String(overview?.activeRoutines ?? 0).padStart(2, "0")} label="Routines" detail="Ongoing behaviors, tracked on their scheduled days" href="/routines" />
      </section>

      <section className="surface-card home-prompt">
        <span className="eyebrow">A SMALL NEXT STEP</span>
        <h2>Make room for what matters.</h2>
        <p>Choose a few priorities for today, then let the rest of Compass support them.</p>
        <Link className="button button-primary" href="/today">Open Today <span aria-hidden="true">→</span></Link>
      </section>

      {captureOpen && <CaptureSheet plan={todaySnapshot?.plan ?? null} priorities={todaySnapshot?.priorities ?? []} onClose={() => setCaptureOpen(false)} onSaved={() => undefined} />}
    </div>
  );
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
