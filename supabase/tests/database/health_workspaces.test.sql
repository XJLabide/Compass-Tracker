begin;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password)
values
  ('16000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'health-a@example.test', ''),
  ('16000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'health-b@example.test', '');

select ok((select relrowsecurity from pg_class where oid = 'public.fitness_exercises'::regclass), 'fitness exercises use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.strength_programs'::regclass), 'strength programs use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.workout_logs'::regclass), 'workout logs use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.fitness_activity_logs'::regclass), 'manual fitness activity logs use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.nutrition_targets'::regclass), 'nutrition targets use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.meal_templates'::regclass), 'meal templates use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.meal_logs'::regclass), 'meal logs use RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.nutrition_checkins'::regclass), 'nutrition check-ins use RLS');

set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ insert into public.fitness_exercises (id, user_id, name)
     values ('26000000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000001','Direct') $$,
  '42501', null, 'authenticated users cannot directly write fitness records'
);
select throws_ok(
  $$ insert into public.meal_templates (id, user_id, name, meal_type)
     values ('26000000-0000-4000-8000-000000000002','16000000-0000-4000-8000-000000000001','Direct','breakfast') $$,
  '42501', null, 'authenticated users cannot directly write nutrition records'
);

select is(
  public.apply_fitness_mutation(
    '36000000-0000-4000-8000-000000000001', 'fitness_exercise',
    '46000000-0000-4000-8000-000000000001', 0,
    '{"name":"Back Squat","category":"strength","load_unit":"kg"}'::jsonb
  )->>'status', 'applied', 'users can create a strength exercise through the fitness RPC'
);
select is(
  public.apply_fitness_mutation(
    '36000000-0000-4000-8000-000000000002', 'strength_program',
    '46000000-0000-4000-8000-000000000002', 0,
    '{"title":"Lower Body","notes":"Two day lower split","status":"active"}'::jsonb
  )->>'status', 'applied', 'users can create a strength program'
);
select is(
  public.apply_fitness_mutation(
    '36000000-0000-4000-8000-000000000003', 'strength_program_day',
    '46000000-0000-4000-8000-000000000003', 0,
    '{"program_id":"46000000-0000-4000-8000-000000000002","title":"Lower A","weekday":1,"sort_order":0}'::jsonb
  )->>'status', 'applied', 'users can create a dated strength day template'
);
select is(
  public.apply_fitness_mutation(
    '36000000-0000-4000-8000-000000000004', 'strength_program_exercise',
    '46000000-0000-4000-8000-000000000004', 0,
    '{"program_day_id":"46000000-0000-4000-8000-000000000003","exercise_id":"46000000-0000-4000-8000-000000000001","target_sets":3,"target_reps":5,"target_weight":80,"weight_unit":"kg","sort_order":0}'::jsonb
  )->>'status', 'applied', 'program exercises snapshot the source exercise name'
);
select is(
  (select exercise_name from public.strength_program_exercises where id = '46000000-0000-4000-8000-000000000004'),
  'Back Squat', 'program exercise keeps copied source name'
);
select is(
  public.apply_fitness_mutation(
    '36000000-0000-4000-8000-000000000005', 'strength_override',
    '46000000-0000-4000-8000-000000000005', 0,
    '{"program_day_id":"46000000-0000-4000-8000-000000000003","local_date":"2026-10-14","title":"Lower A Deload","notes":"Move gently","skipped":false}'::jsonb
  )->>'status', 'applied', 'users can apply a date-specific strength override'
);
select is(
  public.apply_fitness_mutation(
    '36000000-0000-4000-8000-000000000006', 'workout_log',
    '46000000-0000-4000-8000-000000000006', 0,
    '{"program_id":"46000000-0000-4000-8000-000000000002","program_day_id":"46000000-0000-4000-8000-000000000003","local_date":"2026-10-14","timezone":"Asia/Manila","completed_at":"2026-10-14T10:00:00Z","exercises":[{"exercise_id":"46000000-0000-4000-8000-000000000001","exercise_name":"Back Squat","sets":[{"weight":80,"reps":5},{"weight":90,"reps":3}]}]}'::jsonb
  )->>'status', 'applied', 'logged workouts store copied exercise set snapshots'
);
select is(
  (select title_snapshot from public.workout_logs where id = '46000000-0000-4000-8000-000000000006'),
  'Lower A Deload', 'workout title snapshot is copied from the date override'
);
select is(
  public.apply_fitness_mutation(
    '36000000-0000-4000-8000-000000000001', 'fitness_exercise',
    '46000000-0000-4000-8000-000000000001', 0,
    '{"name":"Back Squat","category":"strength","load_unit":"kg"}'::jsonb
  )->>'revision', '1', 'replaying a fitness mutation returns the original receipt'
);
select is(
  public.apply_fitness_mutation(
    '36000000-0000-4000-8000-000000000007', 'fitness_exercise',
    '46000000-0000-4000-8000-000000000001', 0,
    '{"name":"High Bar Squat"}'::jsonb
  )->>'status', 'conflict', 'duplicate create with a fresh mutation ID returns a conflict'
);
select is(
  public.apply_fitness_mutation(
    '36000000-0000-4000-8000-000000000008', 'fitness_exercise',
    '46000000-0000-4000-8000-000000000001', 1,
    '{"name":"High Bar Squat"}'::jsonb
  )->>'revision', '2', 'expected-revision fitness update advances the revision'
);
select is(
  public.apply_fitness_mutation(
    '36000000-0000-4000-8000-000000000009', 'fitness_exercise',
    '46000000-0000-4000-8000-000000000001', 1,
    '{"name":"Stale Squat"}'::jsonb
  )->>'status', 'conflict', 'stale fitness updates return optimistic conflicts'
);
select is(
  (select count(*)::integer from public.record_versions where owner_id = '16000000-0000-4000-8000-000000000001' and record_type = 'fitness_exercises'),
  1, 'fitness updates write recovery snapshots'
);
select is(
  public.apply_fitness_mutation(
    '36000000-0000-4000-8000-000000000010', 'fitness_activity_log',
    '46000000-0000-4000-8000-000000000007', 0,
    '{"activity_kind":"sport","local_date":"2026-10-14","title":"Pickleball","sport":"pickleball","duration_minutes":75,"intensity":"moderate","notes":"Doubles"}'::jsonb
  )->>'status', 'applied', 'users can manually log quick sports sessions without a provider'
);
select is(
  (select estimated_one_rep_max::text from public.fitness_exercise_set_history where workout_id = '46000000-0000-4000-8000-000000000006' and weight = 90 and reps = 3),
  '99.00', 'e1RM history derives from logged workout set values'
);

