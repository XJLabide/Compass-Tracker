create table public.fitness_exercises (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  category text,
  load_unit text not null default 'kg' check (load_unit in ('kg', 'lb')),
  is_archived boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, name)
);
create index fitness_exercises_by_owner on public.fitness_exercises (user_id, is_archived, name);

create table public.strength_programs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  notes text,
  status text not null default 'active' check (status in ('active', 'archived')),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index strength_programs_by_owner_status on public.strength_programs (user_id, status, title);

create table public.strength_program_days (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  program_id uuid not null,
  title text not null check (length(trim(title)) > 0),
  weekday smallint check (weekday between 1 and 7),
  sort_order integer not null default 0,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (program_id, user_id) references public.strength_programs (id, user_id) on delete cascade,
  unique (id, user_id),
  unique (id, program_id, user_id)
);
create index strength_program_days_by_program on public.strength_program_days (user_id, program_id, sort_order);

create table public.strength_program_exercises (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  program_day_id uuid not null,
  exercise_id uuid not null,
  exercise_name text not null check (length(trim(exercise_name)) > 0),
  target_sets integer not null check (target_sets > 0),
  target_reps integer not null check (target_reps > 0),
  target_weight numeric,
  weight_unit text not null default 'kg' check (weight_unit in ('kg', 'lb')),
  sort_order integer not null default 0,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (exercise_id, user_id) references public.fitness_exercises (id, user_id) on delete restrict,
  foreign key (program_day_id, user_id) references public.strength_program_days (id, user_id) on delete cascade,
  unique (id, user_id)
);
create index strength_program_exercises_by_day on public.strength_program_exercises (user_id, program_day_id, sort_order);

create table public.strength_session_overrides (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  program_day_id uuid not null,
  local_date date not null,
  title text,
  notes text,
  skipped boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (program_day_id, user_id) references public.strength_program_days (id, user_id) on delete cascade,
  unique (user_id, program_day_id, local_date),
  unique (id, user_id)
);
create index strength_session_overrides_by_date on public.strength_session_overrides (user_id, local_date, program_day_id);

create table public.workout_logs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  program_id uuid,
  program_day_id uuid,
  local_date date not null,
  timezone text not null check (timezone <> ''),
  title_snapshot text not null check (length(trim(title_snapshot)) > 0),
  completed_at timestamptz not null,
  notes text,
  exercises jsonb not null check (jsonb_typeof(exercises) = 'array'),
  status text not null default 'logged' check (status in ('logged', 'void')),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (program_id, user_id) references public.strength_programs (id, user_id) on delete set null (program_id),
  foreign key (program_day_id, user_id) references public.strength_program_days (id, user_id) on delete set null (program_day_id),
  unique (id, user_id)
);
create index workout_logs_by_date on public.workout_logs (user_id, local_date desc, completed_at desc) where status = 'logged';

create table public.fitness_activity_logs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  activity_kind text not null check (activity_kind in ('run', 'sport')),
  local_date date not null,
  title text not null check (length(trim(title)) > 0),
  sport text,
  duration_minutes numeric not null check (duration_minutes > 0),
  distance numeric check (distance is null or distance >= 0),
  distance_unit text check (distance_unit is null or distance_unit in ('km', 'mi')),
  intensity text check (intensity is null or intensity in ('easy', 'moderate', 'hard')),
  notes text,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((activity_kind = 'run' and sport is null) or (activity_kind = 'sport' and sport is not null)),
  check ((distance is null and distance_unit is null) or (distance is not null and distance_unit is not null)),
  unique (id, user_id)
);
create index fitness_activity_logs_by_date on public.fitness_activity_logs (user_id, local_date desc);

create table public.nutrition_targets (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  calories integer not null check (calories > 0),
  protein_g numeric not null check (protein_g >= 0),
  carbs_g numeric not null check (carbs_g >= 0),
  fat_g numeric not null check (fat_g >= 0),
  effective_from date not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, effective_from),
  unique (id, user_id)
);
create index nutrition_targets_by_effective_date on public.nutrition_targets (user_id, effective_from desc);

