# Finance data contracts

## Exact money

- Monetary amounts are stored as signed or positive PostgreSQL `bigint` minor units plus an uppercase three-letter currency code.
- Income and expense entries are positive magnitudes. Their transaction type determines the signed account effect.
- UI decimal input is parsed from its text representation using the currency's ISO minor-unit precision. It is never multiplied through a floating-point money value.
- FX rates are decimal `numeric(30,12)` values, never monetary amounts. A saved conversion records the source amount/currency, target amount/currency, rate, source, and as-of timestamp.

## Accounts and history

- Accounts have an opening balance and date. Account balances are reconstructed from that opening value and dated transactions.
- Credit account balances represent debt and contribute negatively to net worth. Expenses increase the debt balance; income/payment entries reduce it.
- Asset, debt, and holding positions keep dated valuation records. A holding records units and a quoted unit price; the saved total value is computed server-side.
- Net-worth history is reconstructed at account/position open and close dates, transaction dates, and valuation dates. Totals remain grouped by currency; the app does not add unlike currencies without an explicitly recorded conversion.
- Recurring charges are schedules only. They do not generate transactions without a user action.

## Quotes and FX

- Provider results carry values, source, as-of time, and freshness. Stale and unavailable results stay visible with their reason.
- Phase 4 starts manual-first. No live quote or FX provider is selected or enabled; the server-only adapter boundary can wrap one after its limits and retention are documented.
- Manual position valuations and manual FX rates use the same provenance and freshness fields as future provider results. Missing live data does not block account, transaction, budget, recurring-charge, position, or net-worth workflows.

## Synchronization and access

- Finance rows are owner scoped, readable only under owner RLS, and writable through revision-checked, idempotent finance mutations.
- Mutable finance records use the shared pre-edit recovery snapshots. Conversion records are immutable; corrections create a new conversion record.
- Offline finance mutations use the existing IndexedDB outbox. Amounts stay decimal strings in the client mutation payload and are cast to bigint in PostgreSQL.
