export type FinanceCurrency = string;
export type FinanceFreshness = "fresh" | "stale" | "unavailable";
export type FinanceAccountKind = "cash" | "checking" | "savings" | "credit" | "investment" | "other";
export type FinanceTransactionKind = "income" | "expense";
export type FinancePositionKind = "asset" | "debt" | "holding";
export type FinanceCadence = "weekly" | "monthly" | "quarterly" | "yearly";
export type MinorUnits = string;

export interface FinanceAccount {
  id: string;
  name: string;
  account_type: FinanceAccountKind;
  currency: FinanceCurrency;
  opening_balance_minor: MinorUnits;
  opened_on: string;
  closed_on: string | null;
  active: boolean;
  revision: number;
}

export interface FinanceTransaction {
  id: string;
  account_id: string;
  transaction_type: FinanceTransactionKind;
  amount_minor: MinorUnits;
  currency: FinanceCurrency;
  local_date: string;
  category: string;
  description: string;
  notes: string | null;
  active: boolean;
  revision: number;
}

export interface FinanceBudget {
  id: string;
  category: string;
  currency: FinanceCurrency;
  period_start: string;
  amount_minor: MinorUnits;
  active: boolean;
  revision: number;
}

export interface FinanceRecurringCharge {
  id: string;
  account_id: string | null;
  name: string;
  category: string;
  amount_minor: MinorUnits;
  currency: FinanceCurrency;
  cadence: FinanceCadence;
  next_due_on: string;
  notes: string | null;
  active: boolean;
  revision: number;
}

export interface FinancePosition {
  id: string;
  position_type: FinancePositionKind;
  account_id: string | null;
  name: string;
  symbol: string | null;
  quantity: string | null;
  currency: FinanceCurrency;
  opened_on: string;
  closed_on: string | null;
  active: boolean;
  revision: number;
}

export interface FinancePositionValuation {
  id: string;
  position_id: string;
  local_date: string;
  as_of: string;
  value_minor: MinorUnits | null;
  unit_price_minor: MinorUnits | null;
  currency: FinanceCurrency;
  source: string;
  freshness: FinanceFreshness;
  reason: string | null;
  notes: string | null;
  revision: number;
}

export interface FinanceFxRate {
  id: string;
  base_currency: FinanceCurrency;
  quote_currency: FinanceCurrency;
  rate: string | null;
  source: string;
  as_of: string;
  freshness: FinanceFreshness;
  reason: string | null;
  revision: number;
}

export interface FinanceConversion {
  id: string;
  fx_rate_id: string | null;
  local_date: string;
  from_amount_minor: MinorUnits;
  from_currency: FinanceCurrency;
  to_amount_minor: MinorUnits;
  to_currency: FinanceCurrency;
  rate: string;
  source: string;
  as_of: string;
  revision: number;
}

export interface FinanceSnapshot {
  accounts: FinanceAccount[];
  transactions: FinanceTransaction[];
  budgets: FinanceBudget[];
  recurringCharges: FinanceRecurringCharge[];
  positions: FinancePosition[];
  valuations: FinancePositionValuation[];
  fxRates: FinanceFxRate[];
  conversions: FinanceConversion[];
}

export const emptyFinanceSnapshot: FinanceSnapshot = {
  accounts: [],
  transactions: [],
  budgets: [],
  recurringCharges: [],
  positions: [],
  valuations: [],
  fxRates: [],
  conversions: [],
};
