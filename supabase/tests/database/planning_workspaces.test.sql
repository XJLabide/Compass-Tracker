begin;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password)
values
  ('12000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'planning-a@example.test', ''),
  ('12000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'planning-b@example.test', '');

select ok((select relrowsecurity from pg_class where oid = 'public.calendar_events'::regclass), 'local calendar events use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.projects'::regclass), 'projects use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.project_stages'::regclass), 'project stages use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.project_task_links'::regclass), 'project task links use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.life_areas'::regclass), 'life areas use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.goals'::regclass), 'goals use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.goal_updates'::regclass), 'goal progress updates use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.goal_project_links'::regclass), 'goal project links use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.external_calendars'::regclass), 'external calendar choices use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.external_calendar_events'::regclass), 'imported calendar events use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.calendar_connections'::regclass), 'calendar credential envelopes use RLS');
select ok(not has_function_privilege('authenticated', 'public.import_google_calendar_events(uuid,uuid[],jsonb,timestamptz,timestamptz)', 'execute'), 'authenticated clients cannot write imported event snapshots');
select ok(not has_function_privilege('authenticated', 'public.read_google_calendar_connection(uuid)', 'execute'), 'authenticated clients cannot read encrypted provider credentials');
select ok(not has_function_privilege('authenticated', 'public.save_google_calendar_selection(uuid,jsonb)', 'execute'), 'authenticated clients cannot write provider selection state directly');
select ok(has_function_privilege('service_role', 'public.import_google_calendar_events(uuid,uuid[],jsonb,timestamptz,timestamptz)', 'execute'), 'server integration can reconcile imported events');

set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000001', true);

select is(
  public.apply_calendar_mutation(
    '22000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', 0,
    '{"title":"Weekly planning","description":"Prepare next week","starts_at":"2026-10-12T01:00:00Z","ends_at":"2026-10-12T01:30:00Z","time_zone":"Asia/Manila"}'::jsonb
  )->>'status', 'applied', 'a timed calendar event is stored independently from task due dates'
);
select is((select count(*)::integer from public.tasks), 0, 'creating a timed event does not create a due-date task');

select is(
  public.apply_daily_mutation(
    '23000000-0000-4000-8000-000000000001', 'task',
    '33000000-0000-4000-8000-000000000001', 0, 'upsert',
    '{"title":"Send the agenda","due_date":"2026-10-12","status":"open"}'::jsonb
  )->>'status', 'applied', 'a date-only due task remains in the task store'
);

select is(
  public.apply_project_mutation(
    '24000000-0000-4000-8000-000000000001', 'project', '34000000-0000-4000-8000-000000000001', 0,
    '{"title":"Compass launch","description":"Ship the first release","status":"active","stages":[{"id":"35000000-0000-4000-8000-000000000001","name":"Plan","sort_order":0},{"id":"35000000-0000-4000-8000-000000000002","name":"Build","sort_order":1},{"id":"35000000-0000-4000-8000-000000000003","name":"Done","sort_order":2,"is_complete":true}]}'::jsonb
  )->>'status', 'applied', 'a project and its configurable stages are created atomically'
);
select is((select count(*)::integer from public.project_stages where project_id = '34000000-0000-4000-8000-000000000001'), 3, 'project stores its three ordered stages');
select is(
  public.apply_project_mutation(
    '24000000-0000-4000-8000-000000000002', 'project_task_link', '36000000-0000-4000-8000-000000000001', 0,
    '{"project_id":"34000000-0000-4000-8000-000000000001","task_id":"33000000-0000-4000-8000-000000000001","stage_id":"35000000-0000-4000-8000-000000000001","sort_order":0}'::jsonb
  )->>'status', 'applied', 'a project board links to the existing shared task record'
);
select is((select count(*)::integer from public.tasks where id = '33000000-0000-4000-8000-000000000001'), 1, 'linking a task to a project does not clone it');

