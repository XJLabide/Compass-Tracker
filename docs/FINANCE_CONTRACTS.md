# Finance data contracts

## Exact money

- Monetary amounts are stored as signed or positive PostgreSQL `bigint` minor units plus an uppercase three-letter currency code.
- Income and expense entries are positive magnitudes. Their transaction type determines the signed account effect.
- Internal transfers are separate records; they update both account balances but never count as income or spending.
- UI decimal input is parsed from its text representation using the currency's ISO minor-unit precision. It is never multiplied through a floating-point money value.
- FX rates are decimal `numeric(30,12)` values, never monetary amounts. A saved conversion records the source amount/currency, target amount/currency, rate, source, and as-of timestamp.

## Accounts and history

- Accounts have an opening balance and date. Account balances are reconstructed from that opening value and dated transactions.
- Transfer records move exact minor-unit amounts between two owned accounts. Same-currency transfers keep both amounts equal; cross-currency transfers preserve the chosen rate, source, and as-of timestamp.
- Credit account balances represent debt and contribute negatively to net worth. Expenses increase the debt balance; income/payment entries reduce it.
- Asset, debt, and holding positions keep dated valuation records. A holding records units and a quoted unit price; the saved total value is computed server-side.
- Net-worth history is reconstructed at account/position open and close dates, transaction dates, and valuation dates. Totals remain grouped by currency; the app does not add unlike currencies without an explicitly recorded conversion.
- Recurring charges are schedules only. They do not generate transactions without a user action.
- Accounts include cash, bank, credit, and brokerage cash balances. Investment holdings are separate positions; their account's opening cash balance is not the holdings total.
- Cross-currency transfers are a separate account-to-account record with both exact amounts and FX provenance. They update both account balances but are excluded from income, expense, and budget summaries.

## Flexible budget cycles

- A spending cycle has one currency, an inclusive local-date range of 1–366 days, and one overall cap. An optional ten-day preset is a shortcut to a custom duration.
- At most one new period can overlap another for an owner. A period ends on its stored end date and remains available in history; starting a later period is a separate user action.
- Category limits are optional sub-limits whose total cannot exceed the cycle cap. Expenses need a category; uncapped categories still count against the overall cap. Expenses that exceed a cap remain recorded and show an overage.
- Unspent money is recorded in the ended cycle and does not roll into the next period. Transactions in currencies other than the cycle currency are surfaced as excluded until explicitly converted; they are never silently added.

## Spending and budget cycles

- Finance navigation separates Spending, Portfolio, and Accounts. Spending is the default view and holds the budget tracker, transactions, and recurring-charge schedules.
- A budget cycle has one overall cap, a selected currency, a local start date, and an inclusive end date derived from its duration. Category limits are optional sub-limits and their sum cannot exceed the overall cap.
- A user can run one budget cycle at a time. Starting a new cycle requires the prior period to finish; periods do not overlap. Past cycles remain in history and unused money does not roll forward.
- Expenses require an editable category; uncapped categories still count against the overall limit. Over-budget expenses are recorded and shown as overages rather than blocked.
- A cycle tracks transactions in its currency only. Expenses in other currencies remain visible and are flagged as outside that cycle; they are not silently converted.
- Legacy monthly category budgets are preserved as dated cycles and category limits during migration.

## Quotes and FX

- Provider results carry values, source, as-of time, and freshness. Stale and unavailable results stay visible with their reason.
- Phase 4 starts manual-first. No live quote or FX provider is selected or enabled; the server-only adapter boundary can wrap one after its limits and retention are documented.
- Manual position valuations and manual FX rates use the same provenance and freshness fields as future provider results. Missing live data does not block account, transaction, budget, recurring-charge, position, or net-worth workflows.

## Synchronization and access

- Finance rows are owner scoped, readable only under owner RLS, and writable through revision-checked, idempotent finance mutations.
- Mutable finance records use the shared pre-edit recovery snapshots. Conversion records are immutable; corrections create a new conversion record.
- Offline finance mutations use the existing IndexedDB outbox. Amounts stay decimal strings in the client mutation payload and are cast to bigint in PostgreSQL.
