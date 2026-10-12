import type { ExchangeRateProvider, ProviderResult, Quote, QuoteProvider } from "@/lib/providers/contracts";
import type { FinanceFreshness, FinanceSnapshot } from "./types";

export interface FinanceCurrencyTotal {
  currency: string;
  amount_minor: string;
}

export interface NetWorthPoint {
  date: string;
  totals: FinanceCurrencyTotal[];
}

export function financeAccountBalanceAt(
  account: FinanceSnapshot["accounts"][number],
  transactions: FinanceSnapshot["transactions"],
  date: string,
): string {
  let balance = BigInt(account.opening_balance_minor);
  for (const transaction of transactions) {
    if (!transaction.active || transaction.account_id !== account.id || transaction.local_date > date) continue;
    const amount = BigInt(transaction.amount_minor);
    const isCredit = account.account_type === "credit";
    balance += transaction.transaction_type === "income"
      ? (isCredit ? -amount : amount)
      : (isCredit ? amount : -amount);
  }
  return balance.toString();
}

export interface ValuationAdapter extends QuoteProvider, ExchangeRateProvider {}

export function createValuationAdapter(
  quoteProvider?: QuoteProvider,
  exchangeRateProvider?: ExchangeRateProvider,
  now: () => Date = () => new Date(),
): ValuationAdapter {
  return {
    async getQuotes(symbols) {
      if (!quoteProvider) return unavailableResult<Quote[]>(now(), "No live quote provider is configured. Manual valuations remain available.");
      try { return await quoteProvider.getQuotes(symbols); }
      catch (error) { return unavailableResult<Quote[]>(now(), errorMessage(error, "Quote provider failed.")); }
    },
    async getRates(base, quotes) {
      if (!exchangeRateProvider) return unavailableResult(now(), "No live FX provider is configured. Manual rates remain available.");
      try { return await exchangeRateProvider.getRates(base, quotes); }
      catch (error) { return unavailableResult(now(), errorMessage(error, "FX provider failed.")); }
    },
  };
}

export function resolveFreshness(status: FinanceFreshness, asOf: string, nowMs = Date.now(), staleAfterMs = 24 * 60 * 60 * 1000): FinanceFreshness {
  if (status === "unavailable") return status;
  const timestamp = Date.parse(asOf);
  if (!Number.isFinite(timestamp) || timestamp > nowMs || nowMs - timestamp > staleAfterMs) return "stale";
  return status;
}

export function netWorthAt(snapshot: FinanceSnapshot, date: string): FinanceCurrencyTotal[] {
  const totals = new Map<string, bigint>();
  const add = (currency: string, amount: bigint) => totals.set(currency, (totals.get(currency) ?? BigInt(0)) + amount);
  const activeAccounts = new Set(snapshot.accounts.filter(({ opened_on, closed_on, active }) =>
    opened_on <= date && (!closed_on || closed_on > date) && (active || (closed_on !== null && closed_on > date)),
  ).map(({ id }) => id));

  for (const account of snapshot.accounts) {
    if (!activeAccounts.has(account.id)) continue;
    const balance = BigInt(financeAccountBalanceAt(account, snapshot.transactions, date));
    add(account.currency, account.account_type === "credit" ? -balance : balance);
  }

  const activePositions = snapshot.positions.filter(({ opened_on, closed_on, active }) =>
    opened_on <= date && (!closed_on || closed_on > date) && (active || (closed_on !== null && closed_on > date)),
  );
  for (const position of activePositions) {
    const latest = snapshot.valuations
      .filter(({ position_id, local_date }) => position_id === position.id && local_date <= date)
      .sort((left, right) => right.local_date.localeCompare(left.local_date) || right.as_of.localeCompare(left.as_of))[0];
    if (!latest || latest.value_minor === null) continue;
    const value = BigInt(latest.value_minor);
    add(position.currency, position.position_type === "debt" ? -value : value);
  }

  return [...totals.entries()]
    .filter(([, amount]) => amount !== BigInt(0))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount_minor]) => ({ currency, amount_minor: amount_minor.toString() }));
}

export function buildNetWorthHistory(snapshot: FinanceSnapshot, throughDate: string): NetWorthPoint[] {
  const dates = new Set<string>();
  for (const account of snapshot.accounts) {
    if (account.opened_on <= throughDate) dates.add(account.opened_on);
    if (account.closed_on && account.closed_on <= throughDate) dates.add(account.closed_on);
  }
  for (const position of snapshot.positions) {
    if (position.opened_on <= throughDate) dates.add(position.opened_on);
    if (position.closed_on && position.closed_on <= throughDate) dates.add(position.closed_on);
  }
  for (const transaction of snapshot.transactions) if (transaction.active && transaction.local_date <= throughDate) dates.add(transaction.local_date);
  for (const valuation of snapshot.valuations) if (valuation.local_date <= throughDate) dates.add(valuation.local_date);
  return [...dates].sort().map((date) => ({ date, totals: netWorthAt(snapshot, date) }));
}

function unavailableResult<T>(now: Date, reason: string): ProviderResult<T> {
  return { values: [], source: "unavailable", asOf: now.toISOString(), status: "unavailable", reason };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
