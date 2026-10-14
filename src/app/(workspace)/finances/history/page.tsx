"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/app/daily-components";
import { useWorkspace } from "@/app/app-workspace";
import { localToday } from "@/lib/daily/repository";
import { buildNetWorthHistory } from "@/lib/finance/valuation";
import { formatMinorUnits } from "@/lib/finance/money";
import { emptyFinanceSnapshot } from "@/lib/finance/types";
import { projectLocalFinanceMutations } from "@/lib/finance/projection";
import { loadFinanceSnapshot } from "@/lib/finance/repository";
import { listMutations } from "@/lib/offline/outbox";
import { createClient } from "@/lib/supabase/client";

export default function NetWorthHistoryPage() {
  const { profile, database, refreshKey } = useWorkspace();
  const today = localToday(profile.timezone);
  const [snapshot, setSnapshot] = useState(emptyFinanceSnapshot);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!database) return;
    try {
      const [{ snapshot: loaded }, queued] = await Promise.all([
        loadFinanceSnapshot(createClient(), database),
        listMutations(database),
      ]);
      setSnapshot(projectLocalFinanceMutations(loaded, queued));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Net-worth history could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [database]);

  useEffect(() => {
    const task = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(task);
  }, [load, refreshKey]);

  const history = useMemo(() => buildNetWorthHistory(snapshot, today).slice().reverse(), [snapshot, today]);

  return <div className="daily-page finance-history-page">
    <PageHeader title="Net-worth history" subtitle="All recorded values, newest first" action={<Link className="text-button" href="/finances#accounts">‹ Accounts</Link>} />
    <section className="health-section" aria-labelledby="finance-history-title">
      <div className="health-section-heading">
        <h2 id="finance-history-title">History</h2>
        <span className="health-count">{history.length} {history.length === 1 ? "point" : "points"}</span>
      </div>
      {error && <p className="form-message" role="status">{error}</p>}
      {loading ? <p className="health-muted">Loading history…</p> : history.length ? <ol className="finance-history-points">
        {history.map((point) => <li className="finance-history-point" key={point.date}>
          <time dateTime={point.date}>{formatHistoryDate(point.date)}</time>
          {point.totals.length
            ? <div className="finance-history-values">{point.totals.map(({ currency, amount_minor }) => <strong key={currency}>{formatMinorUnits(amount_minor, currency)}</strong>)}</div>
            : <span className="health-muted">No valued positions</span>}
        </li>)}
      </ol> : <p className="health-muted">History appears after you add dated account activity or valuations.</p>}
    </section>
  </div>;
}

function formatHistoryDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
}
