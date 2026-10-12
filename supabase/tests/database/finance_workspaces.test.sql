begin;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password)
values
  ('19000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'finance-a@example.test', ''),
  ('19000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'finance-b@example.test', '');

select ok((select relrowsecurity from pg_class where oid = 'public.finance_accounts'::regclass), 'finance accounts use RLS');
select ok((select bool_and(relrowsecurity) from pg_class where oid = any(array[
  'public.finance_transactions'::regclass, 'public.finance_budgets'::regclass,
  'public.finance_recurring_charges'::regclass, 'public.finance_positions'::regclass,
  'public.finance_position_valuations'::regclass, 'public.finance_fx_rates'::regclass,
  'public.finance_conversions'::regclass
])), 'all finance tables use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.finance_conversions'::regclass), 'finance conversions use RLS');
select ok((select bool_and(
  not has_table_privilege('authenticated', table_name, 'insert')
  and not has_table_privilege('authenticated', table_name, 'update')
  and not has_table_privilege('authenticated', table_name, 'delete')
) from unnest(array[
  'public.finance_accounts', 'public.finance_transactions', 'public.finance_budgets', 'public.finance_recurring_charges',
  'public.finance_positions', 'public.finance_position_valuations', 'public.finance_fx_rates', 'public.finance_conversions'
]) as table_name), 'clients cannot directly write any finance records');

set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-4000-8000-000000000001', true);

select is(
  public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000001', 'finance_account', '39000000-0000-4000-8000-000000000001', 0,
    '{"name":"Main checking","account_type":"checking","currency":"PHP","opening_balance_minor":"9007199254740993","opened_on":"2026-10-01","active":true}'::jsonb
  )->>'status', 'applied', 'finance account accepts exact amounts above JavaScript safe integer range'
);
select is(
  (select opening_balance_minor::text from public.finance_accounts where id = '39000000-0000-4000-8000-000000000001'),
  '9007199254740993', 'account money persists exactly as bigint minor units'
);
select is(
  public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000002', 'finance_transaction', '39000000-0000-4000-8000-000000000002', 0,
    '{"account_id":"39000000-0000-4000-8000-000000000001","transaction_type":"expense","amount_minor":"125","currency":"PHP","local_date":"2026-10-10","category":"Food","description":"Lunch"}'::jsonb
  )->>'status', 'applied', 'manual transactions can be recorded against an owned account'
);
select throws_ok(
  $$ select public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000003', 'finance_transaction', '39000000-0000-4000-8000-000000000003', 0,
    '{"account_id":"39000000-0000-4000-8000-000000000001","transaction_type":"expense","amount_minor":"1","currency":"USD","local_date":"2026-10-10","category":"Food","description":"Wrong currency"}'::jsonb
  ) $$,
  '23514', 'Transaction currency must match the selected account', 'transactions must preserve their account currency'
);
select is(
  public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000010', 'finance_budget', '39000000-0000-4000-8000-000000000010', 0,
    '{"category":"Food","currency":"PHP","period_start":"2026-10-01","amount_minor":"20000","active":true}'::jsonb
  )->>'status', 'applied', 'monthly budgets can be stored with explicit currencies'
);
select is(
  public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000011', 'finance_recurring_charge', '39000000-0000-4000-8000-000000000011', 0,
    '{"account_id":"39000000-0000-4000-8000-000000000001","name":"Internet","category":"Utilities","amount_minor":"250000","currency":"PHP","cadence":"monthly","next_due_on":"2026-11-01","active":true}'::jsonb
  )->>'status', 'applied', 'recurring charges can be scheduled without auto-posting a transaction'
);

select is(
  public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000004', 'finance_position', '39000000-0000-4000-8000-000000000004', 0,
    '{"position_type":"holding","name":"Example Fund","symbol":"EXF","quantity":"1.5","currency":"USD","opened_on":"2026-10-01","active":true}'::jsonb
  )->>'status', 'applied', 'a holding can be entered manually without a market provider'
);
select is(
  public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000005', 'finance_valuation', '39000000-0000-4000-8000-000000000005', 0,
    '{"position_id":"39000000-0000-4000-8000-000000000004","local_date":"2026-10-11","as_of":"2026-10-11T00:00:00Z","unit_price_minor":"1001","currency":"USD","source":"manual","freshness":"fresh"}'::jsonb
  )->>'status', 'applied', 'manual dated holding valuations retain provider freshness fields'
);
select is(
  (select value_minor::text from public.finance_position_valuations where id = '39000000-0000-4000-8000-000000000005'),
  '1502', 'holding value is computed from exact unit price and quantity on the server'
);
select throws_ok(
  $$ select public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000019', 'finance_valuation', '39000000-0000-4000-8000-000000000019', 0,
    '{"position_id":"39000000-0000-4000-8000-000000000004","local_date":"2026-10-12","as_of":"2026-10-12T00:00:00Z","value_minor":null,"unit_price_minor":null,"currency":"USD","source":"provider","freshness":"unavailable"}'::jsonb
  ) $$,
  '23514', null, 'unavailable valuations require a visible failure reason'
);
select is(
  public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000006', 'finance_fx_rate', '39000000-0000-4000-8000-000000000006', 0,
    '{"base_currency":"USD","quote_currency":"PHP","rate":"56.123456789012","source":"manual","as_of":"2026-10-11T00:00:00Z","freshness":"stale"}'::jsonb
  )->>'status', 'applied', 'manual FX rates carry source, as-of, and freshness'
);
select throws_ok(
  $$ select public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000018', 'finance_fx_rate', '39000000-0000-4000-8000-000000000018', 0,
    '{"base_currency":"USD","quote_currency":"EUR","rate":null,"source":"provider","as_of":"2026-10-11T00:00:00Z","freshness":"unavailable"}'::jsonb
  ) $$,
  '23514', null, 'unavailable provider rates must carry an explanatory reason'
);
select is(
  public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000007', 'finance_conversion', '39000000-0000-4000-8000-000000000007', 0,
    '{"fx_rate_id":"39000000-0000-4000-8000-000000000006","local_date":"2026-10-12","from_amount_minor":"100","from_currency":"USD","to_amount_minor":"5612","to_currency":"PHP","rate":"56.123456789012","source":"manual","as_of":"2026-10-11T00:00:00Z"}'::jsonb
  )->>'status', 'applied', 'conversion records snapshot their FX provenance'
);

