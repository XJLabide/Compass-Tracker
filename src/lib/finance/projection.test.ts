import { describe, expect, it } from "vitest";
import type { QueuedMutation } from "@/lib/offline/outbox";
import { emptyFinanceSnapshot } from "./types";
import { projectLocalFinanceMutations } from "./projection";

function mutation(id: string, entityType: QueuedMutation["entityType"], payload: QueuedMutation["payload"]): QueuedMutation {
  return { id, recordId: id, entityType, expectedRevision: 0, payload, createdAt: 1, status: "pending" };
}

describe("local finance projection", () => {
  it("makes an unsynced exact-minor transaction available offline", () => {
    const result = projectLocalFinanceMutations(emptyFinanceSnapshot, [mutation("tx", "finance_transaction", {
      account_id: "account", transaction_type: "expense", amount_minor: "12345", currency: "USD",
      local_date: "2026-10-13", category: "Food", description: "Lunch", notes: null, active: true,
    })]);

    expect(result.transactions).toMatchObject([{ id: "tx", amount_minor: "12345", currency: "USD", revision: 1 }]);
  });

  it("projects conversions with their stored FX provenance", () => {
    const result = projectLocalFinanceMutations(emptyFinanceSnapshot, [mutation("conversion", "finance_conversion", {
      local_date: "2026-10-13", fx_rate_id: "rate", from_amount_minor: "100", from_currency: "USD",
      to_amount_minor: "5600", to_currency: "PHP", rate: "56", source: "manual", as_of: "2026-10-13T00:00:00Z",
    })]);

    expect(result.conversions[0]).toMatchObject({ from_amount_minor: "100", to_amount_minor: "5600", fx_rate_id: "rate", source: "manual" });
  });

  it("preserves existing finance fields when an offline archive only changes status", () => {
    const source = {
      ...emptyFinanceSnapshot,
      accounts: [{ id: "account", name: "Main", account_type: "checking" as const, currency: "PHP", opening_balance_minor: "50000", opened_on: "2026-01-01", closed_on: null, active: true, revision: 2 }],
    };
    const archive = mutation("account", "finance_account", { active: false, closed_on: "2026-10-13" });
    archive.expectedRevision = 2;

    const result = projectLocalFinanceMutations(source, [archive]);

    expect(result.accounts[0]).toMatchObject({ name: "Main", currency: "PHP", opening_balance_minor: "50000", active: false, closed_on: "2026-10-13", revision: 3 });
  });
});
