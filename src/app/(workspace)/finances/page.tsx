"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { HealthSheet } from "@/app/health-sheet";
import { PageHeader } from "@/app/daily-components";
import { localToday } from "@/lib/daily/repository";
import { isoToLocalDateTimeParts, localDateTimeToIso } from "@/lib/daily/timezone";
import { listMutations, type JsonValue, type WorkspaceEntityType } from "@/lib/offline/outbox";
import { buildNetWorthHistory, netWorthAt, netWorthCompositionAt, resolveFreshness, financeAccountBalanceAt } from "@/lib/finance/valuation";
import { latestPositionValuation, monthlyFinanceFlow } from "@/lib/finance/ledger";
import { budgetCycleDuration, budgetCycleEnd, budgetCycleProgress, expensesOutsideBudgetCurrency } from "@/lib/finance/budget-cycles";
import { convertMinorUnits, formatMinorUnits, minorUnitsInput, multiplyMinorUnitsByQuantity, parseMinorUnits } from "@/lib/finance/money";
import { emptyFinanceSnapshot, type FinanceAccount, type FinanceBudgetCategoryLimit, type FinanceBudgetCycle, type FinanceFxRate, type FinancePosition, type FinancePositionValuation, type FinanceRecurringCharge, type FinanceSnapshot, type FinanceTransaction, type FinanceTransfer } from "@/lib/finance/types";
import { projectLocalFinanceMutations } from "@/lib/finance/projection";
import { loadFinanceSnapshot } from "@/lib/finance/repository";
import { useWorkspace } from "@/app/app-workspace";
import { createClient } from "@/lib/supabase/client";

type FinanceTab = "spending" | "portfolio" | "accounts";
type FinanceForm = "account" | "transaction" | "budget-cycle" | "recurring" | "position" | "valuation" | "fx" | "conversion" | "transfer" | null;
type FinanceEntity = Extract<WorkspaceEntityType,
  "finance_account" | "finance_transaction" | "finance_budget" | "finance_recurring_charge" | "finance_position" | "finance_valuation" | "finance_fx_rate" | "finance_conversion"
  | "finance_budget_cycle" | "finance_budget_category_limit" | "finance_transfer">;
const commonCurrencies = ["USD", "PHP", "EUR", "GBP", "JPY", "CAD", "AUD", "SGD"];
const financeCategories = ["Food", "Housing", "Transport", "Bills", "Health", "Personal", "Shopping", "Entertainment", "Travel", "Education", "Other"];
const financeIncomeCategories = ["Salary", "Freelance", "Interest", "Refund", "Gift", "Other"];
const customCategoryOption = "__custom__";