select is(
  public.apply_goal_mutation(
    '25000000-0000-4000-8000-000000000001', 'life_area', '37000000-0000-4000-8000-000000000001', 0,
    '{"name":"Learning","sort_order":0}'::jsonb
  )->>'status', 'applied', 'users can create an editable life area'
);
select is(
  public.apply_goal_mutation(
    '25000000-0000-4000-8000-000000000002', 'goal', '38000000-0000-4000-8000-000000000001', 0,
    '{"title":"Read twelve books","kind":"measurable","status":"active","life_area_id":"37000000-0000-4000-8000-000000000001","baseline_value":0,"target_value":12,"target_unit":"books","direction":"increase"}'::jsonb
  )->>'status', 'applied', 'users can create a measurable goal'
);
select is(
  public.apply_goal_mutation(
    '25000000-0000-4000-8000-000000000003', 'goal_update', '39000000-0000-4000-8000-000000000001', 0,
    '{"goal_id":"38000000-0000-4000-8000-000000000001","value":2,"unit":"books","source":"Manual check-in","measured_at":"2026-10-12T08:00:00Z"}'::jsonb
  )->>'status', 'applied', 'goal updates retain the measured value, unit, time, and source'
);
select is((select source from public.goal_updates where id = '39000000-0000-4000-8000-000000000001'), 'Manual check-in', 'goal trend values keep their source');
select is(
  public.apply_goal_mutation(
    '25000000-0000-4000-8000-000000000004', 'goal', '38000000-0000-4000-8000-000000000002', 0,
    '{"title":"Be more present","kind":"qualitative","status":"active"}'::jsonb
  )->>'status', 'applied', 'users can create a qualitative goal without numeric targets'
);
select throws_ok(
  $$ select public.apply_goal_mutation(
    '25000000-0000-4000-8000-000000000005', 'goal_update', '39000000-0000-4000-8000-000000000002', 0,
    '{"goal_id":"38000000-0000-4000-8000-000000000001","value":3,"unit":"hours","source":"Timer"}'::jsonb
  ) $$,
  '23514', 'A measurable update needs a value in the goal unit',
  'measurable progress enforces the goal unit'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  public.save_google_calendar_selection('12000000-0000-4000-8000-000000000001', '[{"id":"41000000-0000-4000-8000-000000000001","provider_calendar_id":"primary","name":"Personal","time_zone":"Asia/Manila","selected":true},{"id":"41000000-0000-4000-8000-000000000002","provider_calendar_id":"shared","name":"Shared","time_zone":"Asia/Manila","selected":false}]'::jsonb)->>'saved',
  'true', 'calendar selection is stored server-side after provider validation'
);
select throws_ok(
  $$ select public.import_google_calendar_events('12000000-0000-4000-8000-000000000001', array['41000000-0000-4000-8000-000000000002'::uuid], '[{"external_calendar_id":"41000000-0000-4000-8000-000000000002","provider_event_id":"unselected-event","title":"Unselected event","starts_at":"2026-10-12T02:00:00Z","ends_at":"2026-10-12T02:30:00Z","time_zone":"Asia/Manila"}]'::jsonb, '2026-10-12T00:00:00Z', '2026-10-13T00:00:00Z') $$,
  '42501', 'Only selected calendars can be imported',
  'server import rejects calendars outside the explicit selected set'
);
select is(
  public.import_google_calendar_events('12000000-0000-4000-8000-000000000001', array['41000000-0000-4000-8000-000000000001'::uuid], '[{"external_calendar_id":"41000000-0000-4000-8000-000000000001","provider_event_id":"google-event-1","title":"External planning","starts_at":"2026-10-12T02:00:00Z","ends_at":"2026-10-12T02:30:00Z","time_zone":"Asia/Manila"}]'::jsonb, '2026-10-12T00:00:00Z', '2026-10-13T00:00:00Z')->>'imported',
  '1', 'selected external events can be imported as read-only snapshots'
);
select is(
  public.import_google_calendar_events('12000000-0000-4000-8000-000000000001', array['41000000-0000-4000-8000-000000000001'::uuid], '[]'::jsonb, '2026-10-12T00:00:00Z', '2026-10-13T00:00:00Z')->>'imported',
  '0', 'an empty provider response removes deleted or moved events from the imported range'
);
select is((select count(*)::integer from public.external_calendar_events), 0, 'stale external event snapshots are removed');
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ insert into public.external_calendar_events (id, user_id, external_calendar_id, provider_event_id, title, starts_at, ends_at, time_zone)
     values ('42000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','direct-write','Write','2026-10-12T00:00Z','2026-10-12T01:00Z','UTC') $$,
  '42501', null, 'authenticated users cannot directly edit imported calendar snapshots'
);

select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.calendar_events), 0, 'another owner cannot read local calendar events');
select is((select count(*)::integer from public.projects), 0, 'another owner cannot read projects');
select is((select count(*)::integer from public.project_task_links), 0, 'another owner cannot read project task links');
select is((select count(*)::integer from public.goals), 0, 'another owner cannot read goals');
select is((select count(*)::integer from public.goal_updates), 0, 'another owner cannot read goal updates');
select is((select count(*)::integer from public.external_calendar_events), 0, 'another owner cannot read imported calendar events');
select is(
  public.apply_daily_mutation(
    '23000000-0000-4000-8000-000000000002', 'task',
    '33000000-0000-4000-8000-000000000002', 0, 'upsert',
    '{"title":"Owner B task","status":"open"}'::jsonb
  )->>'status', 'applied', 'another owner can create a separate task record'
);
select is(
  public.apply_calendar_mutation(
    '22000000-0000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000001', 1,
    '{"title":"Unauthorized"}'::jsonb
  )->>'status', 'not_found', 'another owner cannot mutate a calendar event'
);
select throws_ok(
  $$ select public.apply_project_mutation(
    '24000000-0000-4000-8000-000000000003', 'project_task_link', '36000000-0000-4000-8000-000000000002', 0,
    '{"project_id":"34000000-0000-4000-8000-000000000001","task_id":"33000000-0000-4000-8000-000000000002","stage_id":"35000000-0000-4000-8000-000000000001"}'::jsonb
  ) $$,
  '23503', null, 'another owner cannot link a task to a foreign project'
);
select throws_ok(
  $$ select public.apply_goal_mutation(
    '25000000-0000-4000-8000-000000000006', 'goal_project_link', '39000000-0000-4000-8000-000000000003', 0,
    '{"goal_id":"38000000-0000-4000-8000-000000000001","project_id":"34000000-0000-4000-8000-000000000001"}'::jsonb
  ) $$,
  '23503', null, 'another owner cannot link a goal to a foreign project'
);

select * from finish();
rollback;
