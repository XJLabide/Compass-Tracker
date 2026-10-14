import { describe, expect, it } from "vitest";
import { emptyFinanceSnapshot } from "./types";
import { budgetSpent, monthlyFinanceFlow } from "./ledger";

describe("finance ledger summaries", () => {
  const snapshot = {
    ...emptyFinanceSnapshot,
    transactions: [
      { id: "salary", account_id: "bank", transaction_type: "income" as const, amount_minor: "250000", currency: "PHP", local_date: "2026-10-02", category: "Salary", description: "Pay", notes: null, active: true, revision: 1 },
      { id: "food-1", account_id: "bank", transaction_type: "expense" as const, amount_minor: "1599", currency: "PHP", local_date: "2026-10-03", category: "Food", description: "Lunch", notes: null, active: true, revision: 1 },
      { id: "food-2", account_id: "bank", transaction_type: "expense" as const, amount_minor: "2500", currency: "PHP", local_date: "2026-10-09", category: "food", description: "Dinner", notes: null, active: true, revision: 1 },
      { id: "old", account_id: "bank", transaction_type: "expense" as const, amount_minor: "5000", currency: "PHP", local_date: "2026-09-30", category: "Food", description: "Last month", notes: null, active: true, revision: 1 },
    ],
    transfers: [{ id: "transfer", from_account_id: "bank", to_account_id: "savings", from_amount_minor: "50000", from_currency: "PHP", to_amount_minor: "50000", to_currency: "PHP", local_date: "2026-10-04", rate: null, source: null, as_of: null, notes: null, active: true, revision: 1 }],
  };

  it("keeps monthly cash flow in exact minor units and excludes account transfers", () => {
    expect(monthlyFinanceFlow(snapshot, "2026-10-01", "2026-10-31")).toEqual([
      { currency: "PHP", income_minor: "250000", expense_minor: "4099", net_minor: "245901" },
    ]);
  });

  it("sums category budget use without floating-point arithmetic", () => {
    expect(budgetSpent(snapshot, { id: "b", category: "food", currency: "PHP", period_start: "2026-10-01", amount_minor: "10000", active: true, revision: 1 }, "2026-10-31")).toBe("4099");
  });
});
