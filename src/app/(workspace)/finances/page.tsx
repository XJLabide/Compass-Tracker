"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { HealthSheet } from "@/app/health-sheet";
import { PageHeader } from "@/app/daily-components";
import { localToday } from "@/lib/daily/repository";
import { isoToLocalDateTimeParts, localDateTimeToIso } from "@/lib/daily/timezone";
import { listMutations, type JsonValue, type WorkspaceEntityType } from "@/lib/offline/outbox";
import { createValuationAdapter, buildNetWorthHistory, netWorthAt, resolveFreshness, financeAccountBalanceAt } from "@/lib/finance/valuation";
import { budgetSpent, latestPositionValuation, monthlyFinanceFlow } from "@/lib/finance/ledger";
import { convertMinorUnits, formatMinorUnits, minorUnitsInput, multiplyMinorUnitsByQuantity, parseMinorUnits } from "@/lib/finance/money";
import { emptyFinanceSnapshot, type FinanceAccount, type FinanceBudget, type FinanceFxRate, type FinancePosition, type FinancePositionValuation, type FinanceRecurringCharge, type FinanceSnapshot, type FinanceTransaction } from "@/lib/finance/types";
import { projectLocalFinanceMutations } from "@/lib/finance/projection";
import { loadFinanceSnapshot } from "@/lib/finance/repository";
import { useWorkspace } from "@/app/app-workspace";
import { createClient } from "@/lib/supabase/client";

type FinanceForm = "account" | "transaction" | "budget" | "recurring" | "position" | "valuation" | "fx" | "conversion" | null;
type FinanceEntity = Extract<WorkspaceEntityType,
  "finance_account" | "finance_transaction" | "finance_budget" | "finance_recurring_charge" | "finance_position" | "finance_valuation" | "finance_fx_rate" | "finance_conversion">;
const commonCurrencies = ["USD", "PHP", "EUR", "GBP", "JPY", "CAD", "AUD", "SGD"];

