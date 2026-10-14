import type { FinanceBudgetCategoryLimit, FinanceBudgetCycle, FinanceSnapshot } from "./types";

export interface BudgetCategoryProgress extends FinanceBudgetCategoryLimit {
  spent_minor: string;
  remaining_minor: string;
}

export interface BudgetCycleProgress {
  spent_minor: string;
  remaining_minor: string;
  over_minor: string;
  days_remaining: number;
  category_limits: BudgetCategoryProgress[];
}

export function budgetCycleEnd(start: string, durationDays: number): string {
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 366) throw new Error("Budget periods must be between 1 and 366 days");
  const date = parseLocalDate(start);
  date.setUTCDate(date.getUTCDate() + durationDays - 1);
  return date.toISOString().slice(0, 10);
}

export function budgetCycleDuration(cycle: Pick<FinanceBudgetCycle, "period_start" | "period_end">): number {
  const start = parseLocalDate(cycle.period_start).getTime();
  const end = parseLocalDate(cycle.period_end).getTime();
  const days = Math.floor((end - start) / 86_400_000) + 1;
  if (days < 1 || days > 366) throw new Error("Budget period dates are invalid");
  return days;
}

export function currentBudgetCycle(cycles: FinanceBudgetCycle[], today: string): FinanceBudgetCycle | null {
  return cycles.filter(({ period_start, period_end }) => period_start <= today && period_end >= today)
    .sort((left, right) => right.period_start.localeCompare(left.period_start))[0] ?? null;
}

export function budgetCycleProgress(
  snapshot: FinanceSnapshot,
  cycle: FinanceBudgetCycle,
  limits: FinanceBudgetCategoryLimit[],
  throughDate: string,
): BudgetCycleProgress {
  const endDate = throughDate < cycle.period_end ? throughDate : cycle.period_end;
  const periodTransactions = snapshot.transactions.filter((transaction) => transaction.active
    && transaction.transaction_type === "expense"
    && transaction.currency === cycle.currency
    && transaction.local_date >= cycle.period_start
    && transaction.local_date <= endDate);
  const totalSpent = periodTransactions.reduce((sum, transaction) => sum + BigInt(transaction.amount_minor), BigInt(0));
  const totalCap = BigInt(cycle.total_amount_minor);
  const categoryLimits = limits.filter(({ cycle_id }) => cycle_id === cycle.id).map((limit) => {
    const spent = periodTransactions.filter(({ category }) => category.toLocaleLowerCase() === limit.category.toLocaleLowerCase())
      .reduce((sum, transaction) => sum + BigInt(transaction.amount_minor), BigInt(0));
    const cap = BigInt(limit.amount_minor);
    return {
      ...limit,
      spent_minor: spent.toString(),
      remaining_minor: (cap - spent).toString(),
    };
  });
  const daysRemaining = cycle.period_end < throughDate
    ? 0
    : Math.max(0, Math.floor((parseLocalDate(cycle.period_end).getTime() - parseLocalDate(throughDate).getTime()) / 86_400_000));

  return {
    spent_minor: totalSpent.toString(),
    remaining_minor: (totalCap - totalSpent).toString(),
    over_minor: (totalSpent > totalCap ? totalSpent - totalCap : BigInt(0)).toString(),
    days_remaining: daysRemaining,
    category_limits: categoryLimits,
  };
}

export function expensesOutsideBudgetCurrency(snapshot: FinanceSnapshot, cycle: FinanceBudgetCycle, throughDate: string): number {
  return snapshot.transactions.filter((transaction) => transaction.active
    && transaction.transaction_type === "expense"
    && transaction.currency !== cycle.currency
    && transaction.local_date >= cycle.period_start
    && transaction.local_date <= throughDate).length;
}

function parseLocalDate(value: string): Date {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Use a valid local calendar date");
  }
  return date;
}
