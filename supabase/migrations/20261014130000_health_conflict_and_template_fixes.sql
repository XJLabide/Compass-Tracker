-- Keep already-applied health RPCs append-only while tightening sync responses
-- and adding recoverable template-item archival.
alter function public.apply_fitness_mutation(uuid, text, uuid, integer, jsonb)
  rename to apply_fitness_mutation_once;
alter function public.apply_nutrition_mutation(uuid, text, uuid, integer, jsonb)
  rename to apply_nutrition_mutation_once;
revoke all on function public.apply_fitness_mutation_once(uuid, text, uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.apply_nutrition_mutation_once(uuid, text, uuid, integer, jsonb) from public, anon, authenticated;

alter table public.meal_template_items
  add column is_archived boolean not null default false;
create index meal_template_items_active_by_template
  on public.meal_template_items (user_id, template_id, sort_order) where not is_archived;

create or replace function public.build_meal_log_snapshot(
  p_user_id uuid,
  p_template_id uuid,
  p_servings numeric
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_template public.meal_templates%rowtype;
  v_items jsonb;
  v_servings numeric := coalesce(p_servings, 1);
begin
  if v_servings <= 0 then raise exception 'Serving count must be greater than zero' using errcode = '22023'; end if;
  select * into v_template from public.meal_templates
    where id = p_template_id and user_id = p_user_id and active;
  if not found then raise exception 'Meal template not found' using errcode = 'P0002'; end if;
  select jsonb_agg(jsonb_build_object(
    'id', id,
    'name', name,
    'quantity', round(quantity * v_servings, 2),
    'unit', unit,
    'calories', round(calories * v_servings, 2),
    'protein_g', round(protein_g * v_servings, 2),
    'carbs_g', round(carbs_g * v_servings, 2),
    'fat_g', round(fat_g * v_servings, 2)
  ) order by sort_order, name) into v_items
  from public.meal_template_items
  where template_id = p_template_id and user_id = p_user_id and not is_archived;
  if coalesce(jsonb_array_length(v_items), 0) = 0 then
    raise exception 'Add at least one ingredient' using errcode = '23514';
  end if;
  return jsonb_build_object(
    'template_id', v_template.id,
    'template_name', v_template.name,
    'servings', round(v_servings, 2),
    'ingredients', v_items,
    'totals', jsonb_build_object(
      'calories', (select coalesce(round(sum((item ->> 'calories')::numeric), 2), 0) from jsonb_array_elements(v_items) item),
      'protein_g', (select coalesce(round(sum((item ->> 'protein_g')::numeric), 2), 0) from jsonb_array_elements(v_items) item),
      'carbs_g', (select coalesce(round(sum((item ->> 'carbs_g')::numeric), 2), 0) from jsonb_array_elements(v_items) item),
      'fat_g', (select coalesce(round(sum((item ->> 'fat_g')::numeric), 2), 0) from jsonb_array_elements(v_items) item)
    )
  );
end;
$$;

create or replace function public.validate_logged_strength_exercises(p_exercises jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_exercise jsonb;
  v_set jsonb;
begin
  if jsonb_typeof(p_exercises) is distinct from 'array' then
    raise exception 'Workout exercises must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_exercises) = 0 then
    raise exception 'A logged workout needs at least one exercise' using errcode = '23514';
  end if;
  for v_exercise in select value from jsonb_array_elements(p_exercises) loop
    if nullif(trim(v_exercise ->> 'exercise_id'), '') is null
      or nullif(trim(v_exercise ->> 'exercise_name'), '') is null
      or jsonb_typeof(v_exercise -> 'sets') is distinct from 'array'
      or jsonb_array_length(v_exercise -> 'sets') = 0 then
      raise exception 'Logged exercises need an id, name, and sets' using errcode = '22023';
    end if;
    for v_set in select value from jsonb_array_elements(v_exercise -> 'sets') loop
      if nullif(v_set ->> 'weight', '') is null or nullif(v_set ->> 'reps', '') is null
        or (v_set ->> 'weight')::numeric < 0 or (v_set ->> 'reps')::integer < 1
        or v_set ->> 'weight_unit' not in ('kg', 'lb') then
        raise exception 'Logged sets need a non-negative load, positive reps, and a saved load unit' using errcode = '22023';
      end if;
    end loop;
  end loop;
  return p_exercises;
end;
$$;

create or replace function public.apply_fitness_mutation(
  p_mutation_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_expected_revision integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_result jsonb;
  v_revision integer;
  v_payload jsonb;
begin
  v_result := public.apply_fitness_mutation_once(p_mutation_id, p_entity_type, p_entity_id, p_expected_revision, p_payload);
  if v_result ->> 'status' = 'conflict' and (v_result #>> '{server,revision}') is null then
    if p_entity_type = 'fitness_exercise' then
      select t.revision, to_jsonb(t) into v_revision, v_payload from public.fitness_exercises t
      where t.user_id = v_user_id and (t.id = p_entity_id or t.name = nullif(trim(p_payload ->> 'name'), ''))
      order by (t.id = p_entity_id) desc limit 1;
    elsif p_entity_type = 'strength_program' then
      select t.revision, to_jsonb(t) into v_revision, v_payload from public.strength_programs t where t.id = p_entity_id and t.user_id = v_user_id;
    elsif p_entity_type = 'strength_program_day' then
      select t.revision, to_jsonb(t) into v_revision, v_payload from public.strength_program_days t where t.id = p_entity_id and t.user_id = v_user_id;
    elsif p_entity_type = 'strength_program_exercise' then
      select t.revision, to_jsonb(t) into v_revision, v_payload from public.strength_program_exercises t where t.id = p_entity_id and t.user_id = v_user_id;
    elsif p_entity_type = 'strength_override' then
      select t.revision, to_jsonb(t) into v_revision, v_payload from public.strength_session_overrides t
      where t.user_id = v_user_id and (t.id = p_entity_id or (
        t.program_day_id = nullif(p_payload ->> 'program_day_id', '')::uuid
        and t.local_date = nullif(p_payload ->> 'local_date', '')::date
      )) order by (t.id = p_entity_id) desc limit 1;
    elsif p_entity_type = 'workout_log' then
      select t.revision, to_jsonb(t) into v_revision, v_payload from public.workout_logs t where t.id = p_entity_id and t.user_id = v_user_id;
    elsif p_entity_type = 'fitness_activity_log' then
      select t.revision, to_jsonb(t) into v_revision, v_payload from public.fitness_activity_logs t where t.id = p_entity_id and t.user_id = v_user_id;
    end if;
    v_result := jsonb_set(v_result, '{server}', jsonb_build_object(
      'revision', coalesce(v_revision, 1), 'payload', coalesce(v_payload, '{}'::jsonb)
    ), true);
  end if;
  return v_result;
end;
$$;

create or replace function public.apply_nutrition_mutation(
  p_mutation_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_expected_revision integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_payload_input jsonb := p_payload;
  v_result jsonb;
  v_revision integer;
  v_server_payload jsonb;
begin
  -- Client snapshots are used only by the IndexedDB projection. Persisted meal
  -- logs are rebuilt from the authenticated owner's template and serving count.
  if p_entity_type = 'meal_log' then
    v_payload_input := p_payload - 'snapshot';
  end if;
  v_result := public.apply_nutrition_mutation_once(p_mutation_id, p_entity_type, p_entity_id, p_expected_revision, v_payload_input);
  if v_result ->> 'status' = 'conflict' and (v_result #>> '{server,revision}') is null then
    if p_entity_type = 'nutrition_target' then
      select t.revision, to_jsonb(t) into v_revision, v_server_payload from public.nutrition_targets t
      where t.user_id = v_user_id and (t.id = p_entity_id or t.effective_from = nullif(p_payload ->> 'effective_from', '')::date)
      order by (t.id = p_entity_id) desc limit 1;
    elsif p_entity_type = 'meal_template' then
      select t.revision, to_jsonb(t) into v_revision, v_server_payload from public.meal_templates t where t.id = p_entity_id and t.user_id = v_user_id;
    elsif p_entity_type = 'meal_template_item' then
      select t.revision, to_jsonb(t) into v_revision, v_server_payload from public.meal_template_items t where t.id = p_entity_id and t.user_id = v_user_id;
    elsif p_entity_type = 'meal_log' then
      select t.revision, to_jsonb(t) into v_revision, v_server_payload from public.meal_logs t where t.id = p_entity_id and t.user_id = v_user_id;
    elsif p_entity_type = 'nutrition_checkin' then
      select t.revision, to_jsonb(t) into v_revision, v_server_payload from public.nutrition_checkins t
      where t.user_id = v_user_id and (t.id = p_entity_id or t.local_date = nullif(p_payload ->> 'local_date', '')::date)
      order by (t.id = p_entity_id) desc limit 1;
    end if;
    v_result := jsonb_set(v_result, '{server}', jsonb_build_object(
      'revision', coalesce(v_revision, 1), 'payload', coalesce(v_server_payload, '{}'::jsonb)
    ), true);
  end if;
  return v_result;
end;
$$;

create or replace function public.archive_meal_template_item(
  p_mutation_id uuid,
  p_item_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_item public.meal_template_items%rowtype;
  v_receipt jsonb;
  v_response jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_mutation_id is null or p_item_id is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Invalid meal ingredient archive mutation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select response into v_receipt from public.sync_mutation_receipts where owner_id = v_user_id and mutation_id = p_mutation_id;
  if found then return v_receipt; end if;
  select * into v_item from public.meal_template_items where id = p_item_id and user_id = v_user_id for update;
  if not found then
    v_response := jsonb_build_object('status', 'not_found');
  elsif v_item.revision <> p_expected_revision then
    v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object(
      'revision', v_item.revision, 'payload', to_jsonb(v_item)));
  else
    update public.meal_template_items set is_archived = true
      where id = p_item_id and user_id = v_user_id returning * into v_item;
    v_response := jsonb_build_object('status', 'applied', 'revision', v_item.revision, 'record', to_jsonb(v_item));
  end if;
  insert into public.sync_mutation_receipts (owner_id, mutation_id, response) values (v_user_id, p_mutation_id, v_response);
  return v_response;
end;
$$;

revoke all on function public.apply_fitness_mutation(uuid, text, uuid, integer, jsonb) from public, anon;
revoke all on function public.apply_nutrition_mutation(uuid, text, uuid, integer, jsonb) from public, anon;
revoke all on function public.archive_meal_template_item(uuid, uuid, integer) from public, anon;
grant execute on function public.apply_fitness_mutation(uuid, text, uuid, integer, jsonb) to authenticated;
grant execute on function public.apply_nutrition_mutation(uuid, text, uuid, integer, jsonb) to authenticated;
grant execute on function public.archive_meal_template_item(uuid, uuid, integer) to authenticated;
revoke all on function public.validate_logged_strength_exercises(jsonb) from public, anon;