select is(
  public.apply_nutrition_mutation(
    '37000000-0000-4000-8000-000000000001', 'nutrition_target',
    '47000000-0000-4000-8000-000000000001', 0,
    '{"calories":2200,"protein_g":150,"carbs_g":250,"fat_g":70,"effective_from":"2026-10-01"}'::jsonb
  )->>'status', 'applied', 'users can configure nutrition targets'
);
select is(
  public.apply_nutrition_mutation(
    '37000000-0000-4000-8000-000000000002', 'meal_template',
    '47000000-0000-4000-8000-000000000002', 0,
    '{"name":"Chicken Bowl","meal_type":"lunch","notes":"Batch cook","active":true}'::jsonb
  )->>'status', 'applied', 'users can create meal templates'
);
select is(
  public.apply_nutrition_mutation(
    '37000000-0000-4000-8000-000000000003', 'meal_template_item',
    '47000000-0000-4000-8000-000000000003', 0,
    '{"template_id":"47000000-0000-4000-8000-000000000002","name":"Chicken","quantity":150,"unit":"g","calories":240,"protein_g":45,"carbs_g":0,"fat_g":5,"sort_order":0}'::jsonb
  )->>'status', 'applied', 'users can add measured ingredients to a meal template'
);
select is(
  public.apply_nutrition_mutation(
    '37000000-0000-4000-8000-000000000004', 'meal_template_item',
    '47000000-0000-4000-8000-000000000004', 0,
    '{"template_id":"47000000-0000-4000-8000-000000000002","name":"Rice","quantity":200,"unit":"g","calories":260,"protein_g":5,"carbs_g":56,"fat_g":1,"sort_order":1}'::jsonb
  )->>'status', 'applied', 'users can add a second ingredient'
);
select is(
  public.apply_nutrition_mutation(
    '37000000-0000-4000-8000-000000000005', 'meal_log',
    '47000000-0000-4000-8000-000000000005', 0,
    '{"template_id":"47000000-0000-4000-8000-000000000002","servings":1.5,"local_date":"2026-10-14","logged_at":"2026-10-14T04:00:00Z","meal_type":"lunch"}'::jsonb
  )->>'status', 'applied', 'meal logs can build an immutable scaled snapshot from a template'
);
select is(
  (select snapshot #>> '{totals,calories}' from public.meal_logs where id = '47000000-0000-4000-8000-000000000005'),
  '750.00', 'meal log snapshot scales ingredient calories'
);
select is(
  public.apply_nutrition_mutation(
    '37000000-0000-4000-8000-000000000006', 'meal_template_item',
    '47000000-0000-4000-8000-000000000003', 1,
    '{"name":"Lean Chicken","calories":180,"protein_g":48}'::jsonb
  )->>'status', 'applied', 'source meal template items remain editable after logging'
);
select is(
  (select snapshot #>> '{ingredients,0,name}' from public.meal_logs where id = '47000000-0000-4000-8000-000000000005'),
  'Chicken', 'saved meal log keeps the original ingredient name after source item update'
);
select is(
  (select snapshot #>> '{totals,calories}' from public.meal_logs where id = '47000000-0000-4000-8000-000000000005'),
  '750.00', 'saved meal log keeps original macro totals after source item update'
);
select throws_ok(
  $$ update public.meal_logs
     set snapshot = jsonb_set(snapshot, '{template_name}', '"Changed"')
     where id = '47000000-0000-4000-8000-000000000005' $$,
  '42501', null, 'authenticated users cannot directly mutate an immutable meal snapshot'
);
select is(
  public.apply_nutrition_mutation(
    '37000000-0000-4000-8000-000000000007', 'nutrition_checkin',
    '47000000-0000-4000-8000-000000000006', 0,
    '{"local_date":"2026-10-14","energy":4,"appetite":3,"sleep_hours":7.5,"note":"Felt steady"}'::jsonb
  )->>'status', 'applied', 'daily nutrition check-in is optional and can omit body weight'
);
select is(
  public.apply_nutrition_mutation(
    '37000000-0000-4000-8000-000000000008', 'meal_log',
    '47000000-0000-4000-8000-000000000005', 1,
    '{"active":false}'::jsonb
  )->>'revision', '2', 'meal log status updates preserve the immutable snapshot'
);

select set_config('request.jwt.claim.sub', '16000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.fitness_exercises), 0, 'another owner cannot read fitness exercises');
select is((select count(*)::integer from public.workout_logs), 0, 'another owner cannot read workout logs');
select is((select count(*)::integer from public.meal_templates), 0, 'another owner cannot read meal templates');
select is((select count(*)::integer from public.meal_logs), 0, 'another owner cannot read meal logs');
select is(
  public.apply_fitness_mutation(
    '36000000-0000-4000-8000-000000000011', 'fitness_exercise',
    '46000000-0000-4000-8000-000000000001', 2,
    '{"name":"Unauthorized edit"}'::jsonb
  )->>'status', 'not_found', 'fitness RPC does not expose another owner record'
);
select is(
  public.apply_nutrition_mutation(
    '37000000-0000-4000-8000-000000000009', 'meal_template',
    '47000000-0000-4000-8000-000000000002', 1,
    '{"name":"Unauthorized meal"}'::jsonb
  )->>'status', 'not_found', 'nutrition RPC does not expose another owner record'
);

select * from finish();
rollback;
