begin;

select plan(8);

insert into auth.users (id, aud, role, email, encrypted_password)
values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner-a@example.test', ''),
  ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'owner-b@example.test', '');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.sync_probe_records'::regclass),
  'sync probe table enforces row-level security'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
  public.apply_sync_probe_mutation(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    0,
    '{"title":"Created offline"}'::jsonb
  )->>'status',
  'applied',
  'client-generated create is accepted at revision zero'
);

select is(
  public.apply_sync_probe_mutation(
    '20000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001',
    1,
    '{"title":"Owner A edit"}'::jsonb
  )->>'revision',
  '2',
  'revision-checked update advances the record revision'
);

select is(
  public.apply_sync_probe_mutation(
    '20000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001',
    1,
    '{"title":"Owner A edit"}'::jsonb
  )->>'revision',
  '2',
  'replaying the same mutation ID returns its original acknowledgement'
);

select is(
  public.apply_sync_probe_mutation(
    '20000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001',
    1,
    '{"title":"Stale offline edit"}'::jsonb
  )->>'status',
  'conflict',
  'stale revision is surfaced as a conflict without overwriting the remote value'
);

select is((select count(*)::integer from public.sync_probe_records), 1, 'owner can read their own record');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.sync_probe_records), 0, 'another owner cannot read that record');
select is(
  public.apply_sync_probe_mutation(
    '20000000-0000-4000-8000-000000000004',
    '30000000-0000-4000-8000-000000000001',
    2,
    '{"title":"Unauthorized edit"}'::jsonb
  )->>'status',
  'not_found',
  'mutation RPC does not disclose or change another owner record'
);

select * from finish();
rollback;
