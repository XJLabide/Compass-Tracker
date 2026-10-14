"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { PageHeader } from "@/app/daily-components";
import { HealthSheet } from "@/app/health-sheet";
import { FinanceRowActions } from "@/app/finance-row-actions";
import { useWorkspace } from "@/app/app-workspace";
import { localToday, shiftLocalDate } from "@/lib/daily/repository";
import { formatMinorUnits } from "@/lib/finance/money";
import { emptyFinanceSnapshot, type FinanceTransaction, type FinanceSnapshot } from "@/lib/finance/types";
import { projectLocalFinanceMutations } from "@/lib/finance/projection";
import { loadFinanceSnapshot } from "@/lib/finance/repository";
import { listMutations } from "@/lib/offline/outbox";
import { createClient } from "@/lib/supabase/client";

type PeriodFilter = "this-month" | "last-30-days" | "all-time" | "custom";
type TypeFilter = "all" | "expense" | "income";

export default function FinanceTransactionsPage() {
  const { profile, database, refreshKey, queueMutation } = useWorkspace();
  const router = useRouter();
  const today = localToday(profile.timezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [snapshot, setSnapshot] = useState<FinanceSnapshot>(emptyFinanceSnapshot);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<PeriodFilter>("this-month");
  const [type, setType] = useState<TypeFilter>("all");
  const [category, setCategory] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [customStart, setCustomStart] = useState(monthStart);
  const [customEnd, setCustomEnd] = useState(today);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftPeriod, setDraftPeriod] = useState<PeriodFilter>("this-month");
  const [draftType, setDraftType] = useState<TypeFilter>("all");
  const [draftCategory, setDraftCategory] = useState("all");
  const [draftCurrency, setDraftCurrency] = useState("all");
  const [draftStart, setDraftStart] = useState(monthStart);
  const [draftEnd, setDraftEnd] = useState(today);

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
      setError(loadError instanceof Error ? loadError.message : "Transactions could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [database]);

  useEffect(() => {
    const task = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(task);
  }, [load, refreshKey]);

  const allTransactions = useMemo(() => snapshot.transactions
    .filter(({ active }) => active)
    .slice()
    .sort((left, right) => right.local_date.localeCompare(left.local_date)), [snapshot.transactions]);
  const categories = useMemo(() => [...new Set(allTransactions.map(({ category: name }) => name))]
    .sort((left, right) => left.localeCompare(right)), [allTransactions]);
  const currencies = useMemo(() => [...new Set(allTransactions.map(({ currency: code }) => code))].sort(), [allTransactions]);

  const filteredTransactions = useMemo(() => {
    const start = period === "this-month" ? monthStart
      : period === "last-30-days" ? shiftLocalDate(today, -29)
        : period === "custom" ? customStart : "";
    const end = period === "all-time" ? "" : period === "custom" ? customEnd : today;
    if (period === "custom" && start && end && start > end) return [];
    return allTransactions.filter((transaction) =>
      (!start || transaction.local_date >= start)
      && (!end || transaction.local_date <= end)
      && (type === "all" || transaction.transaction_type === type)
      && (category === "all" || transaction.category === category)
      && (currency === "all" || transaction.currency === currency));
  }, [allTransactions, category, currency, customEnd, customStart, monthStart, period, today, type]);

  const chartType = type === "income" ? "income" : "expense";
  const categoryGroups = useMemo(() => {
    const groups = new Map<string, Map<string, bigint>>();
    for (const transaction of filteredTransactions) {
      if (transaction.transaction_type !== chartType) continue;
      const currencyTotals = groups.get(transaction.currency) ?? new Map<string, bigint>();
      currencyTotals.set(transaction.category, (currencyTotals.get(transaction.category) ?? BigInt(0)) + BigInt(transaction.amount_minor));
      groups.set(transaction.currency, currencyTotals);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([code, amounts]) => ({
      currency: code,
      categories: [...amounts.entries()].map(([name, amount]) => ({ name, amount })).sort((left, right) => left.amount === right.amount ? left.name.localeCompare(right.name) : left.amount > right.amount ? -1 : 1),
    }));
  }, [chartType, filteredTransactions]);

  async function voidTransaction(transaction: FinanceTransaction) {
    try {
      const mutation = await queueMutation({
        entityType: "finance_transaction",
        recordId: transaction.id,
        expectedRevision: transaction.revision,
        payload: { active: false },
      });
      setSnapshot((current) => projectLocalFinanceMutations(current, [mutation]));
      setError("");
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : "The transaction could not be voided.");
    }
  }

  const invalidCustomRange = period === "custom" && customStart > customEnd;
  const invalidDraftRange = draftPeriod === "custom" && draftStart > draftEnd;
  const activeFilterCount = Number(period !== "this-month") + Number(type !== "all") + Number(category !== "all") + Number(currency !== "all");
  const periodLabel = period === "this-month" ? "This month"
    : period === "last-30-days" ? "Last 30 days"
      : period === "all-time" ? "All time" : `${formatTransactionDate(customStart)} – ${formatTransactionDate(customEnd)}`;

  function openFilters() {
    setDraftPeriod(period);
    setDraftType(type);
    setDraftCategory(category);
    setDraftCurrency(currency);
    setDraftStart(customStart);
    setDraftEnd(customEnd);
    setFiltersOpen(true);
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (invalidDraftRange) return;
    setPeriod(draftPeriod);
    setType(draftType);
    setCategory(draftCategory);
    setCurrency(draftCurrency);
    setCustomStart(draftStart);
    setCustomEnd(draftEnd);
    setFiltersOpen(false);
  }

  function resetDraftFilters() {
    setDraftPeriod("this-month");
    setDraftType("all");
    setDraftCategory("all");
    setDraftCurrency("all");
    setDraftStart(monthStart);
    setDraftEnd(today);
  }

  return <div className="daily-page finance-transactions-page">
    <div className="finance-transaction-nav">
      <Link className="finance-transactions-back" href="/finances"><span aria-hidden="true">‹</span> Spending</Link>
      <div className="finance-transaction-nav-actions">
        <div className="finance-filter-toolbar">
          <button className="finance-filter-trigger" type="button" aria-expanded={filtersOpen} onClick={openFilters}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4.5h14l-5.3 6v4.2l-3.4 1.7v-5.9L3 4.5Z" /></svg>
            <span>Filters</span>
            {activeFilterCount > 0 && <span className="finance-filter-count">{activeFilterCount}</span>}
          </button>
          {activeFilterCount > 0 && <button className="finance-filter-clear" type="button" onClick={() => { resetDraftFilters(); setPeriod("this-month"); setType("all"); setCategory("all"); setCurrency("all"); setCustomStart(monthStart); setCustomEnd(today); }}>Clear</button>}
        </div>
        <span className="finance-filter-summary">{periodLabel}</span>
        <Link className="round-add finance-transactions-add" href="/finances?newTransaction=1" aria-label="Add transaction">+</Link>
      </div>
    </div>
    <PageHeader title="Transactions" subtitle="All activity" />
    {error && <p className="form-message" role="alert">{error}</p>}

    <section className="health-section finance-transaction-chart" aria-labelledby="transaction-category-chart-title">
      <div className="health-section-heading"><h2 id="transaction-category-chart-title">{chartType === "expense" ? "Expenses by category" : "Income by category"}</h2></div>
      {loading ? <p className="health-muted">Loading transactions…</p> : categoryGroups.length ? categoryGroups.map((group) => {
        const maxAmount = group.categories[0]?.amount ?? BigInt(0);
        return <div className="finance-transaction-chart-group" key={group.currency}>
          <h3>{group.currency}</h3>
          <div className="finance-transaction-bars">
            {group.categories.map(({ name, amount }) => {
              const width = maxAmount > BigInt(0) ? Number(amount * BigInt(10000) / maxAmount) / 100 : 0;
              const selected = category === name;
              return <button className={`finance-transaction-bar${selected ? " is-selected" : ""}`} type="button" aria-pressed={selected} aria-label={`${name}, ${formatMinorUnits(amount, group.currency)}${selected ? ", selected category filter" : ", filter by category"}`} key={name} onClick={() => setCategory(selected ? "all" : name)}>
                <span className="finance-transaction-bar-label"><span>{name}</span><strong>{formatMinorUnits(amount, group.currency)}</strong></span>
                <span className="finance-transaction-track" aria-hidden="true"><span className={chartType === "expense" ? "is-expense" : "is-income"} style={{ width: `${width}%` }} /></span>
              </button>;
            })}
          </div>
        </div>;
      }) : <p className="health-muted">No {chartType} records for this selection.</p>}
    </section>

    <section className="health-section" aria-labelledby="transaction-ledger-title">
      <div className="health-section-heading"><div><h2 id="transaction-ledger-title">Transactions</h2><span className="health-count">{loading ? "Loading" : `${filteredTransactions.length} ${filteredTransactions.length === 1 ? "record" : "records"}`}</span></div></div>
      {invalidCustomRange && <p className="health-muted">Choose a start date on or before the end date.</p>}
      {!loading && !invalidCustomRange && (filteredTransactions.length ? <div className="finance-list">{filteredTransactions.map((transaction) => <article className="finance-row finance-row-has-trailing" key={transaction.id}>
        <div><strong>{transaction.description}</strong><small>{transaction.category} · {formatTransactionDate(transaction.local_date)} · {snapshot.accounts.find(({ id }) => id === transaction.account_id)?.name ?? "Closed account"}</small></div>
        <div className="finance-row-trailing"><strong className={transaction.transaction_type === "income" ? "finance-income" : "finance-expense"}>{transaction.transaction_type === "income" ? "+" : "−"}{formatMinorUnits(transaction.amount_minor, transaction.currency)}</strong>
          <FinanceRowActions actions={[
            { label: "Edit", onSelect: () => router.push(`/finances?editTransaction=${encodeURIComponent(transaction.id)}`) },
            { label: "Void", onSelect: () => void voidTransaction(transaction), danger: true },
          ]} />
        </div>
      </article>)}</div> : <p className="health-muted">No transactions match these filters.</p>)}
    </section>

    {filtersOpen && <HealthSheet eyebrow="TRANSACTIONS" title="Filters" error={invalidDraftRange ? "Choose a start date on or before the end date." : ""} onClose={() => setFiltersOpen(false)}>
      <form className="sheet-form" onSubmit={applyFilters}>
        <label className="field-label" htmlFor="transactions-period">Period<select id="transactions-period" value={draftPeriod} onChange={(event) => setDraftPeriod(event.target.value as PeriodFilter)}>
          <option value="this-month">This month</option><option value="last-30-days">Last 30 days</option><option value="all-time">All time</option><option value="custom">Custom range</option>
        </select></label>
        {draftPeriod === "custom" && <div className="finance-transaction-date-range">
          <label className="field-label" htmlFor="transactions-start">From<input id="transactions-start" type="date" value={draftStart} max={draftEnd} onChange={(event) => setDraftStart(event.target.value)} /></label>
          <label className="field-label" htmlFor="transactions-end">To<input id="transactions-end" type="date" value={draftEnd} min={draftStart} onChange={(event) => setDraftEnd(event.target.value)} /></label>
        </div>}
        <label className="field-label" htmlFor="transactions-type">Type<select id="transactions-type" value={draftType} onChange={(event) => setDraftType(event.target.value as TypeFilter)}>
          <option value="all">All types</option><option value="expense">Expenses</option><option value="income">Income</option>
        </select></label>
        <label className="field-label" htmlFor="transactions-category">Category<select id="transactions-category" value={draftCategory} onChange={(event) => setDraftCategory(event.target.value)}>
          <option value="all">All categories</option>{categories.map((name) => <option key={name} value={name}>{name}</option>)}
        </select></label>
        <label className="field-label" htmlFor="transactions-currency">Currency<select id="transactions-currency" value={draftCurrency} onChange={(event) => setDraftCurrency(event.target.value)}>
          <option value="all">All currencies</option>{currencies.map((code) => <option key={code} value={code}>{code}</option>)}
        </select></label>
        <div className="finance-filter-sheet-actions"><button className="button button-secondary" type="button" onClick={resetDraftFilters}>Reset</button><button className="button button-primary" type="submit" disabled={invalidDraftRange}>Apply filters</button></div>
      </form>
    </HealthSheet>}
  </div>;
}

function formatTransactionDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
}