create table public.meal_templates (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  notes text,
  active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index meal_templates_by_owner on public.meal_templates (user_id, active, name);

create table public.meal_template_items (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  template_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  quantity numeric not null check (quantity > 0),
  unit text not null check (length(trim(unit)) > 0),
  calories numeric not null check (calories >= 0),
  protein_g numeric not null check (protein_g >= 0),
  carbs_g numeric not null check (carbs_g >= 0),
  fat_g numeric not null check (fat_g >= 0),
  sort_order integer not null default 0,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (template_id, user_id) references public.meal_templates (id, user_id) on delete cascade,
  unique (id, user_id)
);
create index meal_template_items_by_template on public.meal_template_items (user_id, template_id, sort_order);

create table public.meal_logs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  logged_at timestamptz not null default now(),
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index meal_logs_by_date on public.meal_logs (user_id, local_date desc, logged_at desc) where active;

create table public.nutrition_checkins (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  body_weight numeric check (body_weight is null or body_weight > 0),
  weight_unit text check (weight_unit is null or weight_unit in ('kg', 'lb')),
  energy smallint check (energy is null or energy between 1 and 5),
  appetite smallint check (appetite is null or appetite between 1 and 5),
  sleep_hours numeric check (sleep_hours is null or sleep_hours between 0 and 24),
  note text,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((body_weight is null and weight_unit is null) or (body_weight is not null and weight_unit is not null)),
  unique (user_id, local_date),
  unique (id, user_id)
);
create index nutrition_checkins_by_date on public.nutrition_checkins (user_id, local_date desc);

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
        or (v_set ->> 'weight')::numeric < 0 or (v_set ->> 'reps')::integer < 1 then
        raise exception 'Logged sets need non-negative weight and positive reps' using errcode = '22023';
      end if;
    end loop;
  end loop;
  return p_exercises;
end;
$$;

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
  where template_id = p_template_id and user_id = p_user_id;
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

create or replace function public.protect_meal_log_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.snapshot is distinct from old.snapshot then
    raise exception 'Meal log snapshots are immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'fitness_exercises', 'strength_programs', 'strength_program_days',
    'strength_program_exercises', 'strength_session_overrides', 'workout_logs',
    'fitness_activity_logs', 'nutrition_targets', 'meal_templates',
    'meal_template_items', 'meal_logs', 'nutrition_checkins'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.capture_daily_before_image()', v_table || '_capture_before_image', v_table);
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('grant select on public.%I to authenticated', v_table);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id)', v_table || '_read_owner', v_table);
  end loop;
end;
$$;

