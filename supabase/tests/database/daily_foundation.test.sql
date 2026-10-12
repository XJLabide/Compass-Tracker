begin;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password)
values
  ('11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'daily-a@example.test', ''),
  ('11000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'daily-b@example.test', '');

select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'profiles use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.daily_plans'::regclass), 'daily plans use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.priorities'::regclass), 'priorities use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.tasks'::regclass), 'tasks use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.priority_task_links'::regclass), 'priority links use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.routines'::regclass), 'routines use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.routine_logs'::regclass), 'routine logs use RLS');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);

select is((select count(*)::integer from public.profiles), 1, 'new auth users receive a default profile');

select is(
  public.apply_daily_mutation(
    '21000000-0000-4000-8000-000000000001', 'daily_plan',
    '31000000-0000-4000-8000-000000000001', 0, 'upsert',
    '{"local_date":"2026-10-12","timezone":"Asia/Manila","status":"active"}'::jsonb
  )->>'status', 'applied', 'today plan is created as a separate owner-scoped record'
);

select is(
  public.apply_daily_mutation(
    '21000000-0000-4000-8000-000000000002', 'daily_plan',
    '31000000-0000-4000-8000-000000000002', 0, 'upsert',
    '{"local_date":"2026-10-13","timezone":"Asia/Manila","status":"draft"}'::jsonb
  )->>'status', 'applied', 'future plans can be saved as drafts'
);
select is(
  (select status from public.daily_plans where id = '31000000-0000-4000-8000-000000000001'),
  'active', 'saving a future draft leaves today active'
);

select is(
  public.apply_daily_mutation(
    '21000000-0000-4000-8000-000000000003', 'priority',
    '41000000-0000-4000-8000-000000000001', 0, 'upsert',
    '{"daily_plan_id":"31000000-0000-4000-8000-000000000001","rank":1,"title":"Send the draft"}'::jsonb
  )->>'status', 'applied', 'a plan accepts its first ranked priority'
);
select is(
  public.apply_daily_mutation(
    '21000000-0000-4000-8000-000000000004', 'priority',
    '41000000-0000-4000-8000-000000000002', 0, 'upsert',
    '{"daily_plan_id":"31000000-0000-4000-8000-000000000001","rank":2,"title":"Move with intention"}'::jsonb
  )->>'status', 'applied', 'a plan accepts a second ranked priority'
);
select is(
  public.apply_daily_mutation(
    '21000000-0000-4000-8000-000000000005', 'priority',
    '41000000-0000-4000-8000-000000000003', 0, 'upsert',
    '{"daily_plan_id":"31000000-0000-4000-8000-000000000001","rank":3,"title":"Make a call"}'::jsonb
  )->>'status', 'applied', 'a plan accepts a third ranked priority'
);
select throws_ok(
  $$ select public.apply_daily_mutation(
    '21000000-0000-4000-8000-000000000006', 'priority',
    '41000000-0000-4000-8000-000000000004', 0, 'upsert',
    '{"daily_plan_id":"31000000-0000-4000-8000-000000000001","rank":1,"title":"A fourth priority"}'::jsonb
  ) $$,
  '23514', 'A daily plan can contain at most three active priorities',
  'the server enforces the three-priority limit'
);

select is(
  public.apply_daily_mutation(
    '21000000-0000-4000-8000-000000000007', 'task',
    '51000000-0000-4000-8000-000000000001', 0, 'upsert',
    '{"title":"Outline the proposal","due_date":"2026-10-12","status":"open"}'::jsonb
  )->>'status', 'applied', 'a finite task is created with a local-date due date'
);
select is(
  public.apply_daily_mutation(
    '21000000-0000-4000-8000-000000000008', 'priority_task_link',
    '61000000-0000-4000-8000-000000000001', 0, 'link',
    '{"priority_id":"41000000-0000-4000-8000-000000000001","task_id":"51000000-0000-4000-8000-000000000001"}'::jsonb
  )->>'status', 'applied', 'a priority can link to a supporting task'
);
select is(
  public.apply_daily_mutation(
    '21000000-0000-4000-8000-000000000009', 'task',
    '51000000-0000-4000-8000-000000000001', 1, 'upsert',
    '{"status":"done"}'::jsonb
  )->>'revision', '2', 'task completion advances its revision'
);
select is(
  (select outcome from public.priorities where id = '41000000-0000-4000-8000-000000000001'),
  null, 'task completion never assigns a priority outcome'
);

