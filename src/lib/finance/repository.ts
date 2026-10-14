import type { SupabaseClient } from "@supabase/supabase-js";
import { cacheRecord, readCachedRecord, type JsonValue } from "@/lib/offline/outbox";
import { emptyFinanceSnapshot, type FinanceSnapshot } from "./types";

const SNAPSHOT_ID = "finance-snapshot:v1";

export async function loadFinanceSnapshot(
  client: SupabaseClient,
  database: IDBDatabase,
): Promise<{ snapshot: FinanceSnapshot; offline: boolean }> {
  try {
    const [accounts, transactions, budgets, budgetCycles, budgetCategoryLimits, recurringCharges, positions, valuations, fxRates, conversions, transfers] = await Promise.all([
      fetchAll((from, to) => client.from("finance_accounts").select("id,name,account_type,currency,opening_balance_minor::text,opened_on,closed_on,active,revision").order("name").order("id").range(from, to)),
      fetchAll((from, to) => client.from("finance_transactions").select("id,account_id,transaction_type,amount_minor::text,currency,local_date,category,description,notes,active,revision").order("local_date", { ascending: false }).order("id").range(from, to)),
      fetchAll((from, to) => client.from("finance_budgets").select("id,category,currency,period_start,amount_minor::text,active,revision").order("period_start", { ascending: false }).order("id").range(from, to)),
      fetchAll((from, to) => client.from("finance_budget_cycles").select("id,currency,period_start,period_end,total_amount_minor::text,revision").order("period_start", { ascending: false }).order("id").range(from, to)),
      fetchAll((from, to) => client.from("finance_budget_category_limits").select("id,cycle_id,category,amount_minor::text,revision").order("category").order("id").range(from, to)),
      fetchAll((from, to) => client.from("finance_recurring_charges").select("id,account_id,name,category,amount_minor::text,currency,cadence,next_due_on,notes,active,revision").order("next_due_on").order("id").range(from, to)),
      fetchAll((from, to) => client.from("finance_positions").select("id,position_type,account_id,name,symbol,quantity::text,currency,opened_on,closed_on,active,revision").order("name").order("id").range(from, to)),
      fetchAll((from, to) => client.from("finance_position_valuations").select("id,position_id,local_date,as_of,value_minor::text,unit_price_minor::text,currency,source,freshness,reason,notes,revision").order("local_date", { ascending: false }).order("id").range(from, to)),
      fetchAll((from, to) => client.from("finance_fx_rates").select("id,base_currency,quote_currency,rate::text,source,as_of,freshness,reason,revision").order("as_of", { ascending: false }).order("id").range(from, to)),
      fetchAll((from, to) => client.from("finance_conversions").select("id,fx_rate_id,local_date,from_amount_minor::text,from_currency,to_amount_minor::text,to_currency,rate::text,source,as_of,revision").order("local_date", { ascending: false }).order("id").range(from, to)),
      fetchAll((from, to) => client.from("finance_transfers").select("id,from_account_id,to_account_id,from_amount_minor::text,from_currency,to_amount_minor::text,to_currency,local_date,rate::text,source,as_of,notes,active,revision").order("local_date", { ascending: false }).order("id").range(from, to)),
    ]);
    const snapshot: FinanceSnapshot = {
      accounts: accounts as FinanceSnapshot["accounts"],
      transactions: transactions as FinanceSnapshot["transactions"],
      budgets: budgets as FinanceSnapshot["budgets"],
      budgetCycles: budgetCycles as FinanceSnapshot["budgetCycles"],
      budgetCategoryLimits: budgetCategoryLimits as FinanceSnapshot["budgetCategoryLimits"],
      recurringCharges: recurringCharges as FinanceSnapshot["recurringCharges"],
      positions: positions as FinanceSnapshot["positions"],
      valuations: valuations as FinanceSnapshot["valuations"],
      fxRates: fxRates as FinanceSnapshot["fxRates"],
      conversions: conversions as FinanceSnapshot["conversions"],
      transfers: transfers as FinanceSnapshot["transfers"],
    };
    await cacheRecord(database, { id: SNAPSHOT_ID, revision: 1, payload: snapshot as unknown as JsonValue, cachedAt: Date.now() });
    return { snapshot, offline: false };
  } catch (error) {
    const cached = await readCachedRecord(database, SNAPSHOT_ID);
    if (cached) return { snapshot: cached.payload as unknown as FinanceSnapshot, offline: true };
    throw error;
  }
}

async function fetchAll<T>(
  getPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await getPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export { emptyFinanceSnapshot };