create trigger meal_logs_protect_snapshot
  before update on public.meal_logs for each row execute function public.protect_meal_log_snapshot();

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
  v_receipt jsonb;
  v_response jsonb;
  v_exercise public.fitness_exercises%rowtype;
  v_program public.strength_programs%rowtype;
  v_day public.strength_program_days%rowtype;
  v_program_exercise public.strength_program_exercises%rowtype;
  v_override public.strength_session_overrides%rowtype;
  v_workout public.workout_logs%rowtype;
  v_activity public.fitness_activity_logs%rowtype;
  v_exercise_name text;
  v_title_snapshot text;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_mutation_id is null or p_entity_id is null or p_expected_revision is null or p_expected_revision < 0
    or p_entity_type is null or p_entity_type not in (
      'fitness_exercise', 'strength_program', 'strength_program_day',
      'strength_program_exercise', 'strength_override', 'workout_log',
      'fitness_activity_log'
    )
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid fitness mutation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select response into v_receipt from public.sync_mutation_receipts
    where owner_id = v_user_id and mutation_id = p_mutation_id;
  if found then return v_receipt; end if;

  if p_entity_type = 'fitness_exercise' then
    if p_expected_revision = 0 then
      insert into public.fitness_exercises (id, user_id, name, category, load_unit, is_archived)
      values (
        p_entity_id, v_user_id, trim(p_payload ->> 'name'), nullif(trim(p_payload ->> 'category'), ''),
        coalesce(p_payload ->> 'load_unit', 'kg'), coalesce((p_payload ->> 'is_archived')::boolean, false)
      ) returning * into v_exercise;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_exercise.revision, 'record', to_jsonb(v_exercise));
    else
      select * into v_exercise from public.fitness_exercises where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_exercise.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object('revision', v_exercise.revision, 'payload', to_jsonb(v_exercise)));
      else
        update public.fitness_exercises set
          name = case when p_payload ? 'name' then trim(p_payload ->> 'name') else name end,
          category = case when p_payload ? 'category' then nullif(trim(p_payload ->> 'category'), '') else category end,
          load_unit = coalesce(p_payload ->> 'load_unit', load_unit),
          is_archived = coalesce((p_payload ->> 'is_archived')::boolean, is_archived)
        where id = p_entity_id and user_id = v_user_id returning * into v_exercise;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_exercise.revision, 'record', to_jsonb(v_exercise));
      end if;
    end if;

  elsif p_entity_type = 'strength_program' then
    if p_expected_revision = 0 then
      insert into public.strength_programs (id, user_id, title, notes, status)
      values (
        p_entity_id, v_user_id, trim(p_payload ->> 'title'), nullif(trim(p_payload ->> 'notes'), ''),
        coalesce(p_payload ->> 'status', 'active')
      ) returning * into v_program;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_program.revision, 'record', to_jsonb(v_program));
    else
      select * into v_program from public.strength_programs where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_program.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object('revision', v_program.revision, 'payload', to_jsonb(v_program)));
      else
        update public.strength_programs set
          title = case when p_payload ? 'title' then trim(p_payload ->> 'title') else title end,
          notes = case when p_payload ? 'notes' then nullif(trim(p_payload ->> 'notes'), '') else notes end,
          status = coalesce(p_payload ->> 'status', status)
        where id = p_entity_id and user_id = v_user_id returning * into v_program;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_program.revision, 'record', to_jsonb(v_program));
      end if;
    end if;

  elsif p_entity_type = 'strength_program_day' then
    if p_expected_revision = 0 then
      insert into public.strength_program_days (id, user_id, program_id, title, weekday, sort_order)
      values (
        p_entity_id, v_user_id, (p_payload ->> 'program_id')::uuid, trim(p_payload ->> 'title'),
        nullif(p_payload ->> 'weekday', '')::smallint, coalesce((p_payload ->> 'sort_order')::integer, 0)
      ) returning * into v_day;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_day.revision, 'record', to_jsonb(v_day));
    else
      select * into v_day from public.strength_program_days where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_day.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object('revision', v_day.revision, 'payload', to_jsonb(v_day)));
      else
        update public.strength_program_days set
          title = case when p_payload ? 'title' then trim(p_payload ->> 'title') else title end,
          weekday = case when p_payload ? 'weekday' then nullif(p_payload ->> 'weekday', '')::smallint else weekday end,
          sort_order = coalesce((p_payload ->> 'sort_order')::integer, sort_order)
        where id = p_entity_id and user_id = v_user_id returning * into v_day;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_day.revision, 'record', to_jsonb(v_day));
      end if;
    end if;

  elsif p_entity_type = 'strength_program_exercise' then
    if p_expected_revision = 0 then
      select name into v_exercise_name from public.fitness_exercises
        where id = (p_payload ->> 'exercise_id')::uuid and user_id = v_user_id;
      if not found then raise exception 'Exercise not found' using errcode = 'P0002'; end if;
      insert into public.strength_program_exercises (
        id, user_id, program_day_id, exercise_id, exercise_name,
        target_sets, target_reps, target_weight, weight_unit, sort_order
      ) values (
        p_entity_id, v_user_id, (p_payload ->> 'program_day_id')::uuid,
        (p_payload ->> 'exercise_id')::uuid,
        coalesce(nullif(trim(p_payload ->> 'exercise_name'), ''), v_exercise_name),
        (p_payload ->> 'target_sets')::integer, (p_payload ->> 'target_reps')::integer,
        nullif(p_payload ->> 'target_weight', '')::numeric, coalesce(p_payload ->> 'weight_unit', 'kg'),
        coalesce((p_payload ->> 'sort_order')::integer, 0)
      ) returning * into v_program_exercise;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_program_exercise.revision, 'record', to_jsonb(v_program_exercise));
    else
      select * into v_program_exercise from public.strength_program_exercises where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_program_exercise.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object('revision', v_program_exercise.revision, 'payload', to_jsonb(v_program_exercise)));
      else
        update public.strength_program_exercises set
          exercise_name = case when p_payload ? 'exercise_name' then trim(p_payload ->> 'exercise_name') else exercise_name end,
          target_sets = coalesce((p_payload ->> 'target_sets')::integer, target_sets),
          target_reps = coalesce((p_payload ->> 'target_reps')::integer, target_reps),
          target_weight = case when p_payload ? 'target_weight' then nullif(p_payload ->> 'target_weight', '')::numeric else target_weight end,
          weight_unit = coalesce(p_payload ->> 'weight_unit', weight_unit),
          sort_order = coalesce((p_payload ->> 'sort_order')::integer, sort_order)
        where id = p_entity_id and user_id = v_user_id returning * into v_program_exercise;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_program_exercise.revision, 'record', to_jsonb(v_program_exercise));
      end if;
    end if;

  elsif p_entity_type = 'strength_override' then
    if p_expected_revision = 0 then
      insert into public.strength_session_overrides (id, user_id, program_day_id, local_date, title, notes, skipped)
      values (
        p_entity_id, v_user_id, (p_payload ->> 'program_day_id')::uuid, (p_payload ->> 'local_date')::date,
        nullif(trim(p_payload ->> 'title'), ''), nullif(trim(p_payload ->> 'notes'), ''),
        coalesce((p_payload ->> 'skipped')::boolean, false)
      ) returning * into v_override;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_override.revision, 'record', to_jsonb(v_override));
    else
      select * into v_override from public.strength_session_overrides where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_override.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object('revision', v_override.revision, 'payload', to_jsonb(v_override)));
      else
        update public.strength_session_overrides set
          title = case when p_payload ? 'title' then nullif(trim(p_payload ->> 'title'), '') else title end,
          notes = case when p_payload ? 'notes' then nullif(trim(p_payload ->> 'notes'), '') else notes end,
          skipped = coalesce((p_payload ->> 'skipped')::boolean, skipped)
        where id = p_entity_id and user_id = v_user_id returning * into v_override;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_override.revision, 'record', to_jsonb(v_override));
      end if;
    end if;

  elsif p_entity_type = 'workout_log' then
    if p_expected_revision = 0 then
      if p_payload ? 'program_day_id' then
        select coalesce(o.title, d.title, p.title) into v_title_snapshot
        from public.strength_program_days d
        join public.strength_programs p on p.id = d.program_id and p.user_id = d.user_id
        left join public.strength_session_overrides o on o.program_day_id = d.id
          and o.user_id = d.user_id and o.local_date = (p_payload ->> 'local_date')::date
        where d.id = (p_payload ->> 'program_day_id')::uuid and d.user_id = v_user_id;
        if not found then raise exception 'Program day not found' using errcode = 'P0002'; end if;
      end if;
      insert into public.workout_logs (
        id, user_id, program_id, program_day_id, local_date, timezone,
        title_snapshot, completed_at, notes, exercises, status
      ) values (
        p_entity_id, v_user_id, nullif(p_payload ->> 'program_id', '')::uuid,
        nullif(p_payload ->> 'program_day_id', '')::uuid, (p_payload ->> 'local_date')::date,
        coalesce(nullif(trim(p_payload ->> 'timezone'), ''), 'UTC'),
        coalesce(nullif(trim(p_payload ->> 'title_snapshot'), ''), v_title_snapshot, 'Workout'),
        coalesce(nullif(p_payload ->> 'completed_at', '')::timestamptz, now()),
        nullif(trim(p_payload ->> 'notes'), ''),
        public.validate_logged_strength_exercises(p_payload -> 'exercises'),
        coalesce(p_payload ->> 'status', 'logged')
      ) returning * into v_workout;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_workout.revision, 'record', to_jsonb(v_workout));
    else
      select * into v_workout from public.workout_logs where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_workout.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object('revision', v_workout.revision, 'payload', to_jsonb(v_workout)));
      else
        update public.workout_logs set
          notes = case when p_payload ? 'notes' then nullif(trim(p_payload ->> 'notes'), '') else notes end,
          status = coalesce(p_payload ->> 'status', status)
        where id = p_entity_id and user_id = v_user_id returning * into v_workout;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_workout.revision, 'record', to_jsonb(v_workout));
      end if;
    end if;

  else
    if p_expected_revision = 0 then
      insert into public.fitness_activity_logs (
        id, user_id, activity_kind, local_date, title, sport, duration_minutes,
        distance, distance_unit, intensity, notes
      ) values (
        p_entity_id, v_user_id, p_payload ->> 'activity_kind', (p_payload ->> 'local_date')::date,
        trim(p_payload ->> 'title'), nullif(trim(p_payload ->> 'sport'), ''),
        (p_payload ->> 'duration_minutes')::numeric, nullif(p_payload ->> 'distance', '')::numeric,
        nullif(p_payload ->> 'distance_unit', ''), nullif(p_payload ->> 'intensity', ''),
        nullif(trim(p_payload ->> 'notes'), '')
      ) returning * into v_activity;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_activity.revision, 'record', to_jsonb(v_activity));
    else
      select * into v_activity from public.fitness_activity_logs where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_activity.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object('revision', v_activity.revision, 'payload', to_jsonb(v_activity)));
      else
        update public.fitness_activity_logs set
          title = case when p_payload ? 'title' then trim(p_payload ->> 'title') else title end,
          duration_minutes = coalesce((p_payload ->> 'duration_minutes')::numeric, duration_minutes),
          distance = case when p_payload ? 'distance' then nullif(p_payload ->> 'distance', '')::numeric else distance end,
          distance_unit = case when p_payload ? 'distance_unit' then nullif(p_payload ->> 'distance_unit', '') else distance_unit end,
          intensity = case when p_payload ? 'intensity' then nullif(p_payload ->> 'intensity', '') else intensity end,
          notes = case when p_payload ? 'notes' then nullif(trim(p_payload ->> 'notes'), '') else notes end
        where id = p_entity_id and user_id = v_user_id returning * into v_activity;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_activity.revision, 'record', to_jsonb(v_activity));
      end if;
    end if;
  end if;

  insert into public.sync_mutation_receipts (owner_id, mutation_id, response)
    values (v_user_id, p_mutation_id, v_response);
  return v_response;