select is(
  public.apply_daily_mutation(
    '21000000-0000-4000-8000-000000000010', 'routine',
    '71000000-0000-4000-8000-000000000001', 0, 'upsert',
    '{"title":"A few minutes of stretching","days_of_week":[1,3,5],"time_label":"Morning"}'::jsonb
  )->>'status', 'applied', 'routines save a weekday schedule and optional time label'
);
select is(
  public.apply_daily_mutation(
    '21000000-0000-4000-8000-000000000011', 'routine_log',
    '81000000-0000-4000-8000-000000000001', 0, 'upsert',
    '{"routine_id":"71000000-0000-4000-8000-000000000001","local_date":"2026-10-12","completed":true}'::jsonb
  )->>'status', 'applied', 'routine completion is a dated check-in'
);

select throws_ok(
  $$ select public.finish_daily_plan(
    '22000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 1,
    '[]'::jsonb, null, '[]'::jsonb
  ) $$,
  '23514', 'Choose one outcome for every priority before ending the day',
  'End Day requires a user-selected outcome for each priority'
);

select is(
  public.finish_daily_plan(
    '22000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000001', 1,
    '[{"priority_id":"41000000-0000-4000-8000-000000000001","outcome":"done"},{"priority_id":"41000000-0000-4000-8000-000000000002","outcome":"partly_done"},{"priority_id":"41000000-0000-4000-8000-000000000003","outcome":"not_done"}]'::jsonb,
    'Good progress today.',
    '[{"source_priority_id":"41000000-0000-4000-8000-000000000002","new_priority_id":"41000000-0000-4000-8000-000000000005"}]'::jsonb
  )->>'status', 'applied', 'End Day saves review and only the explicitly selected carry-forward'
);
select is(
  (select status from public.daily_plans where id = '31000000-0000-4000-8000-000000000001'),
  'ended', 'End Day closes the reviewed plan'
);
select is(
  (select title from public.priorities where id = '41000000-0000-4000-8000-000000000005'),
  'Move with intention', 'selected carry-forward is copied as a new next-day priority'
);
select is(
  (select outcome from public.priorities where id = '41000000-0000-4000-8000-000000000001'),
  'done', 'priority outcome is saved from the explicit review input'
);
select is(
  public.finish_daily_plan(
    '22000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000001', 1,
    '[]'::jsonb, null, '[]'::jsonb
  )->>'status', 'applied', 'replaying End Day with the same receipt is idempotent'
);

select is(
  public.finish_daily_plan(
    '22000000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000001', 1,
    '[]'::jsonb, null, '[]'::jsonb
  ) #>> '{server,revision}', '2', 'End Day conflict response is recorded at the observed revision'
);
select is(
  public.apply_daily_mutation(
    '21000000-0000-4000-8000-000000000013', 'daily_plan',
    '31000000-0000-4000-8000-000000000001', 2, 'upsert',
    '{"status":"backfill"}'::jsonb
  )->>'revision', '3', 'plan can advance after the conflict receipt is written'
);
select is(
  public.finish_daily_plan(
    '22000000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000001', 1,
    '[]'::jsonb, null, '[]'::jsonb
  ) #>> '{server,revision}', '2', 'replaying End Day conflict returns the original response'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.daily_plans), 0, 'another owner cannot read these daily plans');
select is((select count(*)::integer from public.tasks), 0, 'another owner cannot read these tasks');
select is((select count(*)::integer from public.routines), 0, 'another owner cannot read these routines');
select is(
  public.apply_daily_mutation(
    '21000000-0000-4000-8000-000000000012', 'task',
    '51000000-0000-4000-8000-000000000001', 2, 'upsert',
    '{"title":"Unauthorized edit"}'::jsonb
  )->>'status', 'not_found', 'another owner cannot mutate the task'
);

select * from finish();
rollback;