export default function FinancesPage() {
  const { profile, database, refreshKey, queueMutation, online } = useWorkspace();
  const today = localToday(profile.timezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${today}T12:00:00.000Z`));
  const [snapshot, setSnapshot] = useState<FinanceSnapshot>(emptyFinanceSnapshot);
  const [activeTab, setActiveTab] = useState<FinanceTab>("spending");
  const [transactionListOpen, setTransactionListOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [accountDetailOpen, setAccountDetailOpen] = useState(false);
  const [form, setForm] = useState<FinanceForm>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [targetPositionId, setTargetPositionId] = useState<string | null>(null);
  const [accountToClose, setAccountToClose] = useState<FinanceAccount | null>(null);
  const [closeAccountError, setCloseAccountError] = useState("");
  const [closingAccount, setClosingAccount] = useState(false);
  const [newPositionType, setNewPositionType] = useState<FinancePosition["position_type"]>("asset");
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);

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
    if (window.location.hash !== "#net-worth-history") return;
    window.requestAnimationFrame(() => {
      setActiveTab("accounts");
      setAccountDetailOpen(false);
      window.requestAnimationFrame(() => document.getElementById("net-worth-history")?.scrollIntoView({ block: "start" }));
    });
  }, []);

  const netWorth = useMemo(() => netWorthAt(snapshot, today), [snapshot, today]);
  const composition = useMemo(() => netWorthCompositionAt(snapshot, today), [snapshot, today]);
  const history = useMemo(() => buildNetWorthHistory(snapshot, today).slice(-24), [snapshot, today]);

  function openForm(next: Exclude<FinanceForm, null>, id: string | null = null, positionId: string | null = null, positionType: FinancePosition["position_type"] = "asset") {
    setError(""); setEditingId(id); setTargetPositionId(positionId); setNewPositionType(positionType); setForm(next);
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
    const categoryChoice = text(data, "transaction-category");
    const category = categoryChoice === customCategoryOption ? text(data, "transaction-custom-category") : categoryChoice;
    if (!account || !isPositiveMinor(amount) || !text(data, "transaction-description") || !category) { setError("Choose an account and enter a positive amount, category, and description."); return; }
    const current = snapshot.transactions.find(({ id }) => id === editingId);
    try {
      await saveMutation("finance_transaction", current?.id ?? crypto.randomUUID(), current?.revision ?? 0, {
        account_id: account.id, transaction_type: text(data, "transaction-type"), amount_minor: amount, currency: account.currency,
        local_date: text(data, "transaction-date"), category, description: text(data, "transaction-description"),
        notes: optionalText(data, "transaction-notes"), active: true,
      });
      closeForm();
    } catch (saveError) { setError(message(saveError, "The transaction could not be saved.")); }
  }

  async function submitBudgetCycle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const currentCycle = snapshot.budgetCycles.find(({ id }) => id === editingId);
    // Disabled selects are omitted from FormData, so retain the cycle currency while editing.
    const currency = (text(data, "cycle-currency") || currentCycle?.currency || "").toUpperCase();
    const start = text(data, "cycle-start");
    const duration = Number(text(data, "cycle-duration"));
    const total = parseMoney(text(data, "cycle-total"), currency);
    let end = "";
    try { end = budgetCycleEnd(start, duration); } catch { /* show a form error below */ }
    if (!start || !end || !Number.isInteger(duration) || duration < 1 || duration > 366 || currency.length !== 3) {
      setError("Choose a valid start date, duration from 1 to 366 days, and currency.");
      return;
    }
    if (!isPositiveMinor(total)) {
      setError("Enter a positive overall spending cap.");
      return;
    }
    const overlapping = snapshot.budgetCycles.some((cycle) => cycle.id !== currentCycle?.id && cycle.period_start <= end && cycle.period_end >= start);
    if (overlapping) { setError("A spending cycle already overlaps those dates. Choose a different period."); return; }

    const categoryNames = data.getAll("limit-category").map((value) => String(value).trim());
    const categoryAmounts = data.getAll("limit-amount").map((value) => parseMoney(String(value), currency));
    const categoryIds = data.getAll("limit-id").map((value) => String(value));
    const categoryRevisions = data.getAll("limit-revision").map((value) => Number(value));
    const categoryRows = categoryNames.map((category, index) => ({ category, amount: categoryAmounts[index], id: categoryIds[index] || null, revision: categoryRevisions[index] || 0 }));
    const activeRows = categoryRows.filter(({ category, amount }) => category || amount !== null);
    if (activeRows.some(({ category, amount }) => !category || !isPositiveMinor(amount))) {
      setError("Finish or remove each category limit, and enter a positive amount.");
      return;
    }
    if (new Set(activeRows.map(({ category }) => category.toLowerCase())).size !== activeRows.length) {
      setError("Each category can have one limit in a budget cycle.");
      return;
    }
    const limitsTotal = activeRows.reduce((sum, row) => sum + BigInt(row.amount!), BigInt(0));
    if (limitsTotal > BigInt(total)) {
      setError(`${formatMinorUnits(limitsTotal.toString(), currency)} in category limits exceeds the overall cap of ${formatMinorUnits(total, currency)}. Reduce the category limits or raise the overall cap.`);
      return;
    }

    const cycleId = currentCycle?.id ?? crypto.randomUUID();
    try {
      const saveCycle = () => saveMutation("finance_budget_cycle", cycleId, currentCycle?.revision ?? 0, {
        currency, period_start: start, period_end: end, total_amount_minor: total,
      });
      const saveLimits = async () => {
        const orderedRows = currentCycle && BigInt(total) < BigInt(currentCycle.total_amount_minor)
          ? [...activeRows].sort((left, right) => {
            const leftOld = left.id ? BigInt(snapshot.budgetCategoryLimits.find(({ id }) => id === left.id)?.amount_minor ?? "0") : BigInt(0);
            const rightOld = right.id ? BigInt(snapshot.budgetCategoryLimits.find(({ id }) => id === right.id)?.amount_minor ?? "0") : BigInt(0);
            return (BigInt(left.amount!) - leftOld < BigInt(right.amount!) - rightOld) ? -1 : 1;
          })
          : activeRows;
        for (const { category, amount, id, revision } of orderedRows) {
          await saveMutation("finance_budget_category_limit", id ?? crypto.randomUUID(), revision, {
            cycle_id: cycleId, category, amount_minor: amount!,
          });
        }
      };
      if (currentCycle && BigInt(total) < BigInt(currentCycle.total_amount_minor)) {
        await saveLimits();
        await saveCycle();
      } else {
        await saveCycle();
        await saveLimits();
      }
      closeForm();
    } catch (saveError) { setError(message(saveError, "The budget cycle could not be saved.")); }
  }

  async function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const source = accounts.find(({ id }) => id === text(data, "transfer-from"));
    const destination = accounts.find(({ id }) => id === text(data, "transfer-to"));
    const amount = source ? parseMoney(text(data, "transfer-amount"), source.currency) : null;
    if (!source || !destination || source.id === destination.id || !isPositiveMinor(amount)) {
      setError("Choose two different accounts and enter a positive amount.");
      return;
    }
    let toAmount = amount;
    let rate: string | null = null;
    let rateSource: string | null = null;
    let rateAsOf: string | null = null;
    if (source.currency !== destination.currency) {
      const savedRate = snapshot.fxRates.find(({ id }) => id === text(data, "transfer-rate-id"));
      rate = savedRate?.rate ?? text(data, "transfer-rate");
      if (!rate || !validRate(rate)) { setError("Choose or enter a positive FX rate for these account currencies."); return; }
      const rateBase = savedRate?.base_currency ?? source.currency;
      const rateQuote = savedRate?.quote_currency ?? destination.currency;
      if (rateBase !== source.currency || rateQuote !== destination.currency) { setError("The saved FX rate must match the transfer direction."); return; }
      try { toAmount = convertMinorUnits(amount, source.currency, destination.currency, rate); }
      catch (conversionError) { setError(message(conversionError, "The FX amount could not be calculated.")); return; }
      rateSource = savedRate?.source ?? (text(data, "transfer-source") || "manual");
      rateAsOf = savedRate?.as_of ?? localDateTimeToIso(...splitLocalDateTime(text(data, "transfer-as-of")), profile.timezone);
      if (!rateAsOf) { setError("Enter when the FX rate was recorded."); return; }
    }
    try {
      await saveMutation("finance_transfer", crypto.randomUUID(), 0, {
        from_account_id: source.id, to_account_id: destination.id,
        from_amount_minor: amount, from_currency: source.currency,
        to_amount_minor: toAmount!, to_currency: destination.currency,
        local_date: text(data, "transfer-date"), rate, source: rateSource, as_of: rateAsOf,
        notes: optionalText(data, "transfer-notes"), active: true,
      });
      closeForm();
    } catch (saveError) { setError(message(saveError, "The transfer could not be saved.")); }
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

  async function confirmAccountClose() {
    if (!accountToClose) return;
    setClosingAccount(true);
    setCloseAccountError("");
    try {
      await saveMutation("finance_account", accountToClose.id, accountToClose.revision, { active: false, closed_on: today });
      setAccountToClose(null);
    } catch (saveError) { setCloseAccountError(message(saveError, "The account could not be closed.")); }
    finally { setClosingAccount(false); }
  }

  async function archiveTransaction(transaction: FinanceTransaction) {
    try { await saveMutation("finance_transaction", transaction.id, transaction.revision, { active: false }); }
    catch (saveError) { setError(message(saveError, "The transaction could not be voided.")); }
  }

  async function archiveTransfer(transfer: FinanceTransfer) {
    try { await saveMutation("finance_transfer", transfer.id, transfer.revision, { active: false }); }
    catch (saveError) { setError(message(saveError, "The transfer could not be voided.")); }
  }

  async function archivePosition(position: FinancePosition) {
    try { await saveMutation("finance_position", position.id, position.revision, { active: false, closed_on: today }); }
    catch (saveError) { setError(message(saveError, "The position could not be closed.")); }
  }

  async function archiveRecurring(charge: FinanceRecurringCharge) {
    try { await saveMutation("finance_recurring_charge", charge.id, charge.revision, { active: false }); }
    catch (saveError) { setError(message(saveError, "The recurring charge could not be archived.")); }
  }

  const accounts = snapshot.accounts.filter(({ active }) => active);
  const positions = snapshot.positions.filter(({ active }) => active);
  const investmentPositions = positions.filter(({ position_type }) => position_type === "holding");
  const assetAndDebtPositions = positions.filter(({ position_type }) => position_type !== "holding");
  const monthFlow = monthlyFinanceFlow(snapshot, monthStart, today);
  const monthlySummary = monthFlow.map((flow) => ({ currency: flow.currency, income: flow.income_minor, spent: flow.expense_minor, net: flow.net_minor }));
  const activeBudgetCycles = snapshot.budgetCycles.filter(({ period_start, period_end }) => period_start <= today && period_end >= today);
  const upcomingBudgetCycles = snapshot.budgetCycles.filter(({ period_start }) => period_start > today).sort((a, b) => a.period_start.localeCompare(b.period_start));
  const currentBudgetCycleEntries = activeBudgetCycles.map((cycle) => ({
    cycle,
    progress: budgetCycleProgress(snapshot, cycle, snapshot.budgetCategoryLimits, today),
    foreignExpenseCount: expensesOutsideBudgetCurrency(snapshot, cycle, today),
  }));
  const previousBudgetCycles = snapshot.budgetCycles.filter(({ period_end }) => period_end < today).sort((a, b) => b.period_end.localeCompare(a.period_end));
  const currentRecurring = snapshot.recurringCharges.filter(({ active }) => active).sort((a, b) => a.next_due_on.localeCompare(b.next_due_on));
  const allTransactions = snapshot.transactions.filter(({ active }) => active).slice().sort((a, b) => b.local_date.localeCompare(a.local_date));
  const recentTransactions = allTransactions.slice(0, 25);
  const recentTransfers = snapshot.transfers.filter(({ active }) => active).slice().sort((a, b) => b.local_date.localeCompare(a.local_date)).slice(0, 8);
  const currencyCodes = [...new Set([
    ...commonCurrencies,
    ...snapshot.accounts.map(({ currency }) => currency),
    ...snapshot.positions.map(({ currency }) => currency),
    ...snapshot.fxRates.flatMap(({ base_currency, quote_currency }) => [base_currency, quote_currency]),
    ...snapshot.transfers.flatMap(({ from_currency, to_currency }) => [from_currency, to_currency]),
    ...snapshot.budgetCycles.map(({ currency }) => currency),
  ])].sort();
  const editingAccount = form === "account" ? snapshot.accounts.find(({ id }) => id === editingId) ?? null : null;
  const editingTransaction = form === "transaction" ? snapshot.transactions.find(({ id }) => id === editingId) ?? null : null;
  const editingRecurring = form === "recurring" ? snapshot.recurringCharges.find(({ id }) => id === editingId) ?? null : null;
  const editingPosition = form === "position" ? snapshot.positions.find(({ id }) => id === editingId) ?? null : null;
  const editingValuation = form === "valuation" ? snapshot.valuations.find(({ id }) => id === editingId) ?? null : null;
  const valuationPosition = snapshot.positions.find(({ id }) => id === targetPositionId) ?? null;
  const editingRate = form === "fx" ? snapshot.fxRates.find(({ id }) => id === editingId) ?? null : null;
  const editingBudgetCycle = form === "budget-cycle" ? snapshot.budgetCycles.find(({ id }) => id === editingId) ?? null : null;
  const editingBudgetLimits = editingBudgetCycle ? snapshot.budgetCategoryLimits.filter(({ cycle_id }) => cycle_id === editingBudgetCycle.id) : [];
  const selectedAccount = accounts.find(({ id }) => id === selectedAccountId) ?? null;
  const portfolioTotals = investmentPositions.reduce((totals, position) => {
    const value = latestPositionValuation(snapshot, position.id, today)?.value_minor;
    if (value === null || value === undefined) return totals;
    totals.set(position.currency, (totals.get(position.currency) ?? BigInt(0)) + BigInt(value));
    return totals;
  }, new Map<string, bigint>());

  function renderPositionCard(position: FinancePosition) {
    const valuation = latestPositionValuation(snapshot, position.id, today);
    const freshness = valuation ? resolveFreshness(valuation.freshness, valuation.as_of) : "unavailable";
    const positionHistory = snapshot.valuations.filter(({ position_id }) => position_id === position.id).sort((left, right) => right.local_date.localeCompare(left.local_date));
    return <article className="finance-position-card" key={position.id}>
      <div className="finance-row finance-position-row">
        <div><strong>{position.name}{position.symbol ? ` · ${position.symbol}` : ""}</strong><small>{position.position_type} · {position.currency}{position.quantity ? ` · ${position.quantity} units` : ""}</small></div>
        <div><strong>{valuation?.value_minor === null || !valuation ? "No valuation" : formatMinorUnits(valuation.value_minor, position.currency)}</strong>{valuation && <small className={`finance-freshness is-${freshness}`}>{valuation.source} · {freshness} · {formatFinanceDate(valuation.as_of, profile.timezone)}{valuation.reason ? ` · ${valuation.reason}` : ""}</small>}</div>
        <FinanceRowActions actions={[
          { label: "Update value", onSelect: () => openForm("valuation", null, position.id) },
          { label: "Edit", onSelect: () => openForm("position", position.id) },
          { label: "Close", onSelect: () => void archivePosition(position), danger: true },
        ]} />
      </div>
      {positionHistory.length > 0 && <details className="finance-history"><summary>Valuation history · {positionHistory.length}</summary><div className="finance-list">{positionHistory.slice(0, 12).map((entry) => <article className="finance-row" key={entry.id}><div><strong>{formatFinanceDate(entry.local_date)}</strong><small>{entry.source} · {formatFinanceDate(entry.as_of, profile.timezone)}</small></div><span>{entry.value_minor === null ? entry.reason ?? "Unavailable" : formatMinorUnits(entry.value_minor, entry.currency)}</span><span className={`finance-freshness is-${resolveFreshness(entry.freshness, entry.as_of)}`}>{resolveFreshness(entry.freshness, entry.as_of)}</span><FinanceRowActions actions={[{ label: "Edit", onSelect: () => openForm("valuation", entry.id, position.id) }]} /></article>)}</div></details>}
    </article>;
  }

  return <div className="finance-page">
    <PageHeader title="Finances" subtitle={`${formatFinanceDate(today)} · ${offline ? "Saved on this device" : online ? "Manual values" : "Offline"}`} action={<button className="round-add" type="button" aria-label="Add an expense" onClick={() => openForm("transaction")}>+</button>} />
    <nav className="finance-tabs" role="tablist" aria-label="Finance sections">
      {([ ["spending", "Spending"], ["portfolio", "Portfolio"], ["accounts", "Accounts"] ] as const).map(([tab, label]) => <button key={tab} id={`finance-tab-${tab}`} className={activeTab === tab ? "finance-tab is-active" : "finance-tab"} type="button" role="tab" aria-controls={`finance-panel-${tab}`} aria-selected={activeTab === tab} onClick={() => { setActiveTab(tab); setAccountDetailOpen(false); }}>{label}</button>)}
    </nav>
    {error && <p className="form-message" role="alert">{error}</p>}

    {activeTab === "spending" && <div id="finance-panel-spending" className="finance-tab-content" role="tabpanel" aria-labelledby="finance-tab-spending" tabIndex={0}>
      {transactionListOpen ? <section className="health-section" aria-labelledby="all-transactions-title">
        <div className="health-section-heading"><div><button className="text-button" type="button" onClick={() => setTransactionListOpen(false)}>‹ Spending</button><h2 id="all-transactions-title">All transactions</h2></div><button className="text-button" type="button" onClick={() => openForm("transaction")}>Add transaction <span aria-hidden="true">+</span></button></div>
        {allTransactions.length ? <div className="finance-list">{allTransactions.map((transaction) => <article className="finance-row" key={transaction.id}><div><strong>{transaction.description}</strong><small>{transaction.category} · {formatFinanceDate(transaction.local_date)} · {snapshot.accounts.find(({ id }) => id === transaction.account_id)?.name ?? "Closed account"}</small></div><strong className={transaction.transaction_type === "income" ? "finance-income" : "finance-expense"}>{transaction.transaction_type === "income" ? "+" : "−"}{formatMinorUnits(transaction.amount_minor, transaction.currency)}</strong><FinanceRowActions actions={[{ label: "Edit", onSelect: () => openForm("transaction", transaction.id) }, { label: "Void", onSelect: () => void archiveTransaction(transaction), danger: true }]} /></article>)}</div> : <p className="health-muted">No transactions recorded yet.</p>}
      </section> : <>
      <section className="health-section finance-snapshot" aria-labelledby="monthly-cashflow-title">
        <div className="health-section-heading"><h2 id="monthly-cashflow-title">Cash flow</h2></div>
        {monthlySummary.length ? <div className="finance-flow-list">{monthlySummary.map(({ currency, income, spent, net }) => {
          const incomeMinor = BigInt(income);
          const spentMinor = BigInt(spent);
          const netMinor = BigInt(net);
          const scale = incomeMinor + spentMinor;
          const barWidth = (amount: bigint) => scale > BigInt(0) ? `${Number(amount * BigInt(10000) / scale) / 100}%` : "0%";
          return <div className="finance-flow-group" key={currency}>
            <span className="finance-flow-period">{monthLabel} · {currency}</span>
            <div className="finance-flow-row"><span>Income</span><strong>{formatMinorUnits(income, currency)}</strong><div className="finance-flow-track" role="img" aria-label={`Income ${formatMinorUnits(income, currency)}`}><span className="is-income" style={{ width: barWidth(incomeMinor) }} /></div></div>
            <div className="finance-flow-row"><span>Spent</span><strong>{formatMinorUnits(spent, currency)}</strong><div className="finance-flow-track" role="img" aria-label={`Spent ${formatMinorUnits(spent, currency)}`}><span className="is-spent" style={{ width: barWidth(spentMinor) }} /></div></div>
            <div className="finance-flow-net"><span>{netMinor < BigInt(0) ? "Net outflow" : "Net"}</span><strong className={netMinor < BigInt(0) ? "is-negative" : "is-positive"}>{netMinor > BigInt(0) ? "+" : ""}{formatMinorUnits(net, currency)}</strong></div>
          </div>;
        })}</div> : <p className="health-muted">No income or spending recorded this month.</p>}
      </section>

      <section className="finance-budget-section" aria-label="Budget Tracker">
        {currentBudgetCycleEntries.length === 0 && <div className="finance-budget-heading"><h2 id="budget-tracker-title">Budget Tracker</h2>{activeBudgetCycles.length === 0 && upcomingBudgetCycles.length > 0 && <span className="health-count">Period scheduled</span>}</div>}
        {currentBudgetCycleEntries.length ? <div className="finance-budget-grid">{currentBudgetCycleEntries.map(({ cycle, progress, foreignExpenseCount }) => {
          return <article className="finance-budget finance-cycle" key={cycle.id}>
            <div className="finance-cycle-top"><h2 id={`budget-tracker-title-${cycle.id}`}>Budget Tracker</h2><FinanceRowActions actions={[{ label: "Edit", onSelect: () => openForm("budget-cycle", cycle.id) }]} /></div>
            <div className="finance-cycle-context"><div className="finance-cycle-date"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.75" y="4.5" width="14.5" height="12.75" rx="1.75" /><path d="M6 2.75v3.5M14 2.75v3.5M3 8h14" /></svg><span>{`${cycle.currency} · ${formatBudgetPeriod(cycle.period_start, cycle.period_end)} · ${budgetCycleDuration(cycle)}-day cycle`}</span></div><div className="finance-cycle-cap"><span>Overall cap</span><strong>{formatMinorUnits(cycle.total_amount_minor, cycle.currency)}</strong></div></div>
            <div className="finance-category-heading"><h3>Category limits</h3><span>{progress.category_limits.length} {progress.category_limits.length === 1 ? "category" : "categories"}</span></div>
            {progress.category_limits.length > 0 ? <div className="finance-category-list">{progress.category_limits.map((limit) => {
              const limitMinor = BigInt(limit.amount_minor);
              const spentMinor = BigInt(limit.spent_minor);
              const remainingMinor = BigInt(limit.remaining_minor);
              const limitPercent = limitMinor > BigInt(0) ? Math.round(Number(spentMinor * BigInt(10000) / limitMinor) / 100) : 0;
              const progressWidth = Math.min(100, limitPercent);
              const balance = remainingMinor < BigInt(0)
                ? `Over by ${formatMinorUnits((BigInt(0) - remainingMinor).toString(), cycle.currency)}`
                : `${formatMinorUnits(limit.remaining_minor, cycle.currency)} left of ${formatMinorUnits(limit.amount_minor, cycle.currency)}`;
              return <div className="finance-category-limit" key={limit.id}><div><strong>{limit.category}</strong><span>{balance}</span><span className="finance-category-percent">{limitPercent}%</span></div><div className="home-progress-track" role="img" aria-label={`${limit.category}: ${limitPercent}% of category limit used`}><span style={{ width: `${progressWidth}%` }} /></div></div>;
            })}</div> : <p className="health-muted">No category limits yet. Edit the budget to add some.</p>}
            {foreignExpenseCount > 0 && <p className="finance-currency-warning">{foreignExpenseCount} expense{foreignExpenseCount === 1 ? "" : "s"} in other currencies aren’t included in this period.</p>}
          </article>;
        })}</div> : upcomingBudgetCycles.length > 0 ? <div className="finance-list">{upcomingBudgetCycles.map((cycle) => <article className="finance-row" key={cycle.id}><div><strong>Starts {formatFinanceDate(cycle.period_start)} · {budgetCycleDuration(cycle)} days</strong><small>{cycle.currency} · through {formatFinanceDate(cycle.period_end)}</small></div><strong>{formatMinorUnits(cycle.total_amount_minor, cycle.currency)}</strong><FinanceRowActions actions={[{ label: "Edit", onSelect: () => openForm("budget-cycle", cycle.id) }]} /></article>)}</div> : <div className="health-empty finance-empty-state"><div><strong>No active budget period.</strong><p>Choose a start date and duration. Ten days is ready as a preset.</p></div><button className="button button-secondary" type="button" onClick={() => openForm("budget-cycle")}>Create budget</button></div>}
        {previousBudgetCycles.length > 0 && <details className="finance-history"><summary>Past budget periods · {previousBudgetCycles.length}</summary><div className="finance-list">{previousBudgetCycles.slice(0, 12).map((cycle) => { const progress = budgetCycleProgress(snapshot, cycle, snapshot.budgetCategoryLimits, cycle.period_end); return <article className="finance-row" key={cycle.id}><div><strong>{formatBudgetPeriod(cycle.period_start, cycle.period_end)}</strong><small>{cycle.currency} · {formatMinorUnits(cycle.total_amount_minor, cycle.currency)} planned</small></div><span>Spent {formatMinorUnits(progress.spent_minor, cycle.currency)}</span><strong>{BigInt(progress.remaining_minor) < BigInt(0) ? `Over ${formatMinorUnits(progress.over_minor, cycle.currency)}` : `Unspent ${formatMinorUnits(progress.remaining_minor, cycle.currency)}`}</strong><FinanceRowActions actions={[{ label: "Edit", onSelect: () => openForm("budget-cycle", cycle.id) }]} /></article>; })}</div></details>}
      </section>

      <section className="health-section" aria-labelledby="transactions-title">
        <div className="health-section-heading"><div><span className="eyebrow">LATEST ACTIVITY</span><h2 id="transactions-title">Transactions</h2></div><div className="health-actions"><button className="text-button" type="button" onClick={() => openForm("transaction")}>Add transaction <span aria-hidden="true">+</span></button><button className="text-button" type="button" onClick={() => openForm("transfer")}>Transfer</button></div></div>
        {recentTransactions.length ? <div className="finance-list">{recentTransactions.slice(0, 2).map((transaction) => <article className="finance-row" key={transaction.id}><div><strong>{transaction.description}</strong><small>{transaction.category} · {formatFinanceDate(transaction.local_date)}</small></div><strong className={transaction.transaction_type === "income" ? "finance-income" : "finance-expense"}>{transaction.transaction_type === "income" ? "+" : "−"}{formatMinorUnits(transaction.amount_minor, transaction.currency)}</strong><FinanceRowActions actions={[{ label: "Edit", onSelect: () => openForm("transaction", transaction.id) }]} /></article>)}</div> : <p className="health-muted">No transactions recorded yet.</p>}
        <button className="text-button" type="button" onClick={() => setTransactionListOpen(true)}>View all transactions <span aria-hidden="true">›</span></button>
        {recentTransfers.length > 0 && <details className="finance-history"><summary>Transfers · {recentTransfers.length}</summary><div className="finance-list">{recentTransfers.map((transfer) => <article className="finance-row" key={transfer.id}><div><strong>{snapshot.accounts.find(({ id }) => id === transfer.from_account_id)?.name ?? "Account"} → {snapshot.accounts.find(({ id }) => id === transfer.to_account_id)?.name ?? "Account"}</strong><small>{formatFinanceDate(transfer.local_date)} · {transfer.source ?? "Same-currency transfer"}</small></div><span>{formatMinorUnits(transfer.from_amount_minor, transfer.from_currency)} → {formatMinorUnits(transfer.to_amount_minor, transfer.to_currency)}</span><button className="text-button" type="button" onClick={() => void archiveTransfer(transfer)}>Void</button></article>)}</div></details>}
      </section>

      <section className="health-section" aria-labelledby="recurring-title">
        <div className="health-section-heading"><div><span className="eyebrow">SCHEDULES · NO AUTO-POSTING</span><h2 id="recurring-title">Recurring charges</h2></div><button className="text-button" type="button" onClick={() => openForm("recurring")}>Add schedule <span aria-hidden="true">+</span></button></div>
        {currentRecurring.length ? <div className="finance-list">{currentRecurring.map((charge) => <article className="finance-row" key={charge.id}><div><strong>{charge.name}</strong><small>{charge.category} · {charge.cadence} · next {formatFinanceDate(charge.next_due_on)}</small></div><strong>{formatMinorUnits(charge.amount_minor, charge.currency)}</strong><FinanceRowActions actions={[{ label: "Edit", onSelect: () => openForm("recurring", charge.id) }, { label: "Stop", onSelect: () => void archiveRecurring(charge), danger: true }]} /></article>)}</div> : <p className="health-muted">No recurring charges scheduled.</p>}
      </section>
      </>}
    </div>}

    {activeTab === "portfolio" && <div id="finance-panel-portfolio" className="finance-tab-content" role="tabpanel" aria-labelledby="finance-tab-portfolio" tabIndex={0}>
      <section className="health-section" aria-labelledby="portfolio-title"><div className="health-section-heading"><div><span className="eyebrow">INVESTMENTS</span><h2 id="portfolio-title">Portfolio</h2></div>{investmentPositions.length > 0 && <button className="text-button" type="button" onClick={() => openForm("position", null, null, "holding")}>Add holding <span aria-hidden="true">+</span></button>}</div>
        {portfolioTotals.size > 0 && <div className="finance-networth-grid">{[...portfolioTotals.entries()].map(([currency, value]) => <article className="finance-networth-item" key={currency}><span>Portfolio value · {currency}</span><strong>{formatMinorUnits(value, currency)}</strong></article>)}</div>}
        {investmentPositions.length ? <div className="finance-list">{investmentPositions.map(renderPositionCard)}</div> : <div className="health-empty finance-empty-state"><div><strong>No holdings yet.</strong><p>Record a quantity and manual valuation to track your investments.</p></div><button className="button button-secondary" type="button" onClick={() => openForm("position", null, null, "holding")}>Add holding</button></div>}
      </section>
      <p className="finance-manual-note">Manual valuations only. Quote source and freshness appear with each holding.</p>
    </div>}

    {activeTab === "accounts" && <div id="finance-panel-accounts" className="finance-tab-content" role="tabpanel" aria-labelledby="finance-tab-accounts" tabIndex={0}>
      {accountDetailOpen && selectedAccount ? <section className="health-section" aria-labelledby="account-detail-title"><div className="health-section-heading"><div><button className="text-button" type="button" onClick={() => setAccountDetailOpen(false)}>‹ Accounts</button><h2 id="account-detail-title">{selectedAccount.name}</h2></div><span className="health-count">{selectedAccount.account_type} · {selectedAccount.currency}</span></div><div className="finance-account-balance"><span>Current balance</span><strong>{formatMinorUnits(financeAccountBalanceAt(selectedAccount, snapshot.transactions, today, snapshot.transfers), selectedAccount.currency)}</strong></div><div className="health-actions"><button className="button button-secondary" type="button" onClick={() => openForm("transaction")}>Add transaction</button><button className="button button-secondary" type="button" onClick={() => openForm("transfer")}>Transfer</button></div><h3>Activity</h3><div className="finance-list">{[...snapshot.transactions.filter(({ active, account_id }) => active && account_id === selectedAccount.id).map((transaction) => ({ id: transaction.id, date: transaction.local_date, title: transaction.description, value: transaction.transaction_type === "income" ? transaction.amount_minor : `-${transaction.amount_minor}`, currency: transaction.currency })), ...snapshot.transfers.filter(({ active, from_account_id, to_account_id }) => active && (from_account_id === selectedAccount.id || to_account_id === selectedAccount.id)).map((transfer) => ({ id: transfer.id, date: transfer.local_date, title: `Transfer ${transfer.from_account_id === selectedAccount.id ? "to" : "from"} ${snapshot.accounts.find(({ id }) => id === (transfer.from_account_id === selectedAccount.id ? transfer.to_account_id : transfer.from_account_id))?.name ?? "account"}`, value: transfer.from_account_id === selectedAccount.id ? `-${transfer.from_amount_minor}` : transfer.to_amount_minor, currency: transfer.from_account_id === selectedAccount.id ? transfer.from_currency : transfer.to_currency }))].sort((a, b) => b.date.localeCompare(a.date)).map((activity) => <article className="finance-row" key={activity.id}><div><strong>{activity.title}</strong><small>{formatFinanceDate(activity.date)}</small></div><strong>{formatMinorUnits(activity.value, activity.currency)}</strong></article>)}</div></section> : <>
        <section className="health-section finance-snapshot" aria-labelledby="net-worth-title">
          <div className="health-section-heading"><div><span className="eyebrow">NET WORTH</span><h2 id="net-worth-title">Balance sheet</h2></div><a className="text-button" href="#net-worth-history">History <span aria-hidden="true">›</span></a></div>
          {netWorth.length ? <div className="finance-networth-grid">{netWorth.map(({ currency, amount_minor }) => {
            const breakdown = composition.find((item) => item.currency === currency);
            return <article className="finance-networth-card" key={currency}>
              <div className="finance-networth-total"><span>As of {formatFinanceDate(today)} · {currency}</span><strong>{formatMinorUnits(amount_minor, currency)}</strong></div>
              {breakdown && <div className="finance-composition"><div><span>Assets</span><b>{formatMinorUnits(breakdown.assets_minor, currency)}</b></div><div><span>Debts</span><b>{formatMinorUnits(breakdown.debts_minor, currency)}</b></div></div>}
            </article>;
          })}</div> : <div className="health-empty finance-empty-state"><div><strong>Add an account to see net worth.</strong><p>Totals stay grouped by currency.</p></div><button className="button button-secondary" type="button" onClick={() => openForm("account")}>Add account</button></div>}
        </section>
        <section className="health-section" aria-labelledby="accounts-title"><div className="health-section-heading"><div><span className="eyebrow">CASH, BANK & CREDIT</span><h2 id="accounts-title">Accounts</h2></div><button className="text-button" type="button" onClick={() => openForm("account")}>Add account <span aria-hidden="true">+</span></button></div>
          {accounts.length ? <div className="finance-list">{accounts.map((account) => <article className="finance-row finance-account-row" key={account.id}><button type="button" className="finance-account-open" onClick={() => { setSelectedAccountId(account.id); setAccountDetailOpen(true); }}><span><strong>{account.name}</strong><small>{accountTypeLabel(account.account_type)} · {account.currency}</small></span><b>{formatMinorUnits(financeAccountBalanceAt(account, snapshot.transactions, today, snapshot.transfers), account.currency)}</b></button><FinanceRowActions actions={[{ label: "Edit", onSelect: () => openForm("account", account.id) }, { label: "Close", onSelect: () => { setCloseAccountError(""); setAccountToClose(account); }, danger: true }]} /></article>)}</div> : <div className="health-empty finance-empty-state"><div><strong>No accounts yet.</strong><p>Add cash, bank, credit, or brokerage cash accounts.</p></div><button className="button button-secondary" type="button" onClick={() => openForm("account")}>Add account</button></div>}
        </section>
        <section className="health-section" aria-labelledby="assets-debts-title"><div className="health-section-heading"><div><span className="eyebrow">MANUAL VALUES</span><h2 id="assets-debts-title">Assets & debts</h2></div><div className="health-actions"><button className="text-button" type="button" onClick={() => openForm("position", null, null, "asset")}>Add asset</button><button className="text-button" type="button" onClick={() => openForm("position", null, null, "debt")}>Add debt</button></div></div>
          {assetAndDebtPositions.length ? <div className="finance-list">{assetAndDebtPositions.map(renderPositionCard)}</div> : <p className="health-muted">Track items such as a home, car, or loan with dated manual values.</p>}
        </section>
        <section id="net-worth-history" className="health-section" aria-labelledby="worth-history-title"><div className="health-section-heading"><div><span className="eyebrow">RECONSTRUCTED FROM DATED RECORDS</span><h2 id="worth-history-title">Net-worth history</h2></div><span className="health-count">{history.length} dated points</span></div>{history.length ? <div className="finance-list">{history.slice().reverse().map((point) => <article className="finance-row" key={point.date}><strong>{formatFinanceDate(point.date)}</strong><span>{point.totals.map(({ currency, amount_minor }) => `${formatMinorUnits(amount_minor, currency)}`).join(" · ") || "No valued positions"}</span></article>)}</div> : <p className="health-muted">Net-worth history appears after you add dated account activity or valuations.</p>}</section>
      </>}
    </div>}

    {form === "account" && <AccountForm account={editingAccount} today={today} currencies={currencyCodes} error={error} onClose={closeForm} onSubmit={submitAccount} />}
    {form === "transaction" && <TransactionForm transaction={editingTransaction} accounts={accounts} transactions={snapshot.transactions} budgetCategoryLimits={snapshot.budgetCategoryLimits} today={today} error={error} defaultAccountId={selectedAccountId} onClose={closeForm} onSubmit={submitTransaction} />}
    {form === "budget-cycle" && <BudgetCycleForm key={editingBudgetCycle?.id ?? "new-budget"} cycle={editingBudgetCycle} cycleLimits={editingBudgetLimits} today={today} currencies={currencyCodes} error={error} previousCycle={!editingBudgetCycle ? previousBudgetCycles[0] ?? null : null} previousLimits={!editingBudgetCycle && previousBudgetCycles[0] ? snapshot.budgetCategoryLimits.filter(({ cycle_id }) => cycle_id === previousBudgetCycles[0].id) : []} onClose={closeForm} onSubmit={submitBudgetCycle} />}
    {form === "recurring" && <RecurringForm charge={editingRecurring} accounts={accounts} today={today} currencies={currencyCodes} error={error} onClose={closeForm} onSubmit={submitRecurring} />}
    {form === "position" && <PositionForm position={editingPosition} accounts={accounts} today={today} currencies={currencyCodes} error={error} initialKind={newPositionType} onClose={closeForm} onSubmit={submitPosition} />}
    {form === "valuation" && valuationPosition && <ValuationForm key={`${valuationPosition.id}:${editingValuation?.id ?? "new"}`} position={valuationPosition} valuation={editingValuation} today={today} timezone={profile.timezone} error={error} onClose={closeForm} onSubmit={submitValuation} />}
    {form === "fx" && <FxRateForm rate={editingRate} currencies={currencyCodes} timezone={profile.timezone} error={error} onClose={closeForm} onSubmit={submitRate} />}
    {form === "conversion" && <ConversionForm currencies={currencyCodes} rates={snapshot.fxRates} today={today} timezone={profile.timezone} error={error} onClose={closeForm} onSubmit={submitConversion} />}
    {form === "transfer" && <TransferForm accounts={accounts} rates={snapshot.fxRates} today={today} timezone={profile.timezone} error={error} defaultFromAccountId={selectedAccountId} onClose={closeForm} onSubmit={submitTransfer} />}
    {accountToClose && <HealthSheet title="Close account?" eyebrow="ACCOUNT" error={closeAccountError} onClose={() => { if (closingAccount) return; setAccountToClose(null); setCloseAccountError(""); }}>
      <p className="finance-confirmation-copy"><strong>{accountToClose.name}</strong> will be removed from active accounts and unavailable for new transactions. Its existing transaction history will remain in Finance.</p>
      <div className="finance-confirmation-actions"><button className="button button-secondary" type="button" disabled={closingAccount} onClick={() => setAccountToClose(null)}>Keep account</button><button className="button button-danger" type="button" disabled={closingAccount} onClick={() => void confirmAccountClose()}>{closingAccount ? "Closing…" : "Close account"}</button></div>
    </HealthSheet>}
  </div>;
}

function AccountForm({ account, today, currencies, error, onClose, onSubmit }: { account: FinanceAccount | null; today: string; currencies: string[]; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  const currency = account?.currency ?? "PHP";
  const [accountType, setAccountType] = useState<FinanceAccount["account_type"]>(account?.account_type ?? "checking");
  return <FinanceSheet title={account ? "Edit account" : "Add account"} error={error} onClose={onClose} onSubmit={onSubmit}>
    <label className="field-label" htmlFor="account-name">Account name<input id="account-name" name="account-name" defaultValue={account?.name ?? ""} required /></label>
    <label className="field-label" htmlFor="account-type">Type<select id="account-type" name="account-type" value={accountType} disabled={Boolean(account)} onChange={(event) => setAccountType(event.target.value as FinanceAccount["account_type"])}><option value="cash">Cash</option><option value="checking">Checking account</option><option value="savings">Savings account</option><option value="credit">Credit card</option><option value="investment">Brokerage account</option><option value="other">Other</option></select></label>
    <label className="field-label" htmlFor="account-currency">Currency<select id="account-currency" name="currency" defaultValue={currency} disabled={Boolean(account)}>{currencies.map((code) => <option key={code}>{code}</option>)}</select></label>
    <label className="field-label" htmlFor="opening-balance">{accountType === "investment" ? "Opening brokerage cash" : accountType === "credit" ? "Opening amount owed" : "Opening balance"}<input id="opening-balance" name="opening-balance" inputMode="decimal" placeholder="0.00" defaultValue={account ? minorUnitsInput(account.opening_balance_minor, currency) : ""} required /></label>
    <label className="field-label" htmlFor="opened-on">Opened on<input id="opened-on" name="opened-on" type="date" defaultValue={account?.opened_on ?? today} required /></label>
    <button className="button button-primary" type="submit">{account ? "Save account" : "Create account"}</button>
  </FinanceSheet>;
}

function TransactionForm({ transaction, accounts, transactions, budgetCategoryLimits, today, error, defaultAccountId, onClose, onSubmit }: { transaction: FinanceTransaction | null; accounts: FinanceAccount[]; transactions: FinanceTransaction[]; budgetCategoryLimits: FinanceBudgetCategoryLimit[]; today: string; error: string; defaultAccountId: string | null; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> }) {
  const initialType = transaction?.transaction_type ?? "expense";
  const expenseCategories = [...new Set([...financeCategories, ...budgetCategoryLimits.map(({ category }) => category), ...transactions.filter(({ transaction_type }) => transaction_type === "expense").map(({ category }) => category)])];
  const incomeCategories = [...new Set([...financeIncomeCategories, ...transactions.filter(({ transaction_type }) => transaction_type === "income").map(({ category }) => category)])];
  const categoriesFor = (type: FinanceTransaction["transaction_type"]) => type === "expense" ? expenseCategories : incomeCategories;
  const initialCategory = transaction?.category ?? "";
  const initialIsCustom = Boolean(initialCategory && !categoriesFor(initialType).includes(initialCategory));
  const [transactionType, setTransactionType] = useState<FinanceTransaction["transaction_type"]>(initialType);
  const [categorySelection, setCategorySelection] = useState(initialIsCustom ? customCategoryOption : initialCategory);
  const [customCategory, setCustomCategory] = useState(initialIsCustom ? initialCategory : "");
  const [saving, setSaving] = useState(false);
  const compatibleAccounts = transaction ? accounts.filter(({ currency }) => currency === transaction.currency) : accounts;
  const categoryOptions = categoriesFor(transactionType);
  async function submit(event: FormEvent<HTMLFormElement>) {
    setSaving(true);
    try { await onSubmit(event); }
    finally { setSaving(false); }
  }
  return <FinanceSheet title={transaction ? "Edit transaction" : "Add transaction"} error={error} onClose={onClose} onSubmit={submit}>
    {compatibleAccounts.length ? <label className="field-label" htmlFor="account-id">Account<select id="account-id" name="account-id" defaultValue={transaction?.account_id ?? (compatibleAccounts.some(({ id }) => id === defaultAccountId) ? defaultAccountId! : compatibleAccounts[0]?.id)}>{compatibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label> : <div className="health-banner">Create an account before recording transactions.</div>}
    <label className="field-label" htmlFor="transaction-type">Type<select id="transaction-type" name="transaction-type" value={transactionType} onChange={(event) => { const nextType = event.target.value as FinanceTransaction["transaction_type"]; setTransactionType(nextType); if (categorySelection !== customCategoryOption && !categoriesFor(nextType).includes(categorySelection)) setCategorySelection(""); }}><option value="expense">Expense</option><option value="income">Income</option></select></label>
    <label className="field-label" htmlFor="transaction-amount">Amount<input id="transaction-amount" name="transaction-amount" inputMode="decimal" placeholder="0.00" defaultValue={transaction ? minorUnitsInput(transaction.amount_minor, transaction.currency) : ""} required /></label>
    <label className="field-label" htmlFor="transaction-category">Category<select id="transaction-category" name="transaction-category" value={categorySelection} onChange={(event) => setCategorySelection(event.target.value)} required><option value="" disabled>Select a category</option>{categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}<option value={customCategoryOption}>Add a custom category…</option></select></label>
    {categorySelection === customCategoryOption && <label className="field-label" htmlFor="transaction-custom-category">Custom category<input id="transaction-custom-category" name="transaction-custom-category" value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} placeholder="Enter a category" required /></label>}
    <label className="field-label" htmlFor="transaction-description">Description<input id="transaction-description" name="transaction-description" defaultValue={transaction?.description ?? ""} required /></label>
    <label className="field-label" htmlFor="transaction-date">Date<input id="transaction-date" name="transaction-date" type="date" defaultValue={transaction?.local_date ?? today} required /></label>
    <label className="field-label" htmlFor="transaction-notes">Notes <span className="optional-label">Optional</span><textarea id="transaction-notes" name="transaction-notes" defaultValue={transaction?.notes ?? ""} /></label>
    <button className="button button-primary" type="submit" disabled={!compatibleAccounts.length || saving} aria-busy={saving}>{saving ? "Saving…" : transaction ? "Save transaction" : "Record transaction"}</button>
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

function PositionForm({ position, accounts, today, currencies, error, initialKind, onClose, onSubmit }: { position: FinancePosition | null; accounts: FinanceAccount[]; today: string; currencies: string[]; error: string; initialKind: FinancePosition["position_type"]; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  const [kind, setKind] = useState<FinancePosition["position_type"]>(position?.position_type ?? initialKind);
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

function BudgetCycleForm({ cycle, cycleLimits, today, currencies, error, previousCycle, previousLimits, onClose, onSubmit }: {
  cycle: FinanceBudgetCycle | null;
  cycleLimits: FinanceBudgetCategoryLimit[];
  today: string;
  currencies: string[];
  error: string;
  previousCycle: FinanceBudgetCycle | null;
  previousLimits: FinanceBudgetCategoryLimit[];
  onClose(): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}) {
  const [currency, setCurrency] = useState(cycle?.currency ?? previousCycle?.currency ?? "PHP");
  const [start, setStart] = useState(cycle?.period_start ?? today);
  const [duration, setDuration] = useState(cycle ? String(budgetCycleDuration(cycle)) : "10");
  const [total, setTotal] = useState(cycle ? minorUnitsInput(cycle.total_amount_minor, cycle.currency) : "");
  const [limits, setLimits] = useState<Array<{ category: string; amount: string; id?: string; revision?: number }>>(cycle
    ? cycleLimits.map((limit) => ({ id: limit.id, revision: limit.revision, category: limit.category, amount: minorUnitsInput(limit.amount_minor, cycle.currency) }))
    : []);
  const [copyPrevious, setCopyPrevious] = useState(false);

  function copyPreviousCycle(checked: boolean) {
    setCopyPrevious(checked);
    if (!checked || !previousCycle) {
      setLimits([]);
      setTotal("");
      return;
    }
    setCurrency(previousCycle.currency);
    setTotal(minorUnitsInput(previousCycle.total_amount_minor, previousCycle.currency));
    setLimits(previousLimits.map((limit) => ({ category: limit.category, amount: minorUnitsInput(limit.amount_minor, previousCycle.currency) })));
  }

  let end = "";
  try { if (start && duration) end = budgetCycleEnd(start, Number(duration)); } catch { end = ""; }

  return <FinanceSheet title={cycle ? "Edit budget period" : "Start a budget period"} error={error} onClose={onClose} onSubmit={onSubmit}>
    {previousCycle && <label className="check-option"><input type="checkbox" checked={copyPrevious} onChange={(event) => copyPreviousCycle(event.target.checked)} /><span>Reuse the last period’s limits</span></label>}
    <label className="field-label" htmlFor="cycle-currency">Budget currency<select id="cycle-currency" name="cycle-currency" value={currency} disabled={Boolean(cycle)} onChange={(event) => { setCurrency(event.target.value); if (copyPrevious) copyPreviousCycle(false); }}>{[...new Set([...currencies, currency])].sort().map((code) => <option key={code}>{code}</option>)}</select></label>
    <div className="finance-form-grid"><label className="field-label" htmlFor="cycle-start">Starts<input id="cycle-start" name="cycle-start" type="date" value={start} onChange={(event) => setStart(event.target.value)} required /></label><label className="field-label" htmlFor="cycle-duration">Duration in days<input id="cycle-duration" name="cycle-duration" type="number" min="1" max="366" value={duration} onChange={(event) => setDuration(event.target.value)} required /></label></div>
    {end && <p className="health-muted">This period runs {start} through {end} ({duration} days). It closes automatically; unused funds stay in history.</p>}
    <label className="field-label" htmlFor="cycle-total">Overall spending cap ({currency})<input id="cycle-total" name="cycle-total" inputMode="decimal" value={total} onChange={(event) => setTotal(event.target.value)} placeholder="0.00" required /></label>
    <div className="health-section-heading finance-subheading"><h3>Optional category limits</h3><button className="text-button" type="button" onClick={() => setLimits((current) => [...current, { category: "", amount: "" }])}>Add category <span aria-hidden="true">+</span></button></div>
    {limits.map((limit, index) => <div className="finance-limit-editor" key={limit.id ?? index}><label className="field-label" htmlFor={`cycle-limit-category-${index}`}>Category<input id={`cycle-limit-category-${index}`} name="limit-category" list="finance-category-options" value={limit.category} readOnly={Boolean(limit.id)} onChange={(event) => setLimits((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, category: event.target.value } : row))} placeholder="Food, transport…" /></label><label className="field-label" htmlFor={`cycle-limit-amount-${index}`}>Limit ({currency})<input id={`cycle-limit-amount-${index}`} name="limit-amount" inputMode="decimal" value={limit.amount} onChange={(event) => setLimits((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, amount: event.target.value } : row))} placeholder="0.00" /></label>{limit.id ? <span className="finance-limit-locked" title="Existing category names are fixed to preserve the budget record">Saved</span> : <button className="icon-button" type="button" aria-label={`Remove ${limit.category || "category"} limit`} onClick={() => setLimits((current) => current.filter((_, rowIndex) => rowIndex !== index))}>×</button>}<input type="hidden" name="limit-id" value={limit.id ?? ""} /><input type="hidden" name="limit-revision" value={limit.revision ?? 0} /></div>)}
    <datalist id="finance-category-options">{financeCategories.map((category) => <option key={category} value={category} />)}</datalist>
    <button className="button button-primary" type="submit">{cycle ? "Save budget" : "Start budget period"}</button>
  </FinanceSheet>;
}

function TransferForm({ accounts, rates, today, timezone, error, defaultFromAccountId, onClose, onSubmit }: {
  accounts: FinanceAccount[];
  rates: FinanceFxRate[];
  today: string;
  timezone: string;
  error: string;
  defaultFromAccountId: string | null;
  onClose(): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}) {
  const initialFrom = accounts.some(({ id }) => id === defaultFromAccountId) ? defaultFromAccountId! : accounts[0]?.id ?? "";
  const [fromId, setFromId] = useState(initialFrom);
  const [toId, setToId] = useState(accounts.find(({ id }) => id !== initialFrom)?.id ?? "");
  const [amount, setAmount] = useState("");
  const [rateId, setRateId] = useState("");
  const from = accounts.find(({ id }) => id === fromId);
  const to = accounts.find(({ id }) => id === toId);
  const requiresFx = Boolean(from && to && from.currency !== to.currency);
  const availableRates = requiresFx ? rates.filter(({ base_currency, quote_currency, rate, freshness }) => base_currency === from!.currency && quote_currency === to!.currency && rate !== null && freshness !== "unavailable") : [];
  const savedRate = availableRates.find(({ id }) => id === rateId) ?? null;
  const rate = savedRate?.rate ?? (requiresFx ? "" : null);
  let destinationAmount: string | null = null;
  try {
    const fromMinor = from ? parseMinorUnits(amount, from.currency) : null;
    if (fromMinor && to && from) destinationAmount = requiresFx ? (rate ? convertMinorUnits(fromMinor, from.currency, to.currency, rate) : null) : fromMinor;
  } catch { destinationAmount = null; }
  const dateTime = isoToLocalDateTimeParts(new Date().toISOString(), timezone);

  return <FinanceSheet title="Transfer between accounts" error={error} onClose={onClose} onSubmit={onSubmit}>
    {accounts.length < 2 ? <div className="health-empty"><p>Add two accounts before recording a transfer.</p></div> : <>
      <label className="field-label" htmlFor="transfer-from">From account<select id="transfer-from" name="transfer-from" value={fromId} onChange={(event) => { setFromId(event.target.value); if (event.target.value === toId) setToId(accounts.find(({ id }) => id !== event.target.value)?.id ?? ""); setRateId(""); }}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label>
      <label className="field-label" htmlFor="transfer-to">To account<select id="transfer-to" name="transfer-to" value={toId} onChange={(event) => { setToId(event.target.value); setRateId(""); }}>{accounts.filter(({ id }) => id !== fromId).map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label>
      <label className="field-label" htmlFor="transfer-amount">Amount ({from?.currency ?? "—"})<input id="transfer-amount" name="transfer-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label>
      {requiresFx && <><label className="field-label" htmlFor="transfer-rate-id">Saved FX rate<select id="transfer-rate-id" name="transfer-rate-id" value={savedRate?.id ?? ""} onChange={(event) => setRateId(event.target.value)}><option value="">Enter a rate manually</option>{availableRates.map((item) => <option key={item.id} value={item.id}>{item.rate} · {item.source} · {resolveFreshness(item.freshness, item.as_of)} · {formatFinanceTimestamp(item.as_of, timezone)}</option>)}</select></label>{!savedRate && <><label className="field-label" htmlFor="transfer-rate">Rate<input id="transfer-rate" name="transfer-rate" inputMode="decimal" placeholder="0.00" required /></label><label className="field-label" htmlFor="transfer-source">Rate source<input id="transfer-source" name="transfer-source" defaultValue="manual" required /></label><label className="field-label" htmlFor="transfer-as-of">Rate as of<input id="transfer-as-of" name="transfer-as-of" type="datetime-local" defaultValue={`${dateTime.date}T${dateTime.time}`} required /></label></>}</>}
      <label className="field-label" htmlFor="transfer-date">Date<input id="transfer-date" name="transfer-date" type="date" defaultValue={today} required /></label>
      <label className="field-label" htmlFor="transfer-notes">Note <span className="optional-label">Optional</span><input id="transfer-notes" name="transfer-notes" /></label>
      <p className="health-banner">{destinationAmount && to ? `Destination amount: ${formatMinorUnits(destinationAmount, to.currency)}. Transfers do not count as income or spending.` : "Transfers do not count as income or spending."}</p>
      <button className="button button-primary" type="submit" disabled={!destinationAmount}>Record transfer</button>
    </>}
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
    <label className="field-label" htmlFor="conversion-rate-id">Saved rate <span className="optional-label">Optional</span><select id="conversion-rate-id" name="conversion-rate-id" value={chosen?.id ?? ""} onChange={(event) => setRateId(event.target.value)}><option value="">Enter a rate manually</option>{availableRates.filter(({ base_currency, quote_currency }) => base_currency === from && quote_currency === to).map((item) => <option key={item.id} value={item.id}>{item.source} · {item.rate} · {formatFinanceTimestamp(item.as_of, timezone)}</option>)}</select></label>
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

interface FinanceAction {
  label: string;
  onSelect(): void;
  danger?: boolean;
}

function FinanceRowActions({ actions }: { actions: FinanceAction[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstOptionRef.current?.focus();
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (actions.length === 1) {
    const action = actions[0];
    return <button className="icon-button finance-row-icon" type="button" aria-label={action.label} title={action.label} onClick={action.onSelect}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.8 3.2 4 4M3.5 16.5l3.7-.8L16 6.9a1.8 1.8 0 0 0-2.9-2.1l-8.7 8.8-.9 2.9Z" /></svg>
    </button>;
  }

  return <div className="finance-action-menu" ref={rootRef}>
    <button ref={triggerRef} className="icon-button finance-row-icon" type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.25" /><circle cx="10" cy="10" r="1.25" /><circle cx="16" cy="10" r="1.25" /></svg>
    </button>
    {open && <div className="finance-action-menu-panel" role="menu">{actions.map((action, index) => <button ref={index === 0 ? firstOptionRef : undefined} className={action.danger ? "finance-action-option is-danger" : "finance-action-option"} type="button" role="menuitem" key={action.label} onClick={() => { setOpen(false); action.onSelect(); }}>{action.label}</button>)}</div>}
  </div>;
}

function text(data: FormData, key: string): string { return String(data.get(key) ?? "").trim(); }
function optionalText(data: FormData, key: string): string | null { return text(data, key) || null; }
function parseMoney(input: string, currency: string): string | null { try { return parseMinorUnits(input, currency); } catch { return null; } }
function isPositiveMinor(value: string | null): value is string { return value !== null && BigInt(value) > BigInt(0); }
function formatFinanceDate(value: string, timezone?: string): string {
  const datePart = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return value;
  const hasTime = value.length > 10 && value[10] === "T";
  if (hasTime && timezone) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: timezone }).format(new Date(value));
  }
  const [year, month, day] = datePart.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
}
function formatFinanceTimestamp(value: string, timezone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", ...(timezone ? { timeZone: timezone } : {}) }).format(date);
}
function formatBudgetPeriod(start: string, end: string): string {
  return `${formatFinanceDate(start)} – ${formatFinanceDate(end)}`;
}
function validQuantity(quantity: string | null): boolean { return Boolean(quantity && Number.isFinite(Number(quantity)) && Number(quantity) > 0 && Number(quantity) < 1e16); }
function validRate(rate: string): boolean { return /^(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/.test(rate) && /[1-9]/.test(rate); }
function message(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback; }
function splitLocalDateTime(value: string): [string, string] { const [date, time] = value.split("T"); return [date ?? "", time ?? ""]; }
function accountTypeLabel(type: FinanceAccount["account_type"]): string {
  return ({ cash: "Cash", checking: "Checking", savings: "Savings", credit: "Credit", investment: "Brokerage", other: "Other" })[type];
}