select is(
  public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000008', 'finance_account', '39000000-0000-4000-8000-000000000001', 1,
    '{"active":false,"closed_on":"2026-10-12"}'::jsonb
  )->>'revision', '2', 'account edits advance revision for offline conflict handling'
);
select is(
  (select count(*)::integer from public.record_versions where owner_id = '19000000-0000-4000-8000-000000000001' and record_type = 'finance_accounts' and record_id = '39000000-0000-4000-8000-000000000001'),
  1, 'finance account edits preserve a recovery before-image'
);
select is(
  public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000012', 'finance_transaction', '39000000-0000-4000-8000-000000000002', 1,
    '{"description":"Corrected lunch"}'::jsonb
  )->>'status', 'applied', 'transaction corrections use revisioned finance mutations'
);
select is(
  public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000013', 'finance_budget', '39000000-0000-4000-8000-000000000010', 1,
    '{"amount_minor":"25000"}'::jsonb
  )->>'status', 'applied', 'budgets can be revised'
);
select is(
  public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000014', 'finance_recurring_charge', '39000000-0000-4000-8000-000000000011', 1,
    '{"amount_minor":"260000"}'::jsonb
  )->>'status', 'applied', 'recurring charges can be revised'
);
select is(
  public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000015', 'finance_position', '39000000-0000-4000-8000-000000000004', 1,
    '{"name":"Example Fund A"}'::jsonb
  )->>'status', 'applied', 'position details can be revised'
);
select is(
  public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000016', 'finance_valuation', '39000000-0000-4000-8000-000000000005', 1,
    '{"position_id":"39000000-0000-4000-8000-000000000004","unit_price_minor":"1002","freshness":"stale","notes":"Market close delayed"}'::jsonb
  )->>'status', 'applied', 'valuation freshness and notes can be revised'
);
select is(
  public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000017', 'finance_fx_rate', '39000000-0000-4000-8000-000000000006', 1,
    '{"freshness":"stale","reason":"Manual rate needs confirmation"}'::jsonb
  )->>'status', 'applied', 'FX status can be updated and carries a visible reason'
);
select ok((select count(*) = 1 from public.record_versions where owner_id = '19000000-0000-4000-8000-000000000001' and record_type = 'finance_transactions' and record_id = '39000000-0000-4000-8000-000000000002'), 'transaction edits preserve a recovery before-image');
select ok((select count(*) = 1 from public.record_versions where owner_id = '19000000-0000-4000-8000-000000000001' and record_type = 'finance_budgets' and record_id = '39000000-0000-4000-8000-000000000010'), 'budget edits preserve a recovery before-image');
select ok((select count(*) = 1 from public.record_versions where owner_id = '19000000-0000-4000-8000-000000000001' and record_type = 'finance_recurring_charges' and record_id = '39000000-0000-4000-8000-000000000011'), 'recurring-charge edits preserve a recovery before-image');
select ok((select count(*) = 1 from public.record_versions where owner_id = '19000000-0000-4000-8000-000000000001' and record_type = 'finance_positions' and record_id = '39000000-0000-4000-8000-000000000004'), 'position edits preserve a recovery before-image');
select ok((select count(*) = 1 from public.record_versions where owner_id = '19000000-0000-4000-8000-000000000001' and record_type = 'finance_position_valuations' and record_id = '39000000-0000-4000-8000-000000000005'), 'valuation edits preserve a recovery before-image');
select ok((select count(*) = 1 from public.record_versions where owner_id = '19000000-0000-4000-8000-000000000001' and record_type = 'finance_fx_rates' and record_id = '39000000-0000-4000-8000-000000000006'), 'FX rate edits preserve a recovery before-image');
select is(
  public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000008', 'finance_account', '39000000-0000-4000-8000-000000000001', 1,
    '{"active":false,"closed_on":"2026-10-12"}'::jsonb
  )->>'revision', '2', 'replaying a finance mutation returns its original receipt'
);

select set_config('request.jwt.claim.sub', '19000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.finance_accounts), 0, 'another owner cannot read finance accounts');
select is((select count(*)::integer from public.finance_transactions), 0, 'another owner cannot read finance transactions');
select is((select count(*)::integer from public.finance_budgets), 0, 'another owner cannot read finance budgets');
select is((select count(*)::integer from public.finance_recurring_charges), 0, 'another owner cannot read recurring charges');
select is((select count(*)::integer from public.finance_positions), 0, 'another owner cannot read positions');
select is((select count(*)::integer from public.finance_position_valuations), 0, 'another owner cannot read valuations');
select is((select count(*)::integer from public.finance_fx_rates), 0, 'another owner cannot read FX rates');
select is((select count(*)::integer from public.finance_conversions), 0, 'another owner cannot read conversions');
select is(
  public.apply_finance_mutation(
    '29000000-0000-4000-8000-000000000009', 'finance_account', '39000000-0000-4000-8000-000000000001', 2,
    '{"name":"Unauthorized"}'::jsonb
  )->>'status', 'not_found', 'another owner cannot update a finance record'
);

select * from finish();
rollback;
