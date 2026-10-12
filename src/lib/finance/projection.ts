import type { QueuedMutation } from "@/lib/offline/outbox";
import type {
  FinanceAccount, FinanceFxRate, FinancePosition,
  FinancePositionValuation, FinanceRecurringCharge, FinanceSnapshot, FinanceTransaction,
} from "./types";

const visibleStatuses = new Set(["pending", "sending", "failed", "conflict"]);

export function projectLocalFinanceMutations(source: FinanceSnapshot, mutations: QueuedMutation[]): FinanceSnapshot {
  const snapshot: FinanceSnapshot = {
    accounts: [...source.accounts], transactions: [...source.transactions], budgets: [...source.budgets],
    recurringCharges: [...source.recurringCharges], positions: [...source.positions], valuations: [...source.valuations],
    fxRates: [...source.fxRates], conversions: [...source.conversions],
  };
  for (const mutation of mutations) {
    if (!visibleStatuses.has(mutation.status) || !isRecord(mutation.payload) || !isFinanceEntity(mutation.entityType)) continue;
    const payload = {
      ...existingFinanceRecord(snapshot, mutation.entityType, mutation.recordId),
      ...mutation.payload,
    };
    const revision = mutation.expectedRevision + 1;
    if (mutation.entityType === "finance_account") snapshot.accounts = upsert(snapshot.accounts, {
      id: mutation.recordId, name: string(payload.name), account_type: string(payload.account_type, "cash") as FinanceAccount["account_type"],
      currency: string(payload.currency, "USD"), opening_balance_minor: string(payload.opening_balance_minor, "0"),
      opened_on: string(payload.opened_on, ""), closed_on: nullableString(payload.closed_on), active: bool(payload.active, true), revision,
    });
    if (mutation.entityType === "finance_transaction") snapshot.transactions = upsert(snapshot.transactions, {
      id: mutation.recordId, account_id: string(payload.account_id), transaction_type: string(payload.transaction_type, "expense") as FinanceTransaction["transaction_type"],
      amount_minor: string(payload.amount_minor, "0"), currency: string(payload.currency, "USD"), local_date: string(payload.local_date, ""),
      category: string(payload.category, "Other"), description: string(payload.description), notes: nullableString(payload.notes), active: bool(payload.active, true), revision,
    });
    if (mutation.entityType === "finance_budget") snapshot.budgets = upsert(snapshot.budgets, {
      id: mutation.recordId, category: string(payload.category, "Other"), currency: string(payload.currency, "USD"),
      period_start: string(payload.period_start, ""), amount_minor: string(payload.amount_minor, "0"), active: bool(payload.active, true), revision,
    });
    if (mutation.entityType === "finance_recurring_charge") snapshot.recurringCharges = upsert(snapshot.recurringCharges, {
      id: mutation.recordId, account_id: nullableString(payload.account_id), name: string(payload.name), category: string(payload.category, "Other"),
      amount_minor: string(payload.amount_minor, "0"), currency: string(payload.currency, "USD"), cadence: string(payload.cadence, "monthly") as FinanceRecurringCharge["cadence"],
      next_due_on: string(payload.next_due_on, ""), notes: nullableString(payload.notes), active: bool(payload.active, true), revision,
    });
    if (mutation.entityType === "finance_position") snapshot.positions = upsert(snapshot.positions, {
      id: mutation.recordId, position_type: string(payload.position_type, "asset") as FinancePosition["position_type"], account_id: nullableString(payload.account_id),
      name: string(payload.name), symbol: nullableString(payload.symbol), quantity: nullableString(payload.quantity), currency: string(payload.currency, "USD"),
      opened_on: string(payload.opened_on, ""), closed_on: nullableString(payload.closed_on), active: bool(payload.active, true), revision,
    });
    if (mutation.entityType === "finance_valuation") snapshot.valuations = upsert(snapshot.valuations, {
      id: mutation.recordId, position_id: string(payload.position_id), local_date: string(payload.local_date, ""), as_of: string(payload.as_of, ""),
      value_minor: nullableString(payload.value_minor), unit_price_minor: nullableString(payload.unit_price_minor), currency: string(payload.currency, "USD"),
      source: string(payload.source, "manual"), freshness: string(payload.freshness, "fresh") as FinancePositionValuation["freshness"],
      reason: nullableString(payload.reason), notes: nullableString(payload.notes), revision,
    });
    if (mutation.entityType === "finance_fx_rate") snapshot.fxRates = upsert(snapshot.fxRates, {
      id: mutation.recordId, base_currency: string(payload.base_currency, "USD"), quote_currency: string(payload.quote_currency, "EUR"),
      rate: nullableString(payload.rate), source: string(payload.source, "manual"), as_of: string(payload.as_of, ""),
      freshness: string(payload.freshness, "fresh") as FinanceFxRate["freshness"], reason: nullableString(payload.reason), revision,
    });
    if (mutation.entityType === "finance_conversion") snapshot.conversions = upsert(snapshot.conversions, {
      id: mutation.recordId, fx_rate_id: nullableString(payload.fx_rate_id), local_date: string(payload.local_date, ""), from_amount_minor: string(payload.from_amount_minor, "0"),
      from_currency: string(payload.from_currency, "USD"), to_amount_minor: string(payload.to_amount_minor, "0"), to_currency: string(payload.to_currency, "EUR"),
      rate: string(payload.rate, "1"), source: string(payload.source, "manual"), as_of: string(payload.as_of, ""), revision,
    });
  }
  return snapshot;
}

function existingFinanceRecord(
  snapshot: FinanceSnapshot,
  entityType: QueuedMutation["entityType"],
  id: string,
): Record<string, unknown> {
  const rows = entityType === "finance_account" ? snapshot.accounts
    : entityType === "finance_transaction" ? snapshot.transactions
      : entityType === "finance_budget" ? snapshot.budgets
        : entityType === "finance_recurring_charge" ? snapshot.recurringCharges
          : entityType === "finance_position" ? snapshot.positions
            : entityType === "finance_valuation" ? snapshot.valuations
              : entityType === "finance_fx_rate" ? snapshot.fxRates
                : entityType === "finance_conversion" ? snapshot.conversions
                  : [];
  return (rows.find((row) => row.id === id) as unknown as Record<string, unknown> | undefined) ?? {};
}

function isFinanceEntity(entityType: QueuedMutation["entityType"]): entityType is
  | "finance_account" | "finance_transaction" | "finance_budget" | "finance_recurring_charge"
  | "finance_position" | "finance_valuation" | "finance_fx_rate" | "finance_conversion" {
  return entityType === "finance_account" || entityType === "finance_transaction" || entityType === "finance_budget"
    || entityType === "finance_recurring_charge" || entityType === "finance_position" || entityType === "finance_valuation"
    || entityType === "finance_fx_rate" || entityType === "finance_conversion";
}

function upsert<T extends { id: string }>(rows: T[], value: T): T[] {
  return rows.some(({ id }) => id === value.id) ? rows.map((row) => row.id === value.id ? value : row) : [...rows, value];
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function string(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function nullableString(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
function bool(value: unknown, fallback: boolean): boolean { return typeof value === "boolean" ? value : fallback; }