exception
  when unique_violation then
    if p_entity_type = 'fitness_exercise' then
      select to_jsonb(t) into v_receipt from public.fitness_exercises t where id = p_entity_id and user_id = v_user_id;
    elsif p_entity_type = 'strength_program' then
      select to_jsonb(t) into v_receipt from public.strength_programs t where id = p_entity_id and user_id = v_user_id;
    elsif p_entity_type = 'strength_program_day' then
      select to_jsonb(t) into v_receipt from public.strength_program_days t where id = p_entity_id and user_id = v_user_id;
    elsif p_entity_type = 'strength_program_exercise' then
      select to_jsonb(t) into v_receipt from public.strength_program_exercises t where id = p_entity_id and user_id = v_user_id;
    elsif p_entity_type = 'strength_override' then
      select to_jsonb(t) into v_receipt from public.strength_session_overrides t where id = p_entity_id and user_id = v_user_id;
    elsif p_entity_type = 'workout_log' then
      select to_jsonb(t) into v_receipt from public.workout_logs t where id = p_entity_id and user_id = v_user_id;
    elsif p_entity_type = 'fitness_activity_log' then
      select to_jsonb(t) into v_receipt from public.fitness_activity_logs t where id = p_entity_id and user_id = v_user_id;
    end if;
    v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object('payload', coalesce(v_receipt, '{}'::jsonb)));
    insert into public.sync_mutation_receipts (owner_id, mutation_id, response)
      values (v_user_id, p_mutation_id, v_response)
      on conflict (owner_id, mutation_id) do nothing;
    return v_response;
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
  v_receipt jsonb;
  v_response jsonb;
  v_target public.nutrition_targets%rowtype;
  v_template public.meal_templates%rowtype;
  v_item public.meal_template_items%rowtype;
  v_log public.meal_logs%rowtype;
  v_checkin public.nutrition_checkins%rowtype;
  v_snapshot jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_mutation_id is null or p_entity_id is null or p_expected_revision is null or p_expected_revision < 0
    or p_entity_type is null or p_entity_type not in (
      'nutrition_target', 'meal_template', 'meal_template_item', 'meal_log', 'nutrition_checkin'
    )
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid nutrition mutation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select response into v_receipt from public.sync_mutation_receipts
    where owner_id = v_user_id and mutation_id = p_mutation_id;
  if found then return v_receipt; end if;

  if p_entity_type = 'nutrition_target' then
    if p_expected_revision = 0 then
      insert into public.nutrition_targets (id, user_id, calories, protein_g, carbs_g, fat_g, effective_from)
      values (
        p_entity_id, v_user_id, (p_payload ->> 'calories')::integer,
        (p_payload ->> 'protein_g')::numeric, (p_payload ->> 'carbs_g')::numeric,
        (p_payload ->> 'fat_g')::numeric, (p_payload ->> 'effective_from')::date
      ) returning * into v_target;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_target.revision, 'record', to_jsonb(v_target));
    else
      select * into v_target from public.nutrition_targets where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_target.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object('revision', v_target.revision, 'payload', to_jsonb(v_target)));
      else
        update public.nutrition_targets set
          calories = coalesce((p_payload ->> 'calories')::integer, calories),
          protein_g = coalesce((p_payload ->> 'protein_g')::numeric, protein_g),
          carbs_g = coalesce((p_payload ->> 'carbs_g')::numeric, carbs_g),
          fat_g = coalesce((p_payload ->> 'fat_g')::numeric, fat_g),
          effective_from = coalesce((p_payload ->> 'effective_from')::date, effective_from)
        where id = p_entity_id and user_id = v_user_id returning * into v_target;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_target.revision, 'record', to_jsonb(v_target));
      end if;
    end if;

  elsif p_entity_type = 'meal_template' then
    if p_expected_revision = 0 then
      insert into public.meal_templates (id, user_id, name, meal_type, notes, active)
      values (
        p_entity_id, v_user_id, trim(p_payload ->> 'name'), p_payload ->> 'meal_type',
        nullif(trim(p_payload ->> 'notes'), ''), coalesce((p_payload ->> 'active')::boolean, true)
      ) returning * into v_template;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_template.revision, 'record', to_jsonb(v_template));
    else
      select * into v_template from public.meal_templates where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_template.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object('revision', v_template.revision, 'payload', to_jsonb(v_template)));
      else
        update public.meal_templates set
          name = case when p_payload ? 'name' then trim(p_payload ->> 'name') else name end,
          meal_type = coalesce(p_payload ->> 'meal_type', meal_type),
          notes = case when p_payload ? 'notes' then nullif(trim(p_payload ->> 'notes'), '') else notes end,
          active = coalesce((p_payload ->> 'active')::boolean, active)
        where id = p_entity_id and user_id = v_user_id returning * into v_template;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_template.revision, 'record', to_jsonb(v_template));
      end if;
    end if;

  elsif p_entity_type = 'meal_template_item' then
    if p_expected_revision = 0 then
      insert into public.meal_template_items (
        id, user_id, template_id, name, quantity, unit, calories,
        protein_g, carbs_g, fat_g, sort_order
      ) values (
        p_entity_id, v_user_id, (p_payload ->> 'template_id')::uuid,
        trim(p_payload ->> 'name'), (p_payload ->> 'quantity')::numeric,
        trim(p_payload ->> 'unit'), (p_payload ->> 'calories')::numeric,
        (p_payload ->> 'protein_g')::numeric, (p_payload ->> 'carbs_g')::numeric,
        (p_payload ->> 'fat_g')::numeric, coalesce((p_payload ->> 'sort_order')::integer, 0)
      ) returning * into v_item;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_item.revision, 'record', to_jsonb(v_item));
    else
      select * into v_item from public.meal_template_items where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_item.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object('revision', v_item.revision, 'payload', to_jsonb(v_item)));
      else
        update public.meal_template_items set
          name = case when p_payload ? 'name' then trim(p_payload ->> 'name') else name end,
          quantity = coalesce((p_payload ->> 'quantity')::numeric, quantity),
          unit = case when p_payload ? 'unit' then trim(p_payload ->> 'unit') else unit end,
          calories = coalesce((p_payload ->> 'calories')::numeric, calories),
          protein_g = coalesce((p_payload ->> 'protein_g')::numeric, protein_g),
          carbs_g = coalesce((p_payload ->> 'carbs_g')::numeric, carbs_g),
          fat_g = coalesce((p_payload ->> 'fat_g')::numeric, fat_g),
          sort_order = coalesce((p_payload ->> 'sort_order')::integer, sort_order)
        where id = p_entity_id and user_id = v_user_id returning * into v_item;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_item.revision, 'record', to_jsonb(v_item));
      end if;
    end if;

  elsif p_entity_type = 'meal_log' then
    if p_expected_revision = 0 then
      v_snapshot := case
        when p_payload ? 'snapshot' then p_payload -> 'snapshot'
        else public.build_meal_log_snapshot(
          v_user_id,
          (p_payload ->> 'template_id')::uuid,
          coalesce(nullif(p_payload ->> 'servings', '')::numeric, 1)
        )
      end;
      if jsonb_typeof(v_snapshot) is distinct from 'object' then
        raise exception 'Meal log snapshot must be an object' using errcode = '22023';
      end if;
      insert into public.meal_logs (id, user_id, local_date, logged_at, meal_type, snapshot, active)
      values (
        p_entity_id, v_user_id, (p_payload ->> 'local_date')::date,
        coalesce(nullif(p_payload ->> 'logged_at', '')::timestamptz, now()),
        p_payload ->> 'meal_type', v_snapshot, coalesce((p_payload ->> 'active')::boolean, true)
      ) returning * into v_log;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_log.revision, 'record', to_jsonb(v_log));
    else
      select * into v_log from public.meal_logs where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_log.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object('revision', v_log.revision, 'payload', to_jsonb(v_log)));
      else
        update public.meal_logs set
          active = coalesce((p_payload ->> 'active')::boolean, active)
        where id = p_entity_id and user_id = v_user_id returning * into v_log;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_log.revision, 'record', to_jsonb(v_log));
      end if;
    end if;

  else
    if p_expected_revision = 0 then
      insert into public.nutrition_checkins (
        id, user_id, local_date, body_weight, weight_unit, energy,
        appetite, sleep_hours, note
      ) values (
        p_entity_id, v_user_id, (p_payload ->> 'local_date')::date,
        nullif(p_payload ->> 'body_weight', '')::numeric, nullif(p_payload ->> 'weight_unit', ''),
        nullif(p_payload ->> 'energy', '')::smallint, nullif(p_payload ->> 'appetite', '')::smallint,
        nullif(p_payload ->> 'sleep_hours', '')::numeric, nullif(trim(p_payload ->> 'note'), '')
      ) returning * into v_checkin;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_checkin.revision, 'record', to_jsonb(v_checkin));
    else
      select * into v_checkin from public.nutrition_checkins where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_checkin.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object('revision', v_checkin.revision, 'payload', to_jsonb(v_checkin)));
      else
        update public.nutrition_checkins set
          body_weight = case when p_payload ? 'body_weight' then nullif(p_payload ->> 'body_weight', '')::numeric else body_weight end,
          weight_unit = case when p_payload ? 'weight_unit' then nullif(p_payload ->> 'weight_unit', '') else weight_unit end,
          energy = case when p_payload ? 'energy' then nullif(p_payload ->> 'energy', '')::smallint else energy end,
          appetite = case when p_payload ? 'appetite' then nullif(p_payload ->> 'appetite', '')::smallint else appetite end,
          sleep_hours = case when p_payload ? 'sleep_hours' then nullif(p_payload ->> 'sleep_hours', '')::numeric else sleep_hours end,
          note = case when p_payload ? 'note' then nullif(trim(p_payload ->> 'note'), '') else note end
        where id = p_entity_id and user_id = v_user_id returning * into v_checkin;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_checkin.revision, 'record', to_jsonb(v_checkin));
      end if;
    end if;
  end if;

  insert into public.sync_mutation_receipts (owner_id, mutation_id, response)
    values (v_user_id, p_mutation_id, v_response);
  return v_response;
