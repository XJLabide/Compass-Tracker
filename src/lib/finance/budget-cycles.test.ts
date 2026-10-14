import { describe, expect, it } from "vitest";
import { budgetCycleDuration, budgetCycleEnd, budgetCycleProgress, currentBudgetCycle, expensesOutsideBudgetCurrency } from "./budget-cycles";
import { emptyFinanceSnapshot, type FinanceBudgetCycle } from "./types";

const cycle: FinanceBudgetCycle = {
  id: "cycle", currency: "PHP", period_start: "2026-10-14", period_end: "2026-10-23", total_amount_minor: "100000", revision: 1,
};

describe("flexible finance budget cycles", () => {
  it("uses inclusive local dates for a ten-day cycle", () => {
    expect(budgetCycleEnd("2026-10-14", 10)).toBe("2026-10-23");
    expect(budgetCycleDuration(cycle)).toBe(10);
  });

  it("keeps one current cycle and finds it by the user's local date", () => {
    expect(currentBudgetCycle([
      { ...cycle, id: "past", period_start: "2026-10-01", period_end: "2026-10-10" },
      cycle,
    ], "2026-10-20")?.id).toBe("cycle");
    expect(currentBudgetCycle([cycle], "2026-10-24")).toBeNull();
  });

  it("tracks the overall cap, category sublimits, and excess without rollover", () => {
    const snapshot = {
      ...emptyFinanceSnapshot,
      transactions: [
        { id: "food", account_id: "account", transaction_type: "expense" as const, amount_minor: "25000", currency: "PHP", local_date: "2026-10-15", category: "Food", description: "Groceries", notes: null, active: true, revision: 1 },
        { id: "ride", account_id: "account", transaction_type: "expense" as const, amount_minor: "10000", currency: "PHP", local_date: "2026-10-16", category: "Transport", description: "Train", notes: null, active: true, revision: 1 },
        { id: "other-currency", account_id: "account", transaction_type: "expense" as const, amount_minor: "5000", currency: "USD", local_date: "2026-10-17", category: "Food", description: "Taxi", notes: null, active: true, revision: 1 },
      ],
      transfers: [{ id: "move", from_account_id: "account", to_account_id: "savings", from_amount_minor: "45000", from_currency: "PHP", to_amount_minor: "45000", to_currency: "PHP", local_date: "2026-10-16", rate: null, source: null, as_of: null, notes: null, active: true, revision: 1 }],
    };
    const limits = [
      { id: "food-limit", cycle_id: "cycle", category: "Food", amount_minor: "20000", revision: 1 },
      { id: "transport-limit", cycle_id: "cycle", category: "Transport", amount_minor: "15000", revision: 1 },
    ];

    expect(budgetCycleProgress(snapshot, cycle, limits, "2026-10-17")).toMatchObject({
      spent_minor: "35000", remaining_minor: "65000", over_minor: "0", days_remaining: 6,
      category_limits: [
        { category: "Food", spent_minor: "25000", remaining_minor: "-5000" },
        { category: "Transport", spent_minor: "10000", remaining_minor: "5000" },
      ],
    });
    expect(expensesOutsideBudgetCurrency(snapshot, cycle, "2026-10-17")).toBe(1);
  });
});
