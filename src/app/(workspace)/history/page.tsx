"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/app/daily-components";
import { useWorkspace } from "@/app/app-workspace";
import { createClient } from "@/lib/supabase/client";
import { cacheRecord, readCachedRecord, type JsonValue } from "@/lib/offline/outbox";
import type { DailyPlan } from "@/lib/daily/types";

export default function HistoryPage() {
  const { database, refreshKey } = useWorkspace();
  const [plans, setPlans] = useState<DailyPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!database) return;
    setLoading(true);
    try {
      const { data, error: queryError } = await createClient()
        .from("daily_plans")
        .select("*")
        .order("local_date", { ascending: false })
        .limit(45);
      if (queryError) throw new Error(queryError.message);
      const savedPlans = (data ?? []) as DailyPlan[];
      await cacheRecord(database, { id: "history:recent", revision: 1, payload: savedPlans as unknown as JsonValue, cachedAt: Date.now() });
      setPlans(savedPlans);
      setError("");
    } catch (loadError) {
      const cached = await readCachedRecord(database, "history:recent");
      if (cached && Array.isArray(cached.payload)) setPlans(cached.payload as unknown as DailyPlan[]);
      setError(loadError instanceof Error ? loadError.message : "History could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [database]);

  useEffect(() => {
    const task = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(task);
  }, [load, refreshKey]);

  return (
    <div className="daily-page">
      <PageHeader title="History" subtitle="Past days stay open to honest backfill" />
      <section className="surface-card">
        <div className="surface-heading"><h2>Recent days</h2><span>Last 45 saved plans</span></div>
        {error && <p className="form-message" role="status">{error}</p>}
        {loading ? <p className="empty-copy">Loading history…</p> : plans.length === 0 ? (
          <div className="empty-inline"><p>Your saved days will appear here.</p><Link className="text-button" href="/today">Start today</Link></div>
        ) : plans.map((plan) => (
          <Link className="history-row" href={`/today?date=${plan.local_date}`} key={plan.id}>
            <span><strong>{formatHistoryDate(plan.local_date)}</strong><small>{plan.reflection ? "Reflection saved" : plan.status === "ended" ? "Day reviewed" : "Plan in progress"}</small></span>
            <span className="history-state">{plan.status === "draft" ? "Draft" : plan.status === "ended" ? "Reviewed" : plan.status === "backfill" ? "Backfill" : "Active"} ›</span>
          </Link>
        ))}
      </section>
      <p className="more-note">Backfilling a date changes that date only; it never changes today’s plan.</p>
    </div>
  );
}

function formatHistoryDate(localDate: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${localDate}T12:00:00.000Z`));
}