export default function FinancesPage() {
  const { profile, database, refreshKey, queueMutation, online } = useWorkspace();
  const today = localToday(profile.timezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [snapshot, setSnapshot] = useState<FinanceSnapshot>(emptyFinanceSnapshot);
  const [form, setForm] = useState<FinanceForm>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [targetPositionId, setTargetPositionId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [marketStatus, setMarketStatus] = useState("Checking valuation data…");
  const adapter = useMemo(() => createValuationAdapter(), []);

  const load = useCallback(async () => {
    if (!database) return;
    try {
      const [{ snapshot: loaded, offline: isOffline }, queued] = await Promise.all([
        loadFinanceSnapshot(createClient(), database),
        listMutations(database),
      ]);
      setSnapshot(projectLocalFinanceMutations(loaded, queued));
      setOffline(isOffline);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Finance records could not be loaded.");
    }
  }, [database]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey]);

  useEffect(() => {
    let active = true;
    void Promise.all([adapter.getQuotes([]), adapter.getRates("USD", [])]).then(([quotes, rates]) => {
      if (active) setMarketStatus(quotes.reason ?? rates.reason ?? "Live market data is unavailable.");
    });
    return () => { active = false; };
  }, [adapter]);

  const netWorth = useMemo(() => netWorthAt(snapshot, today), [snapshot, today]);
  const history = useMemo(() => buildNetWorthHistory(snapshot, today).slice(-24), [snapshot, today]);

  function openForm(next: Exclude<FinanceForm, null>, id: string | null = null, positionId: string | null = null) {
    setError(""); setEditingId(id); setTargetPositionId(positionId); setForm(next);
  }

  function closeForm() { setForm(null); setEditingId(null); setTargetPositionId(null); setError(""); }

  async function saveMutation(entityType: FinanceEntity, id: string, expectedRevision: number, payload: Record<string, JsonValue>) {
    const mutation = await queueMutation({ entityType, recordId: id, expectedRevision, payload });
    setSnapshot((current) => projectLocalFinanceMutations(current, [mutation]));
  }

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const current = snapshot.accounts.find(({ id }) => id === editingId);
    const currency = (text(data, "currency") || current?.currency || "PHP").toUpperCase();
    const opening = parseMoney(text(data, "opening-balance"), currency);
    if (opening === null || BigInt(opening) < BigInt(0) || !text(data, "account-name")) { setError("Add an account name and a non-negative opening balance."); return; }
    try {
      await saveMutation("finance_account", current?.id ?? crypto.randomUUID(), current?.revision ?? 0, {
        name: text(data, "account-name"), account_type: text(data, "account-type") || current?.account_type || "checking", currency,
        opening_balance_minor: opening, opened_on: text(data, "opened-on"), closed_on: current?.closed_on ?? null, active: true,
      });
      closeForm();
    } catch (saveError) { setError(message(saveError, "The account could not be saved.")); }
  }

  async function submitTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const account = snapshot.accounts.find(({ id }) => id === text(data, "account-id"));
    const amount = account ? parseMoney(text(data, "transaction-amount"), account.currency) : null;
    if (!account || !isPositiveMinor(amount) || !text(data, "transaction-description") || !text(data, "transaction-category")) { setError("Choose an account and enter a positive amount, category, and description."); return; }
    const current = snapshot.transactions.find(({ id }) => id === editingId);
    try {
      await saveMutation("finance_transaction", current?.id ?? crypto.randomUUID(), current?.revision ?? 0, {
        account_id: account.id, transaction_type: text(data, "transaction-type"), amount_minor: amount, currency: account.currency,
        local_date: text(data, "transaction-date"), category: text(data, "transaction-category"), description: text(data, "transaction-description"),
        notes: optionalText(data, "transaction-notes"), active: true,
      });
      closeForm();
    } catch (saveError) { setError(message(saveError, "The transaction could not be saved.")); }
  }

  async function submitBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); const currency = text(data, "budget-currency").toUpperCase();
    const amount = parseMoney(text(data, "budget-amount"), currency); const month = text(data, "budget-month");
    if (!isPositiveMinor(amount) || !text(data, "budget-category") || !month) { setError("Add a category, month, and positive budget amount."); return; }
    const existing = snapshot.budgets.find(({ id }) => id === editingId);
    const duplicate = snapshot.budgets.find(({ id, category, currency: code, period_start }) => id !== existing?.id && category.toLowerCase() === text(data, "budget-category").toLowerCase() && code === currency && period_start === `${month}-01`);
    const current = existing ?? duplicate;
    try {
      await saveMutation("finance_budget", current?.id ?? crypto.randomUUID(), current?.revision ?? 0, {
        category: text(data, "budget-category"), currency, period_start: `${month}-01`, amount_minor: amount, active: true,
      });
      closeForm();
    } catch (saveError) { setError(message(saveError, "The budget could not be saved.")); }
  }

  async function submitRecurring(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const accountId = optionalText(data, "recurring-account");
    const account = snapshot.accounts.find(({ id }) => id === accountId);
    const currency = (account?.currency ?? text(data, "recurring-currency")).toUpperCase();
    const amount = parseMoney(text(data, "recurring-amount"), currency);
    if (!isPositiveMinor(amount) || !text(data, "recurring-name") || !text(data, "recurring-category")) { setError("Enter a recurring charge name, category, and positive amount."); return; }
    const current = snapshot.recurringCharges.find(({ id }) => id === editingId);
    try {
      await saveMutation("finance_recurring_charge", current?.id ?? crypto.randomUUID(), current?.revision ?? 0, {
        account_id: accountId, name: text(data, "recurring-name"), category: text(data, "recurring-category"), amount_minor: amount,
        currency, cadence: text(data, "recurring-cadence"), next_due_on: text(data, "recurring-next-due"), notes: optionalText(data, "recurring-notes"), active: true,
      });
      closeForm();
    } catch (saveError) { setError(message(saveError, "The recurring charge could not be saved.")); }
  }

  async function submitPosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const current = snapshot.positions.find(({ id }) => id === editingId);
    const kind = text(data, "position-type") || current?.position_type || "asset"; const quantity = optionalText(data, "position-quantity") ?? current?.quantity ?? null;
    const currency = (text(data, "position-currency") || current?.currency || "PHP").toUpperCase();
    if (!text(data, "position-name") || (kind === "holding" && (!text(data, "position-symbol") || !validQuantity(quantity)))) { setError("Add a position name and, for holdings, a symbol and positive quantity."); return; }
    try {
      await saveMutation("finance_position", current?.id ?? crypto.randomUUID(), current?.revision ?? 0, {
        position_type: kind, account_id: optionalText(data, "position-account"), name: text(data, "position-name"),
        symbol: optionalText(data, "position-symbol")?.toUpperCase() ?? null, quantity: kind === "holding" ? quantity : null,
        currency, opened_on: text(data, "position-opened"), closed_on: current?.closed_on ?? null, active: true,
      });
      closeForm();
    } catch (saveError) { setError(message(saveError, "The position could not be saved.")); }
  }

  async function submitValuation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const position = snapshot.positions.find(({ id }) => id === targetPositionId);
    if (!position) { setError("Choose a position first."); return; }
    const freshness = text(data, "valuation-freshness") as FinancePositionValuation["freshness"];
    const unitPrice = position.position_type === "holding" && freshness !== "unavailable" ? parseMoney(text(data, "valuation-unit-price"), position.currency) : null;
    const value = position.position_type !== "holding" && freshness !== "unavailable" ? parseMoney(text(data, "valuation-value"), position.currency) : null;
    if (freshness !== "unavailable" && (position.position_type === "holding" ? !isPositiveMinor(unitPrice) : value === null || BigInt(value) < BigInt(0))) { setError("Enter a non-negative value in the position currency, and a positive unit price for holdings."); return; }
    if (freshness === "unavailable" && !text(data, "valuation-reason")) { setError("Add a reason when a valuation is unavailable."); return; }
    const quantityValue = position.quantity ?? "0";
    const totalValue = unitPrice ? multiplyMinorUnitsByQuantity(unitPrice, quantityValue) : value;
    const asOf = localDateTimeToIso(...splitLocalDateTime(text(data, "valuation-as-of")), profile.timezone);
    if (!asOf) { setError("Choose a valid quote time."); return; }
    const current = snapshot.valuations.find(({ id }) => id === editingId);
    try {
      await saveMutation("finance_valuation", current?.id ?? crypto.randomUUID(), current?.revision ?? 0, {
        position_id: position.id, local_date: text(data, "valuation-date"), as_of: asOf, value_minor: totalValue,
        unit_price_minor: unitPrice, currency: position.currency, source: text(data, "valuation-source") || "manual",
        freshness, reason: optionalText(data, "valuation-reason"), notes: optionalText(data, "valuation-notes"),
      });
      closeForm();
    } catch (saveError) { setError(message(saveError, "The valuation could not be saved.")); }
  }

  async function submitRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const base = text(data, "fx-base").toUpperCase(); const quote = text(data, "fx-quote").toUpperCase();
    const freshness = text(data, "fx-freshness") as FinanceFxRate["freshness"];
    const rate = freshness === "unavailable" ? null : text(data, "fx-rate");
    if (base.length !== 3 || quote.length !== 3 || base === quote || (rate !== null && !validRate(rate))) { setError("Choose two different ISO currency codes and enter a positive rate with up to 12 decimal places."); return; }
    if (freshness === "unavailable" && !text(data, "fx-reason")) { setError("Add a reason when the exchange rate is unavailable."); return; }
    const asOf = localDateTimeToIso(...splitLocalDateTime(text(data, "fx-as-of")), profile.timezone);
    if (!asOf) { setError("Choose a valid rate time."); return; }
    const current = snapshot.fxRates.find(({ id }) => id === editingId);
    try {
      await saveMutation("finance_fx_rate", current?.id ?? crypto.randomUUID(), current?.revision ?? 0, {
        base_currency: base, quote_currency: quote, rate, source: text(data, "fx-source") || "manual", as_of: asOf,
        freshness, reason: optionalText(data, "fx-reason"),
      });
      closeForm();
    } catch (saveError) { setError(message(saveError, "The exchange rate could not be saved.")); }
  }

  async function submitConversion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const fxRate = snapshot.fxRates.find(({ id }) => id === text(data, "conversion-rate-id"));
    const fromCurrency = text(data, "conversion-from").toUpperCase(); const toCurrency = text(data, "conversion-to").toUpperCase();
    const amount = parseMoney(text(data, "conversion-amount"), fromCurrency);
    const rate = fxRate?.rate ?? text(data, "conversion-rate");
    if (!amount || fromCurrency === toCurrency || !rate || !validRate(rate)) { setError("Enter a valid amount, distinct currencies, and a positive FX rate with up to 12 decimal places."); return; }
    const converted = convertMinorUnits(amount, fromCurrency, toCurrency, rate);
    const asOfInput = text(data, "conversion-as-of");
    const asOf = fxRate?.as_of ?? (asOfInput ? localDateTimeToIso(...splitLocalDateTime(asOfInput), profile.timezone) : null);
    if (!asOf) { setError("Enter the rate's as-of time."); return; }
    try {
      await saveMutation("finance_conversion", crypto.randomUUID(), 0, {
        fx_rate_id: fxRate?.id ?? null, local_date: today, from_amount_minor: amount, from_currency: fromCurrency,
        to_amount_minor: converted, to_currency: toCurrency, rate, source: fxRate?.source ?? (text(data, "conversion-source") || "manual"), as_of: asOf,
      });
      closeForm();
    } catch (saveError) { setError(message(saveError, "The conversion could not be saved.")); }
  }

  async function archiveAccount(account: FinanceAccount) {
    try { await saveMutation("finance_account", account.id, account.revision, { active: false, closed_on: today }); }
    catch (saveError) { setError(message(saveError, "The account could not be archived.")); }
  }

  async function archiveTransaction(transaction: FinanceTransaction) {
    try { await saveMutation("finance_transaction", transaction.id, transaction.revision, { active: false }); }
    catch (saveError) { setError(message(saveError, "The transaction could not be voided.")); }
  }

  async function archivePosition(position: FinancePosition) {
    try { await saveMutation("finance_position", position.id, position.revision, { active: false, closed_on: today }); }
    catch (saveError) { setError(message(saveError, "The position could not be closed.")); }
  }

  async function archiveBudget(budget: FinanceBudget) {
    try { await saveMutation("finance_budget", budget.id, budget.revision, { active: false }); }
    catch (saveError) { setError(message(saveError, "The budget could not be archived.")); }
  }

  async function archiveRecurring(charge: FinanceRecurringCharge) {
    try { await saveMutation("finance_recurring_charge", charge.id, charge.revision, { active: false }); }
    catch (saveError) { setError(message(saveError, "The recurring charge could not be archived.")); }
  }

  const accounts = snapshot.accounts.filter(({ active }) => active);
  const positions = snapshot.positions.filter(({ active }) => active);
  const monthFlow = monthlyFinanceFlow(snapshot, monthStart, today);
  const currentMonthBudgets = snapshot.budgets.filter(({ active, period_start }) => active && period_start === monthStart);
  const currentRecurring = snapshot.recurringCharges.filter(({ active }) => active).sort((a, b) => a.next_due_on.localeCompare(b.next_due_on));
  const recentTransactions = snapshot.transactions.filter(({ active }) => active).slice().sort((a, b) => b.local_date.localeCompare(a.local_date)).slice(0, 25);
  const currencyCodes = [...new Set([...commonCurrencies, ...snapshot.accounts.map(({ currency }) => currency), ...snapshot.positions.map(({ currency }) => currency)])].sort();
  const editingAccount = form === "account" ? snapshot.accounts.find(({ id }) => id === editingId) ?? null : null;
  const editingTransaction = form === "transaction" ? snapshot.transactions.find(({ id }) => id === editingId) ?? null : null;
  const editingBudget = form === "budget" ? snapshot.budgets.find(({ id }) => id === editingId) ?? null : null;
  const editingRecurring = form === "recurring" ? snapshot.recurringCharges.find(({ id }) => id === editingId) ?? null : null;
  const editingPosition = form === "position" ? snapshot.positions.find(({ id }) => id === editingId) ?? null : null;
  const editingValuation = form === "valuation" ? snapshot.valuations.find(({ id }) => id === editingId) ?? null : null;
  const valuationPosition = snapshot.positions.find(({ id }) => id === targetPositionId) ?? null;
  const editingRate = form === "fx" ? snapshot.fxRates.find(({ id }) => id === editingId) ?? null : null;

  return <div className="finance-page">
    <PageHeader title="Finances" subtitle="Accounts, spending, and your balance sheet" />
    <div className="finance-toolbar"><span className="health-sync">{offline ? "Offline · saved finance records" : online ? "Manual values · syncing enabled" : "Offline · changes saved on this device"}</span><div className="health-actions"><button className="button button-secondary" type="button" onClick={() => openForm("transaction")}>Add transaction</button><button className="button button-primary" type="button" onClick={() => openForm("account")}>Add account</button></div></div>
    <p className="finance-provider-note"><span className="status-dot status-dot-muted" aria-hidden="true" />{marketStatus} Manual values stay available; no live provider is enabled.</p>
    {error && <p className="form-message" role="alert">{error}</p>}

    <section className="health-section" aria-labelledby="net-worth-title">
      <div className="health-section-heading"><div><span className="eyebrow">BALANCE SHEET</span><h2 id="net-worth-title">Net worth</h2></div><span className="health-count">As of {today}</span></div>
      {netWorth.length ? <div className="finance-networth-grid">{netWorth.map(({ currency, amount_minor }) => <article className="finance-networth-item" key={currency}><span>{currency}</span><strong>{formatMinorUnits(amount_minor, currency)}</strong></article>)}</div> : <div className="health-empty"><h3>Add your first account or asset.</h3><p>Totals stay grouped by currency until you record an exchange rate.</p><button className="text-button" type="button" onClick={() => openForm("account")}>Add account <span aria-hidden="true">→</span></button></div>}
      <div className="finance-cashflow-row">{monthFlow.length ? monthFlow.map((flow) => <div className="finance-cashflow" key={flow.currency}><strong>{flow.currency} · this month</strong><span>In {formatMinorUnits(flow.income_minor, flow.currency)}</span><span>Out {formatMinorUnits(flow.expense_minor, flow.currency)}</span><span>Net {formatMinorUnits(flow.net_minor, flow.currency)}</span></div>) : <p className="health-muted">No income or expenses recorded this month.</p>}</div>
    </section>

    <section className="health-section" aria-labelledby="accounts-title">
      <div className="health-section-heading"><div><span className="eyebrow">CASH & CREDIT</span><h2 id="accounts-title">Accounts</h2></div><button className="text-button" type="button" onClick={() => openForm("account")}>Add account <span aria-hidden="true">+</span></button></div>
      {accounts.length ? <div className="finance-list">{accounts.map((account) => {
        const balance = financeAccountBalanceAt(account, snapshot.transactions, today);
        return <article className="finance-row" key={account.id}><div><strong>{account.name}</strong><small>{account.account_type} · {account.currency}</small></div><strong className="finance-amount">{formatMinorUnits(balance, account.currency)}{account.account_type === "credit" && <small> owed</small>}</strong><div className="health-actions"><button className="text-button" type="button" onClick={() => openForm("account", account.id)}>Edit</button><button className="text-button" type="button" onClick={() => void archiveAccount(account)}>Close</button></div></article>;
      })}</div> : <p className="health-muted">No accounts yet. Add a cash, bank, credit, or investment account.</p>}
    </section>

    <section className="health-section" aria-labelledby="transactions-title">
      <div className="health-section-heading"><div><span className="eyebrow">MANUAL LEDGER</span><h2 id="transactions-title">Transactions</h2></div><button className="text-button" type="button" onClick={() => openForm("transaction")}>Add transaction <span aria-hidden="true">+</span></button></div>
      {recentTransactions.length ? <div className="finance-list">{recentTransactions.map((transaction) => <article className="finance-row" key={transaction.id}><div><strong>{transaction.description}</strong><small>{transaction.local_date} · {transaction.category} · {snapshot.accounts.find(({ id }) => id === transaction.account_id)?.name ?? "Closed account"}</small></div><strong className={transaction.transaction_type === "income" ? "finance-income" : "finance-expense"}>{transaction.transaction_type === "income" ? "+" : "−"}{formatMinorUnits(transaction.amount_minor, transaction.currency)}</strong><div className="health-actions"><button className="text-button" type="button" onClick={() => openForm("transaction", transaction.id)}>Edit</button><button className="text-button" type="button" onClick={() => void archiveTransaction(transaction)}>Void</button></div></article>)}</div> : <p className="health-muted">No transactions yet. Transactions preserve the account currency and exact minor-unit amount.</p>}
    </section>

    <section className="health-section" aria-labelledby="budgets-title">
      <div className="health-section-heading"><div><span className="eyebrow">{monthStart.slice(0, 7)} · MONTHLY</span><h2 id="budgets-title">Budgets</h2></div><button className="text-button" type="button" onClick={() => openForm("budget")}>Add budget <span aria-hidden="true">+</span></button></div>
      {currentMonthBudgets.length ? <div className="finance-budget-grid">{currentMonthBudgets.map((budget) => {
        const spent = budgetSpent(snapshot, budget, today); const percent = Math.min(100, ratioPercent(spent, budget.amount_minor));
        return <article className="finance-budget" key={budget.id}><div className="finance-row"><div><strong>{budget.category}</strong><small>{budget.period_start.slice(0, 7)} · {budget.currency}</small></div><div className="health-actions"><button className="text-button" type="button" onClick={() => openForm("budget", budget.id)}>Edit</button><button className="text-button" type="button" onClick={() => void archiveBudget(budget)}>Archive</button></div></div><div className="finance-budget-amounts"><strong>{formatMinorUnits(spent, budget.currency)}</strong><span>of {formatMinorUnits(budget.amount_minor, budget.currency)}</span></div><div className="home-progress-track" aria-label={`${budget.category}: ${percent}% of budget used`}><span style={{ width: `${percent}%` }} /></div></article>;
      })}</div> : <p className="health-muted">No budgets for this month.</p>}
    </section>

    <section className="health-section" aria-labelledby="recurring-title">
      <div className="health-section-heading"><div><span className="eyebrow">SCHEDULES · NO AUTO-POSTING</span><h2 id="recurring-title">Recurring charges</h2></div><button className="text-button" type="button" onClick={() => openForm("recurring")}>Add schedule <span aria-hidden="true">+</span></button></div>
      {currentRecurring.length ? <div className="finance-list">{currentRecurring.map((charge) => <article className="finance-row" key={charge.id}><div><strong>{charge.name}</strong><small>{charge.category} · {charge.cadence} · next {charge.next_due_on}</small></div><strong>{formatMinorUnits(charge.amount_minor, charge.currency)}</strong><div className="health-actions"><button className="text-button" type="button" onClick={() => openForm("recurring", charge.id)}>Edit</button><button className="text-button" type="button" onClick={() => void archiveRecurring(charge)}>Stop</button></div></article>)}</div> : <p className="health-muted">No recurring charges scheduled.</p>}
    </section>

    <section className="health-section" aria-labelledby="positions-title">
      <div className="health-section-heading"><div><span className="eyebrow">ASSETS · DEBTS · HOLDINGS</span><h2 id="positions-title">Positions</h2></div><button className="text-button" type="button" onClick={() => openForm("position")}>Add position <span aria-hidden="true">+</span></button></div>
      {positions.length ? <div className="finance-list">{positions.map((position) => {
        const valuation = latestPositionValuation(snapshot, position.id, today);
        const freshness = valuation ? resolveFreshness(valuation.freshness, valuation.as_of) : "unavailable";
        const positionHistory = snapshot.valuations.filter(({ position_id }) => position_id === position.id).sort((left, right) => right.local_date.localeCompare(left.local_date));
        return <article className="finance-position-card" key={position.id}><div className="finance-row finance-position-row"><div><strong>{position.name}{position.symbol ? ` · ${position.symbol}` : ""}</strong><small>{position.position_type} · {position.currency}{position.quantity ? ` · ${position.quantity} units` : ""}</small></div><div><strong>{valuation?.value_minor === null || !valuation ? "No valuation" : formatMinorUnits(valuation.value_minor, position.currency)}</strong>{valuation && <small className={`finance-freshness is-${freshness}`}>{valuation.source} · {freshness} · {valuation.as_of}{valuation.reason ? ` · ${valuation.reason}` : ""}</small>}</div><div className="health-actions"><button className="text-button" type="button" onClick={() => openForm("valuation", null, position.id)}>Update value</button><button className="text-button" type="button" onClick={() => openForm("position", position.id)}>Edit</button><button className="text-button" type="button" onClick={() => void archivePosition(position)}>Close</button></div></div>{positionHistory.length > 0 && <details className="finance-history"><summary>Valuation history · {positionHistory.length}</summary><div className="finance-list">{positionHistory.slice(0, 12).map((entry) => <article className="finance-row" key={entry.id}><div><strong>{entry.local_date}</strong><small>{entry.source} · {entry.as_of}</small></div><span>{entry.value_minor === null ? entry.reason ?? "Unavailable" : formatMinorUnits(entry.value_minor, entry.currency)}</span><span className={`finance-freshness is-${resolveFreshness(entry.freshness, entry.as_of)}`}>{resolveFreshness(entry.freshness, entry.as_of)}</span><button className="text-button" type="button" onClick={() => openForm("valuation", entry.id, position.id)}>Edit</button></article>)}</div></details>}</article>;
      })}</div> : <p className="health-muted">Track an asset, a debt, or a portfolio holding with a manual valuation.</p>}
    </section>

    <section className="health-section" aria-labelledby="market-data-title">
      <div className="health-section-heading"><div><span className="eyebrow">SOURCE & FRESHNESS</span><h2 id="market-data-title">Quotes and exchange rates</h2></div><div className="health-actions"><button className="text-button" type="button" onClick={() => openForm("fx")}>Add FX rate <span aria-hidden="true">+</span></button><button className="text-button" type="button" onClick={() => openForm("conversion")}>Convert currency <span aria-hidden="true">→</span></button></div></div>
      <div className="finance-provider-banner"><span className="health-count">Live providers disabled</span><span>{"Manual quote and FX entries remain available. No provider credentials are requested or sent."}</span></div>
      {snapshot.fxRates.length > 0 && <div className="finance-list">{snapshot.fxRates.slice(0, 12).map((rate) => <article className="finance-row" key={rate.id}><div><strong>{rate.base_currency} / {rate.quote_currency} · {rate.rate ?? "Unavailable"}</strong><small>{rate.source} · {rate.as_of}{rate.reason ? ` · ${rate.reason}` : ""}</small></div><span className={`finance-freshness is-${resolveFreshness(rate.freshness, rate.as_of)}`}>{resolveFreshness(rate.freshness, rate.as_of)}</span><button className="text-button" type="button" onClick={() => openForm("fx", rate.id)}>Edit</button></article>)}</div>}
      {snapshot.conversions.length > 0 && <><div className="health-section-heading finance-subheading"><h3>Conversion history</h3></div><div className="finance-list">{snapshot.conversions.slice(0, 12).map((conversion) => <article className="finance-row" key={conversion.id}><div><strong>{formatMinorUnits(conversion.from_amount_minor, conversion.from_currency)} → {formatMinorUnits(conversion.to_amount_minor, conversion.to_currency)}</strong><small>{conversion.rate} · {conversion.source} · as of {conversion.as_of}</small></div><small>{conversion.local_date}</small></article>)}</div></>}
    </section>

    <section className="health-section" aria-labelledby="worth-history-title"><div className="health-section-heading"><div><span className="eyebrow">RECONSTRUCTED FROM DATED RECORDS</span><h2 id="worth-history-title">Net-worth history</h2></div><span className="health-count">{history.length} dated points</span></div>{history.length ? <div className="finance-list">{history.slice().reverse().map((point) => <article className="finance-row" key={point.date}><strong>{point.date}</strong><span>{point.totals.map(({ currency, amount_minor }) => `${formatMinorUnits(amount_minor, currency)}`).join(" · ") || "No valued positions"}</span></article>)}</div> : <p className="health-muted">Net-worth history appears after you add dated account activity or valuations.</p>}</section>

    {form === "account" && <AccountForm account={editingAccount} today={today} currencies={currencyCodes} error={error} onClose={closeForm} onSubmit={submitAccount} />}
    {form === "transaction" && <TransactionForm transaction={editingTransaction} accounts={accounts} today={today} error={error} onClose={closeForm} onSubmit={submitTransaction} />}
    {form === "budget" && <BudgetForm budget={editingBudget} today={today} currencies={currencyCodes} error={error} onClose={closeForm} onSubmit={submitBudget} />}
    {form === "recurring" && <RecurringForm charge={editingRecurring} accounts={accounts} today={today} currencies={currencyCodes} error={error} onClose={closeForm} onSubmit={submitRecurring} />}
    {form === "position" && <PositionForm position={editingPosition} accounts={accounts} today={today} currencies={currencyCodes} error={error} onClose={closeForm} onSubmit={submitPosition} />}
    {form === "valuation" && valuationPosition && <ValuationForm key={`${valuationPosition.id}:${editingValuation?.id ?? "new"}`} position={valuationPosition} valuation={editingValuation} today={today} timezone={profile.timezone} error={error} onClose={closeForm} onSubmit={submitValuation} />}
    {form === "fx" && <FxRateForm rate={editingRate} currencies={currencyCodes} timezone={profile.timezone} error={error} onClose={closeForm} onSubmit={submitRate} />}
    {form === "conversion" && <ConversionForm currencies={currencyCodes} rates={snapshot.fxRates} today={today} timezone={profile.timezone} error={error} onClose={closeForm} onSubmit={submitConversion} />}
  </div>;
}

