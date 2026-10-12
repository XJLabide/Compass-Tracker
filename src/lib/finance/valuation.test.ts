import { describe, expect, it } from "vitest";
import { emptyFinanceSnapshot } from "./types";
import { buildNetWorthHistory, createValuationAdapter, netWorthAt, resolveFreshness } from "./valuation";

describe("finance valuation", () => {
  it("reconstructs dated net worth from account transactions and position valuations", () => {
    const snapshot = {
      ...emptyFinanceSnapshot,
      accounts: [
        { id: "cash", name: "Bank", account_type: "checking" as const, currency: "USD", opening_balance_minor: "100000", opened_on: "2026-01-01", closed_on: null, active: true, revision: 1 },
        { id: "credit", name: "Card", account_type: "credit" as const, currency: "USD", opening_balance_minor: "20000", opened_on: "2026-01-01", closed_on: null, active: true, revision: 1 },
      ],
      transactions: [
        { id: "income", account_id: "cash", transaction_type: "income" as const, amount_minor: "2000", currency: "USD", local_date: "2026-01-10", category: "pay", description: "Pay", notes: null, active: true, revision: 1 },
        { id: "expense", account_id: "cash", transaction_type: "expense" as const, amount_minor: "5000", currency: "USD", local_date: "2026-01-12", category: "food", description: "Groceries", notes: null, active: true, revision: 1 },
        { id: "card-charge", account_id: "credit", transaction_type: "expense" as const, amount_minor: "10000", currency: "USD", local_date: "2026-01-13", category: "travel", description: "Fare", notes: null, active: true, revision: 1 },
        { id: "card-payment", account_id: "credit", transaction_type: "income" as const, amount_minor: "2000", currency: "USD", local_date: "2026-01-14", category: "payment", description: "Payment", notes: null, active: true, revision: 1 },
      ],
      positions: [
        { id: "home", position_type: "asset" as const, account_id: null, name: "Home", symbol: null, quantity: null, currency: "USD", opened_on: "2026-01-01", closed_on: null, active: true, revision: 1 },
        { id: "loan", position_type: "debt" as const, account_id: null, name: "Loan", symbol: null, quantity: null, currency: "USD", opened_on: "2026-01-01", closed_on: null, active: true, revision: 1 },
        { id: "fund", position_type: "holding" as const, account_id: null, name: "Fund", symbol: "FND", quantity: "2", currency: "USD", opened_on: "2026-01-01", closed_on: null, active: true, revision: 1 },
      ],
      valuations: [
        { id: "home-v", position_id: "home", local_date: "2026-01-05", as_of: "2026-01-05T00:00:00Z", value_minor: "120000", unit_price_minor: null, currency: "USD", source: "manual", freshness: "fresh" as const, reason: null, notes: null, revision: 1 },
        { id: "loan-v", position_id: "loan", local_date: "2026-01-05", as_of: "2026-01-05T00:00:00Z", value_minor: "40000", unit_price_minor: null, currency: "USD", source: "manual", freshness: "fresh" as const, reason: null, notes: null, revision: 1 },
        { id: "fund-v", position_id: "fund", local_date: "2026-01-05", as_of: "2026-01-05T00:00:00Z", value_minor: "10000", unit_price_minor: "5000", currency: "USD", source: "manual", freshness: "fresh" as const, reason: null, notes: null, revision: 1 },
      ],
    };

    expect(netWorthAt(snapshot, "2026-01-31")).toEqual([{ currency: "USD", amount_minor: "159000" }]);
    expect(buildNetWorthHistory(snapshot, "2026-01-31").map(({ date }) => date)).toEqual([
      "2026-01-01", "2026-01-05", "2026-01-10", "2026-01-12", "2026-01-13", "2026-01-14",
    ]);
  });

  it("marks old provider records stale and preserves explicit unavailable status", () => {
    const now = Date.parse("2026-10-13T00:00:00Z");
    expect(resolveFreshness("fresh", "2026-10-11T00:00:00Z", now)).toBe("stale");
    expect(resolveFreshness("unavailable", "2026-10-13T00:00:00Z", now)).toBe("unavailable");
  });

  it("exposes manual fallback when no live quote or FX provider is configured", async () => {
    const adapter = createValuationAdapter(undefined, undefined, () => new Date("2026-10-13T00:00:00Z"));
    await expect(adapter.getQuotes(["ABC"])).resolves.toMatchObject({ status: "unavailable", source: "unavailable", asOf: "2026-10-13T00:00:00.000Z" });
    await expect(adapter.getRates("USD", ["PHP"])).resolves.toMatchObject({ status: "unavailable", reason: expect.stringContaining("Manual rates remain available") });
  });
});