exception
  when unique_violation then
    if p_entity_type = 'nutrition_target' then
      select to_jsonb(t) into v_receipt from public.nutrition_targets t where id = p_entity_id and user_id = v_user_id;
    elsif p_entity_type = 'meal_template' then
      select to_jsonb(t) into v_receipt from public.meal_templates t where id = p_entity_id and user_id = v_user_id;
    elsif p_entity_type = 'meal_template_item' then
      select to_jsonb(t) into v_receipt from public.meal_template_items t where id = p_entity_id and user_id = v_user_id;
    elsif p_entity_type = 'meal_log' then
      select to_jsonb(t) into v_receipt from public.meal_logs t where id = p_entity_id and user_id = v_user_id;
    elsif p_entity_type = 'nutrition_checkin' then
      select to_jsonb(t) into v_receipt from public.nutrition_checkins t where id = p_entity_id and user_id = v_user_id;
    end if;
    v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object('payload', coalesce(v_receipt, '{}'::jsonb)));
    insert into public.sync_mutation_receipts (owner_id, mutation_id, response)
      values (v_user_id, p_mutation_id, v_response)
      on conflict (owner_id, mutation_id) do nothing;
    return v_response;
end;
$$;

create or replace view public.fitness_exercise_set_history
with (security_invoker = true)
as
select
  w.user_id,
  w.id as workout_id,
  w.local_date,
  w.completed_at,
  (exercise.value ->> 'exercise_id')::uuid as exercise_id,
  exercise.value ->> 'exercise_name' as exercise_name,
  (logged_set.value ->> 'weight')::numeric as weight,
  (logged_set.value ->> 'reps')::integer as reps,
  round(
    case
      when (logged_set.value ->> 'reps')::integer = 1 then (logged_set.value ->> 'weight')::numeric
      when (logged_set.value ->> 'reps')::integer between 2 and 12
        then (logged_set.value ->> 'weight')::numeric * (1 + ((logged_set.value ->> 'reps')::numeric / 30))
      else null
    end,
    2
  ) as estimated_one_rep_max
from public.workout_logs w
cross join lateral jsonb_array_elements(w.exercises) as exercise(value)
cross join lateral jsonb_array_elements(exercise.value -> 'sets') as logged_set(value)
where w.status = 'logged';

revoke all on public.fitness_exercise_set_history from anon, authenticated;
grant select on public.fitness_exercise_set_history to authenticated;

revoke all on function public.validate_logged_strength_exercises(jsonb) from public, anon;
revoke all on function public.build_meal_log_snapshot(uuid, uuid, numeric) from public, anon;
revoke all on function public.protect_meal_log_snapshot() from public, anon;
revoke all on function public.apply_fitness_mutation(uuid, text, uuid, integer, jsonb) from public, anon;
revoke all on function public.apply_nutrition_mutation(uuid, text, uuid, integer, jsonb) from public, anon;
grant execute on function public.apply_fitness_mutation(uuid, text, uuid, integer, jsonb) to authenticated;
grant execute on function public.apply_nutrition_mutation(uuid, text, uuid, integer, jsonb) to authenticated;