function AccountForm({ account, today, currencies, error, onClose, onSubmit }: { account: FinanceAccount | null; today: string; currencies: string[]; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  const currency = account?.currency ?? "PHP";
  return <FinanceSheet title={account ? "Edit account" : "Add account"} error={error} onClose={onClose} onSubmit={onSubmit}>
    <label className="field-label" htmlFor="account-name">Account name<input id="account-name" name="account-name" defaultValue={account?.name ?? ""} required /></label>
    <label className="field-label" htmlFor="account-type">Type<select id="account-type" name="account-type" defaultValue={account?.account_type ?? "checking"} disabled={Boolean(account)}>{["cash", "checking", "savings", "credit", "investment", "other"].map((type) => <option key={type}>{type}</option>)}</select></label>
    <label className="field-label" htmlFor="account-currency">Currency<select id="account-currency" name="currency" defaultValue={currency} disabled={Boolean(account)}>{currencies.map((code) => <option key={code}>{code}</option>)}</select></label>
    <label className="field-label" htmlFor="opening-balance">Opening balance<input id="opening-balance" name="opening-balance" inputMode="decimal" placeholder="0.00" defaultValue={account ? minorUnitsInput(account.opening_balance_minor, currency) : ""} required /></label>
    <label className="field-label" htmlFor="opened-on">Opened on<input id="opened-on" name="opened-on" type="date" defaultValue={account?.opened_on ?? today} required /></label>
    <button className="button button-primary" type="submit">{account ? "Save account" : "Create account"}</button>
  </FinanceSheet>;
}

function TransactionForm({ transaction, accounts, today, error, onClose, onSubmit }: { transaction: FinanceTransaction | null; accounts: FinanceAccount[]; today: string; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  const compatibleAccounts = transaction ? accounts.filter(({ currency }) => currency === transaction.currency) : accounts;
  return <FinanceSheet title={transaction ? "Edit transaction" : "Add transaction"} error={error} onClose={onClose} onSubmit={onSubmit}>
    {compatibleAccounts.length ? <label className="field-label" htmlFor="account-id">Account<select id="account-id" name="account-id" defaultValue={transaction?.account_id ?? compatibleAccounts[0]?.id}>{compatibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label> : <p className="health-banner">Create an account before recording transactions.</p>}
    <label className="field-label" htmlFor="transaction-type">Type<select id="transaction-type" name="transaction-type" defaultValue={transaction?.transaction_type ?? "expense"}><option value="expense">Expense</option><option value="income">Income</option></select></label>
    <label className="field-label" htmlFor="transaction-amount">Amount<input id="transaction-amount" name="transaction-amount" inputMode="decimal" placeholder="0.00" defaultValue={transaction ? minorUnitsInput(transaction.amount_minor, transaction.currency) : ""} required /></label>
    <label className="field-label" htmlFor="transaction-category">Category<input id="transaction-category" name="transaction-category" defaultValue={transaction?.category ?? ""} placeholder="Food, salary, transport…" required /></label>
    <label className="field-label" htmlFor="transaction-description">Description<input id="transaction-description" name="transaction-description" defaultValue={transaction?.description ?? ""} required /></label>
    <label className="field-label" htmlFor="transaction-date">Date<input id="transaction-date" name="transaction-date" type="date" defaultValue={transaction?.local_date ?? today} required /></label>
    <label className="field-label" htmlFor="transaction-notes">Notes <span className="optional-label">Optional</span><textarea id="transaction-notes" name="transaction-notes" defaultValue={transaction?.notes ?? ""} /></label>
    <button className="button button-primary" type="submit" disabled={!compatibleAccounts.length}>{transaction ? "Save transaction" : "Record transaction"}</button>
  </FinanceSheet>;
}

function BudgetForm({ budget, today, currencies, error, onClose, onSubmit }: { budget: FinanceBudget | null; today: string; currencies: string[]; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  return <FinanceSheet title={budget ? "Edit budget" : "Add budget"} error={error} onClose={onClose} onSubmit={onSubmit}>
    <label className="field-label" htmlFor="budget-category">Category<input id="budget-category" name="budget-category" defaultValue={budget?.category ?? ""} required /></label>
    <label className="field-label" htmlFor="budget-currency">Currency<select id="budget-currency" name="budget-currency" defaultValue={budget?.currency ?? currencies[0] ?? "PHP"}>{currencies.map((code) => <option key={code}>{code}</option>)}</select></label>
    <label className="field-label" htmlFor="budget-month">Month<input id="budget-month" name="budget-month" type="month" defaultValue={budget?.period_start.slice(0, 7) ?? today.slice(0, 7)} required /></label>
    <label className="field-label" htmlFor="budget-amount">Limit<input id="budget-amount" name="budget-amount" inputMode="decimal" placeholder="0.00" defaultValue={budget ? minorUnitsInput(budget.amount_minor, budget.currency) : ""} required /></label>
    <button className="button button-primary" type="submit">{budget ? "Save budget" : "Create budget"}</button>
  </FinanceSheet>;
}

function RecurringForm({ charge, accounts, today, currencies, error, onClose, onSubmit }: { charge: FinanceRecurringCharge | null; accounts: FinanceAccount[]; today: string; currencies: string[]; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  const [accountId, setAccountId] = useState(charge?.account_id ?? "");
  const [currency, setCurrency] = useState(charge?.currency ?? currencies[0] ?? "PHP");
  const linkedAccount = accounts.find(({ id }) => id === accountId);
  const selectedCurrency = linkedAccount?.currency ?? currency;
  return <FinanceSheet title={charge ? "Edit recurring charge" : "Schedule a recurring charge"} error={error} onClose={onClose} onSubmit={onSubmit}>
    <label className="field-label" htmlFor="recurring-name">Name<input id="recurring-name" name="recurring-name" defaultValue={charge?.name ?? ""} required /></label>
    <label className="field-label" htmlFor="recurring-category">Category<input id="recurring-category" name="recurring-category" defaultValue={charge?.category ?? "Subscription"} required /></label>
    <label className="field-label" htmlFor="recurring-amount">Amount<input id="recurring-amount" name="recurring-amount" inputMode="decimal" defaultValue={charge ? minorUnitsInput(charge.amount_minor, charge.currency) : ""} required /></label>
    <label className="field-label" htmlFor="recurring-currency">Currency<select id="recurring-currency" name="recurring-currency" value={selectedCurrency} disabled={Boolean(linkedAccount)} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((code) => <option key={code}>{code}</option>)}</select></label>
    <label className="field-label" htmlFor="recurring-account">Account <span className="optional-label">Optional</span><select id="recurring-account" name="recurring-account" value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Not assigned</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label>
    <label className="field-label" htmlFor="recurring-cadence">Repeats<select id="recurring-cadence" name="recurring-cadence" defaultValue={charge?.cadence ?? "monthly"}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></label>
    <label className="field-label" htmlFor="recurring-next-due">Next due<input id="recurring-next-due" name="recurring-next-due" type="date" defaultValue={charge?.next_due_on ?? today} required /></label>
    <label className="field-label" htmlFor="recurring-notes">Notes <span className="optional-label">Optional</span><textarea id="recurring-notes" name="recurring-notes" defaultValue={charge?.notes ?? ""} /></label>
    <p className="health-muted">This schedule never creates a transaction automatically.</p>
    <button className="button button-primary" type="submit">{charge ? "Save schedule" : "Save schedule"}</button>
  </FinanceSheet>;
}

function PositionForm({ position, accounts, today, currencies, error, onClose, onSubmit }: { position: FinancePosition | null; accounts: FinanceAccount[]; today: string; currencies: string[]; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  const [kind, setKind] = useState<FinancePosition["position_type"]>(position?.position_type ?? "asset");
  return <FinanceSheet title={position ? "Edit position" : "Add asset, debt, or holding"} error={error} onClose={onClose} onSubmit={onSubmit}>
    <label className="field-label" htmlFor="position-type">Type<select id="position-type" name="position-type" value={kind} disabled={Boolean(position)} onChange={(event) => setKind(event.target.value as FinancePosition["position_type"])}><option value="asset">Asset</option><option value="debt">Debt</option><option value="holding">Portfolio holding</option></select></label>
    <label className="field-label" htmlFor="position-name">Name<input id="position-name" name="position-name" defaultValue={position?.name ?? ""} required /></label>
    {kind === "holding" && <><label className="field-label" htmlFor="position-symbol">Ticker / symbol<input id="position-symbol" name="position-symbol" defaultValue={position?.symbol ?? ""} required /></label><label className="field-label" htmlFor="position-quantity">Units held<input id="position-quantity" name="position-quantity" type="number" min="0.00000001" step="0.00000001" defaultValue={position?.quantity ?? ""} required /></label></>}
    <label className="field-label" htmlFor="position-currency">Currency<select id="position-currency" name="position-currency" defaultValue={position?.currency ?? currencies[0] ?? "PHP"} disabled={Boolean(position)}>{currencies.map((code) => <option key={code}>{code}</option>)}</select></label>
    <label className="field-label" htmlFor="position-account">Related account <span className="optional-label">Optional</span><select id="position-account" name="position-account" defaultValue={position?.account_id ?? ""}><option value="">Not assigned</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
    <label className="field-label" htmlFor="position-opened">Opened / acquired<input id="position-opened" name="position-opened" type="date" defaultValue={position?.opened_on ?? today} required /></label>
    {!position && <p className="health-muted">After creating the position, add its first dated valuation.</p>}
    <button className="button button-primary" type="submit">{position ? "Save position" : "Create position"}</button>
  </FinanceSheet>;
}

function ValuationForm({ position, valuation, today, timezone, error, onClose, onSubmit }: { position: FinancePosition; valuation: FinancePositionValuation | null; today: string; timezone: string; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  const dateTime = valuation?.as_of ? isoToLocalDateTimeParts(valuation.as_of, timezone) : isoToLocalDateTimeParts(new Date().toISOString(), timezone);
  const defaultAsOf = `${dateTime.date}T${dateTime.time}`;
  return <FinanceSheet title={valuation ? `Edit ${position.name} valuation` : `Value ${position.name}`} error={error} onClose={onClose} onSubmit={onSubmit}>
    <p className="health-muted">Saved values keep their currency, source, as-of time, and freshness.</p>
    {position.position_type === "holding" ? <label className="field-label" htmlFor="valuation-unit-price">Unit quote ({position.currency})<input id="valuation-unit-price" name="valuation-unit-price" inputMode="decimal" defaultValue={valuation?.unit_price_minor ? minorUnitsInput(valuation.unit_price_minor, position.currency) : ""} /></label> : <label className="field-label" htmlFor="valuation-value">Total value ({position.currency})<input id="valuation-value" name="valuation-value" inputMode="decimal" defaultValue={valuation?.value_minor ? minorUnitsInput(valuation.value_minor, position.currency) : ""} /></label>}
    <label className="field-label" htmlFor="valuation-date">Valuation date<input id="valuation-date" name="valuation-date" type="date" defaultValue={valuation?.local_date ?? today} required /></label>
    <label className="field-label" htmlFor="valuation-as-of">As of<input id="valuation-as-of" name="valuation-as-of" type="datetime-local" defaultValue={defaultAsOf} required /></label>
    <label className="field-label" htmlFor="valuation-source">Source<input id="valuation-source" name="valuation-source" defaultValue={valuation?.source ?? "manual"} required /></label>
    <label className="field-label" htmlFor="valuation-freshness">Freshness<select id="valuation-freshness" name="valuation-freshness" defaultValue={valuation?.freshness ?? "fresh"}><option value="fresh">Fresh</option><option value="stale">Stale</option><option value="unavailable">Unavailable</option></select></label>
    <label className="field-label" htmlFor="valuation-reason">Status note <span className="optional-label">Optional</span><input id="valuation-reason" name="valuation-reason" defaultValue={valuation?.reason ?? ""} /></label>
    <label className="field-label" htmlFor="valuation-notes">Notes <span className="optional-label">Optional</span><textarea id="valuation-notes" name="valuation-notes" defaultValue={valuation?.notes ?? ""} /></label>
    <button className="button button-primary" type="submit">{valuation ? "Save valuation" : "Save valuation"}</button>
  </FinanceSheet>;
}

function FxRateForm({ rate, currencies, timezone, error, onClose, onSubmit }: { rate: FinanceFxRate | null; currencies: string[]; timezone: string; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  const time = isoToLocalDateTimeParts(rate?.as_of ?? new Date().toISOString(), timezone);
  return <FinanceSheet title={rate ? "Edit exchange rate" : "Add manual FX rate"} error={error} onClose={onClose} onSubmit={onSubmit}>
    <div className="finance-form-grid"><label className="field-label" htmlFor="fx-base">From currency<select id="fx-base" name="fx-base" defaultValue={rate?.base_currency ?? currencies[0] ?? "USD"}>{currencies.map((code) => <option key={code}>{code}</option>)}</select></label><label className="field-label" htmlFor="fx-quote">To currency<select id="fx-quote" name="fx-quote" defaultValue={rate?.quote_currency ?? currencies.find((code) => code !== currencies[0]) ?? "PHP"}>{currencies.map((code) => <option key={code}>{code}</option>)}</select></label></div>
    <label className="field-label" htmlFor="fx-rate">Rate<input id="fx-rate" name="fx-rate" inputMode="decimal" defaultValue={rate?.rate ?? ""} placeholder="1.00" /></label>
    <label className="field-label" htmlFor="fx-source">Source<input id="fx-source" name="fx-source" defaultValue={rate?.source ?? "manual"} required /></label>
    <label className="field-label" htmlFor="fx-as-of">As of<input id="fx-as-of" name="fx-as-of" type="datetime-local" defaultValue={`${time.date}T${time.time}`} required /></label>
    <label className="field-label" htmlFor="fx-freshness">Freshness<select id="fx-freshness" name="fx-freshness" defaultValue={rate?.freshness ?? "fresh"}><option value="fresh">Fresh</option><option value="stale">Stale</option><option value="unavailable">Unavailable</option></select></label>
    <label className="field-label" htmlFor="fx-reason">Status note <span className="optional-label">Optional</span><input id="fx-reason" name="fx-reason" defaultValue={rate?.reason ?? ""} /></label>
    <button className="button button-primary" type="submit">{rate ? "Save rate" : "Save rate"}</button>
  </FinanceSheet>;
}

function ConversionForm({ currencies, rates, today, timezone, error, onClose, onSubmit }: { currencies: string[]; rates: FinanceFxRate[]; today: string; timezone: string; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  const [from, setFrom] = useState(currencies[0] ?? "USD");
  const [to, setTo] = useState(currencies.find((currency) => currency !== from) ?? "PHP");
  const [amount, setAmount] = useState("");
  const [rateId, setRateId] = useState("");
  const availableRates = rates.filter(({ rate, freshness }) => rate !== null && freshness !== "unavailable");
  const chosen = availableRates.find(({ id, base_currency, quote_currency }) => id === rateId && base_currency === from && quote_currency === to)
    ?? availableRates.find(({ base_currency, quote_currency }) => base_currency === from && quote_currency === to);
  const rate = chosen?.rate ?? "";
  let converted: string | null = null;
  try { const parsed = parseMinorUnits(amount, from); if (parsed && rate) converted = convertMinorUnits(parsed, from, to, rate); } catch { converted = null; }
  const now = isoToLocalDateTimeParts(new Date().toISOString(), timezone);
  return <FinanceSheet title="Convert currency" error={error} onClose={onClose} onSubmit={onSubmit}>
    <label className="field-label" htmlFor="conversion-rate-id">Saved rate <span className="optional-label">Optional</span><select id="conversion-rate-id" name="conversion-rate-id" value={chosen?.id ?? ""} onChange={(event) => setRateId(event.target.value)}><option value="">Enter a rate manually</option>{availableRates.filter(({ base_currency, quote_currency }) => base_currency === from && quote_currency === to).map((item) => <option key={item.id} value={item.id}>{item.source} · {item.rate} · {item.as_of}</option>)}</select></label>
    <div className="finance-form-grid"><label className="field-label" htmlFor="conversion-from">From<select id="conversion-from" name="conversion-from" value={from} onChange={(event) => { setFrom(event.target.value); setRateId(""); }}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label><label className="field-label" htmlFor="conversion-to">To<select id="conversion-to" name="conversion-to" value={to} onChange={(event) => { setTo(event.target.value); setRateId(""); }}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label></div>
    <label className="field-label" htmlFor="conversion-amount">Amount ({from})<input id="conversion-amount" name="conversion-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
    {!chosen && <><label className="field-label" htmlFor="conversion-rate">Rate<input id="conversion-rate" name="conversion-rate" inputMode="decimal" placeholder="1.00" required /></label><label className="field-label" htmlFor="conversion-source">Rate source<input id="conversion-source" name="conversion-source" defaultValue="manual" required /></label><label className="field-label" htmlFor="conversion-as-of">Rate as of<input id="conversion-as-of" name="conversion-as-of" type="datetime-local" defaultValue={`${now.date}T${now.time}`} required /></label></>}
    <p className="health-banner">Estimated amount: <strong>{converted === null ? "Enter a valid amount and rate" : formatMinorUnits(converted, to)}</strong></p>
    <button className="button button-primary" type="submit" disabled={converted === null}>Save conversion record</button>
    <input type="hidden" name="conversion-as-of-default-date" value={today} />
  </FinanceSheet>;
}

function FinanceSheet({ title, error, onClose, onSubmit, children }: { title: string; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void; children: React.ReactNode }) {
  return <HealthSheet eyebrow="FINANCE" title={title} error={error} onClose={onClose}><form className="sheet-form" onSubmit={onSubmit}>{children}</form></HealthSheet>;
}

function text(data: FormData, key: string): string { return String(data.get(key) ?? "").trim(); }
function optionalText(data: FormData, key: string): string | null { return text(data, key) || null; }
function parseMoney(input: string, currency: string): string | null { try { return parseMinorUnits(input, currency); } catch { return null; } }
function isPositiveMinor(value: string | null): value is string { return value !== null && BigInt(value) > BigInt(0); }
function validQuantity(quantity: string | null): boolean { return Boolean(quantity && Number.isFinite(Number(quantity)) && Number(quantity) > 0 && Number(quantity) < 1e16); }
function validRate(rate: string): boolean { return /^(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/.test(rate) && /[1-9]/.test(rate); }
function ratioPercent(part: string, whole: string): number { const denominator = BigInt(whole); if (denominator <= BigInt(0)) return 0; return Number((BigInt(part) * BigInt(100)) / denominator); }
function message(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback; }
function splitLocalDateTime(value: string): [string, string] { const [date, time] = value.split("T"); return [date ?? "", time ?? ""]; }
