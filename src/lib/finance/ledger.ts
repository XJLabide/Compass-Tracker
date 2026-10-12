import type { FinanceBudget, FinanceSnapshot } from "./types";

export interface FinancePeriodFlow {
  currency: string;
  income_minor: string;
  expense_minor: string;
  net_minor: string;
}

export function monthlyFinanceFlow(snapshot: FinanceSnapshot, periodStart: string, throughDate: string): FinancePeriodFlow[] {
  const values = new Map<string, { income: bigint; expense: bigint }>();
  for (const transaction of snapshot.transactions) {
    if (!transaction.active || transaction.local_date < periodStart || transaction.local_date > throughDate) continue;
    const totals = values.get(transaction.currency) ?? { income: BigInt(0), expense: BigInt(0) };
    if (transaction.transaction_type === "income") totals.income += BigInt(transaction.amount_minor);
    else totals.expense += BigInt(transaction.amount_minor);
    values.set(transaction.currency, totals);
  }
  return [...values.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([currency, { income, expense }]) => ({
    currency, income_minor: income.toString(), expense_minor: expense.toString(), net_minor: (income - expense).toString(),
  }));
}

export function budgetSpent(snapshot: FinanceSnapshot, budget: FinanceBudget, throughDate: string): string {
  return snapshot.transactions.filter((transaction) => transaction.active
    && transaction.transaction_type === "expense"
    && transaction.category.toLowerCase() === budget.category.toLowerCase()
    && transaction.currency === budget.currency
    && transaction.local_date >= budget.period_start
    && transaction.local_date <= throughDate,
  ).reduce((total, transaction) => total + BigInt(transaction.amount_minor), BigInt(0)).toString();
}

export function latestPositionValuation(snapshot: FinanceSnapshot, positionId: string, throughDate: string) {
  return snapshot.valuations.filter(({ position_id, local_date }) => position_id === positionId && local_date <= throughDate)
    .sort((left, right) => right.local_date.localeCompare(left.local_date) || right.as_of.localeCompare(left.as_of))[0] ?? null;
}
