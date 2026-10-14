begin;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password)
values
  ('1a000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'cycles-a@example.test', ''),
  ('1a000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'cycles-b@example.test', '');

select ok((select relrowsecurity from pg_class where oid = 'public.finance_budget_cycles'::regclass), 'budget cycles use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.finance_transfers'::regclass), 'transfers use RLS');
select ok(not has_table_privilege('authenticated', 'public.finance_budget_cycles', 'insert'), 'clients cannot directly create budget cycles');
select ok(not has_table_privilege('authenticated', 'public.finance_transfers', 'update'), 'clients cannot directly edit transfers');

set local role authenticated;
select set_config('request.jwt.claim.sub', '1a000000-0000-4000-8000-000000000001', true);

select is(public.apply_finance_mutation(
  '2a000000-0000-4000-8000-000000000001','finance_account','3a000000-0000-4000-8000-000000000001',0,
  '{"name":"Checking","account_type":"checking","currency":"PHP","opening_balance_minor":"100000","opened_on":"2026-10-01"}'::jsonb
)->>'status','applied','a checking account is available to the tracker');
select is(public.apply_finance_mutation(
  '2a000000-0000-4000-8000-000000000002','finance_account','3a000000-0000-4000-8000-000000000002',0,
  '{"name":"Savings","account_type":"savings","currency":"PHP","opening_balance_minor":"0","opened_on":"2026-10-01"}'::jsonb
)->>'status','applied','a second same-currency account is available for transfers');
select is(public.apply_finance_mutation(
  '2a000000-0000-4000-8000-000000000003','finance_account','3a000000-0000-4000-8000-000000000003',0,
  '{"name":"USD account","account_type":"checking","currency":"USD","opening_balance_minor":"0","opened_on":"2026-10-01"}'::jsonb
)->>'status','applied','a foreign-currency account is available for FX transfers');

select is(public.apply_finance_flow_mutation(
  '2a000000-0000-4000-8000-000000000004','finance_budget_cycle','3a000000-0000-4000-8000-000000000004',0,
  '{"currency":"PHP","period_start":"2026-10-14","period_end":"2026-10-23","total_amount_minor":"50000"}'::jsonb
)->>'status','applied','a custom ten-day budget cycle can be started');
select is(public.apply_finance_flow_mutation(
  '2a000000-0000-4000-8000-000000000005','finance_budget_category_limit','3a000000-0000-4000-8000-000000000005',0,
  '{"cycle_id":"3a000000-0000-4000-8000-000000000004","category":"Food","amount_minor":"20000"}'::jsonb
)->>'status','applied','optional category caps can be placed inside the cycle total');
select throws_ok(
  $$ select public.apply_finance_flow_mutation(
    '2a000000-0000-4000-8000-000000000006','finance_budget_category_limit','3a000000-0000-4000-8000-000000000006',0,
    '{"cycle_id":"3a000000-0000-4000-8000-000000000004","category":"Transport","amount_minor":"35001"}'::jsonb
  ) $$,
  '23514','Category limits cannot exceed the overall budget cap','category caps cannot exceed the cycle total'
);
select throws_ok(
  $$ select public.apply_finance_flow_mutation(
    '2a000000-0000-4000-8000-000000000007','finance_budget_cycle','3a000000-0000-4000-8000-000000000007',0,
    '{"currency":"PHP","period_start":"2026-10-20","period_end":"2026-10-29","total_amount_minor":"70000"}'::jsonb
  ) $$,
  '23P01','A budget period already overlaps those dates for this currency','overlapping spending cycles are rejected'
);
select throws_ok(
  $$ select public.apply_finance_flow_mutation(
    '2a000000-0000-4000-8000-000000000015','finance_budget_cycle','3a000000-0000-4000-8000-000000000015',0,
    '{"currency":"USD","period_start":"2026-10-15","period_end":"2026-10-24","total_amount_minor":"5000"}'::jsonb
  ) $$,
  '23P01','A budget period overlaps an existing cycle','a user cannot run overlapping periods in different currencies'
);
select is(public.apply_finance_flow_mutation(
  '2a000000-0000-4000-8000-000000000008','finance_budget_cycle','3a000000-0000-4000-8000-000000000008',0,
  '{"currency":"PHP","period_start":"2026-10-24","period_end":"2026-11-02","total_amount_minor":"70000"}'::jsonb
)->>'status','applied','a new cycle can start after the prior period ends');
select is(public.apply_finance_flow_mutation(
  '2a000000-0000-4000-8000-000000000009','finance_budget_cycle','3a000000-0000-4000-8000-000000000004',1,
  '{"total_amount_minor":"55000"}'::jsonb
)->>'revision','2','cycle edits advance the revision and preserve category headroom');
select is(public.apply_finance_flow_mutation(
  '2a000000-0000-4000-8000-000000000014','finance_budget_cycle','3a000000-0000-4000-8000-000000000004',1,
  '{"total_amount_minor":"19000"}'::jsonb
)->>'status','conflict','stale cycle edits return an optimistic conflict');
select is(
  (select count(*)::integer from public.record_versions where owner_id='1a000000-0000-4000-8000-000000000001' and record_type='finance_budget_cycles' and record_id='3a000000-0000-4000-8000-000000000004'),
  1,'cycle edits preserve a recovery before-image'
);

select is(public.apply_finance_flow_mutation(
  '2a000000-0000-4000-8000-000000000010','finance_transfer','3a000000-0000-4000-8000-000000000010',0,
  '{"from_account_id":"3a000000-0000-4000-8000-000000000001","to_account_id":"3a000000-0000-4000-8000-000000000002","from_amount_minor":"25000","from_currency":"PHP","to_amount_minor":"25000","to_currency":"PHP","local_date":"2026-10-15"}'::jsonb
)->>'status','applied','same-currency account transfers are recorded separately from spending');
select is(public.apply_finance_flow_mutation(
  '2a000000-0000-4000-8000-000000000011','finance_transfer','3a000000-0000-4000-8000-000000000011',0,
  '{"from_account_id":"3a000000-0000-4000-8000-000000000001","to_account_id":"3a000000-0000-4000-8000-000000000003","from_amount_minor":"10000","from_currency":"PHP","to_amount_minor":"5600","to_currency":"USD","local_date":"2026-10-16","rate":"0.56","source":"manual","as_of":"2026-10-16T00:00:00Z"}'::jsonb
)->>'status','applied','cross-currency transfers snapshot FX source and timestamp');
select throws_ok(
  $$ select public.apply_finance_flow_mutation(
    '2a000000-0000-4000-8000-000000000012','finance_transfer','3a000000-0000-4000-8000-000000000012',0,
    '{"from_account_id":"3a000000-0000-4000-8000-000000000001","to_account_id":"3a000000-0000-4000-8000-000000000003","from_amount_minor":"10000","from_currency":"PHP","to_amount_minor":"5600","to_currency":"USD","local_date":"2026-10-16"}'::jsonb
  ) $$,
  '23514',null,'cross-currency transfers require FX provenance'
);
select is(public.apply_finance_flow_mutation(
  '2a000000-0000-4000-8000-000000000010','finance_transfer','3a000000-0000-4000-8000-000000000010',0,
  '{"from_account_id":"3a000000-0000-4000-8000-000000000001","to_account_id":"3a000000-0000-4000-8000-000000000002","from_amount_minor":"25000","from_currency":"PHP","to_amount_minor":"25000","to_currency":"PHP","local_date":"2026-10-15"}'::jsonb
)->>'status','applied','same mutation replay returns the original transfer receipt');

set local role authenticated;
select set_config('request.jwt.claim.sub', '1a000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.finance_budget_cycles),0,'another owner cannot read spending cycles');
select is((select count(*)::integer from public.finance_transfers),0,'another owner cannot read transfers');

select * from finish();
rollback;
