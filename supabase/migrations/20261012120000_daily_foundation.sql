alter table public.record_versions
  add column schema_version integer not null default 1 check (schema_version > 0);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  timezone text not null default 'UTC' check (timezone <> ''),
  units text not null default 'metric' check (units in ('metric', 'imperial')),
  appearance text not null default 'system' check (appearance in ('system', 'light', 'dark')),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.daily_plans (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  timezone text not null check (timezone <> ''),
  status text not null check (status in ('draft', 'active', 'backfill', 'ended')),
  reflection text,
  started_at timestamptz,
  ended_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, local_date),
  unique (id, user_id)
);

create table public.priorities (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  daily_plan_id uuid not null,
  rank smallint not null check (rank between 1 and 3),
  title text not null check (length(trim(title)) > 0),
  outcome text check (outcome in ('done', 'partly_done', 'not_done', 'no_longer_relevant')),
  state text not null default 'active' check (state in ('active', 'archived')),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (daily_plan_id, user_id)
    references public.daily_plans (id, user_id) on delete cascade,
  unique (id, user_id)
);

create unique index priorities_active_rank_unique
  on public.priorities (daily_plan_id, rank) where state = 'active';
create index priorities_by_plan on public.priorities (user_id, daily_plan_id, rank);

create table public.tasks (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  details text,
  due_date date,
  status text not null default 'open' check (status in ('open', 'done', 'archived')),
  completed_at timestamptz,
  sort_order integer not null default 0,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index tasks_by_due_date on public.tasks (user_id, due_date, status, sort_order);

create table public.priority_task_links (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  priority_id uuid not null,
  task_id uuid not null,
  active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (priority_id, user_id)
    references public.priorities (id, user_id) on delete cascade,
  foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete cascade,
  unique (user_id, priority_id, task_id),
  unique (id, user_id)
);
create index priority_task_links_by_task on public.priority_task_links (user_id, task_id) where active;

create table public.routines (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  days_of_week smallint[] not null
    check (cardinality(days_of_week) between 1 and 7)
    check (days_of_week <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  time_label text,
  active boolean not null default true,
  sort_order integer not null default 0,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.routine_logs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  routine_id uuid not null,
  local_date date not null,
  completed boolean not null default false,
  completed_at timestamptz,
  note text,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (routine_id, user_id)
    references public.routines (id, user_id) on delete cascade,
  unique (user_id, routine_id, local_date),
  unique (id, user_id)
);
create index routine_logs_by_date on public.routine_logs (user_id, local_date, routine_id);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_create_compass_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

create or replace function public.capture_daily_before_image()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb := to_jsonb(old);
  v_user_id uuid := (v_snapshot ->> 'user_id')::uuid;
  v_record_id uuid := coalesce(
    nullif(v_snapshot ->> 'id', '')::uuid,
    (v_snapshot ->> 'user_id')::uuid
  );
  v_revision integer := (v_snapshot ->> 'revision')::integer;
begin
  insert into public.record_versions (
    owner_id, record_type, record_id, revision, schema_version, snapshot, expires_at
  ) values (
    v_user_id, tg_table_name, v_record_id, v_revision, 1, v_snapshot, now() + interval '30 days'
  ) on conflict (owner_id, record_type, record_id, revision) do nothing;

  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_capture_before_image
  before update on public.profiles for each row execute function public.capture_daily_before_image();
create trigger daily_plans_capture_before_image
  before update on public.daily_plans for each row execute function public.capture_daily_before_image();
create trigger priorities_capture_before_image
  before update on public.priorities for each row execute function public.capture_daily_before_image();
create trigger tasks_capture_before_image
  before update on public.tasks for each row execute function public.capture_daily_before_image();
create trigger priority_task_links_capture_before_image
  before update on public.priority_task_links for each row execute function public.capture_daily_before_image();
create trigger routines_capture_before_image
  before update on public.routines for each row execute function public.capture_daily_before_image();
create trigger routine_logs_capture_before_image
  before update on public.routine_logs for each row execute function public.capture_daily_before_image();

alter table public.profiles enable row level security;
alter table public.daily_plans enable row level security;
alter table public.priorities enable row level security;
alter table public.tasks enable row level security;
alter table public.priority_task_links enable row level security;
alter table public.routines enable row level security;
alter table public.routine_logs enable row level security;

revoke all on public.profiles, public.daily_plans, public.priorities, public.tasks,
  public.priority_task_links, public.routines, public.routine_logs from anon, authenticated;
grant select on public.profiles, public.daily_plans, public.priorities, public.tasks,
  public.priority_task_links, public.routines, public.routine_logs to authenticated;

create policy profiles_read_owner on public.profiles
  for select to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy daily_plans_read_owner on public.daily_plans
  for select to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy priorities_read_owner on public.priorities
  for select to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy tasks_read_owner on public.tasks
  for select to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy priority_task_links_read_owner on public.priority_task_links
  for select to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy routines_read_owner on public.routines
  for select to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy routine_logs_read_owner on public.routine_logs
  for select to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create or replace function public.apply_daily_mutation(
  p_mutation_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_expected_revision integer,
  p_operation text,
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
  v_snapshot jsonb;
  v_revision integer;
  v_status text;
  v_plan public.daily_plans%rowtype;
  v_priority public.priorities%rowtype;
  v_task public.tasks%rowtype;
  v_routine public.routines%rowtype;
  v_routine_log public.routine_logs%rowtype;
  v_profile public.profiles%rowtype;
  v_link public.priority_task_links%rowtype;
  v_plan_id uuid;
  v_days smallint[];
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_mutation_id is null or p_entity_id is null or p_expected_revision < 0
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid daily mutation' using errcode = '22023';
  end if;
  if p_operation not in ('upsert', 'link', 'unlink') then
    raise exception 'Unsupported daily mutation operation' using errcode = '22023';
  end if;
  if p_entity_type = 'profile' and p_entity_id <> v_user_id then
    raise exception 'Profile does not belong to the authenticated user' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select response into v_receipt from public.sync_mutation_receipts
    where owner_id = v_user_id and mutation_id = p_mutation_id;
  if found then return v_receipt; end if;

  if p_entity_type = 'profile' then
    select * into v_profile from public.profiles where user_id = v_user_id for update;
    if not found then raise exception 'Profile was not created for this account' using errcode = 'P0002'; end if;
    if v_profile.revision <> p_expected_revision then
      v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object(
        'revision', v_profile.revision, 'payload', to_jsonb(v_profile)));
    else
      update public.profiles set
        display_name = case when p_payload ? 'display_name' then nullif(trim(p_payload ->> 'display_name'), '') else display_name end,
        timezone = coalesce(nullif(p_payload ->> 'timezone', ''), timezone),
        units = coalesce(p_payload ->> 'units', units),
        appearance = coalesce(p_payload ->> 'appearance', appearance)
      where user_id = v_user_id returning * into v_profile;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_profile.revision, 'record', to_jsonb(v_profile));
    end if;

  elsif p_entity_type = 'daily_plan' then
    if p_expected_revision = 0 then
      if coalesce(p_payload ->> 'status', 'active') = 'ended' then
        raise exception 'Use the day review action to end a daily plan' using errcode = '23514';
      end if;
      insert into public.daily_plans (id, user_id, local_date, timezone, status, reflection, started_at)
      values (
        p_entity_id, v_user_id, (p_payload ->> 'local_date')::date,
        coalesce(nullif(p_payload ->> 'timezone', ''), 'UTC'),
        coalesce(p_payload ->> 'status', 'active'), nullif(p_payload ->> 'reflection', ''),
        nullif(p_payload ->> 'started_at', '')::timestamptz
      ) returning * into v_plan;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_plan.revision, 'record', to_jsonb(v_plan));
    else
      select * into v_plan from public.daily_plans
        where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_plan.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object(
          'revision', v_plan.revision, 'payload', to_jsonb(v_plan)));
      else
        if p_payload ->> 'status' = 'ended' then
          raise exception 'Use the day review action to end a daily plan' using errcode = '23514';
        end if;
        update public.daily_plans set
          timezone = coalesce(nullif(p_payload ->> 'timezone', ''), timezone),
          status = coalesce(p_payload ->> 'status', status),
          reflection = case when p_payload ? 'reflection' then nullif(p_payload ->> 'reflection', '') else reflection end,
          started_at = case when p_payload ? 'started_at' then nullif(p_payload ->> 'started_at', '')::timestamptz else started_at end,
          ended_at = case when p_payload ? 'ended_at' then nullif(p_payload ->> 'ended_at', '')::timestamptz else ended_at end
        where id = p_entity_id and user_id = v_user_id returning * into v_plan;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_plan.revision, 'record', to_jsonb(v_plan));
      end if;
    end if;

  elsif p_entity_type = 'priority' then
    if p_expected_revision = 0 then
      v_plan_id := (p_payload ->> 'daily_plan_id')::uuid;
      select * into v_plan from public.daily_plans
        where id = v_plan_id and user_id = v_user_id for update;
      if not found then raise exception 'Daily plan not found' using errcode = 'P0002'; end if;
      if v_plan.status = 'ended' then raise exception 'Reopen this date before backfilling priorities' using errcode = '23514'; end if;
      select count(*) into v_count from public.priorities
        where user_id = v_user_id and daily_plan_id = v_plan_id and state = 'active';
      if v_count >= 3 then raise exception 'A daily plan can contain at most three active priorities' using errcode = '23514'; end if;
      insert into public.priorities (id, user_id, daily_plan_id, rank, title, outcome)
      values (
        p_entity_id, v_user_id, v_plan_id, (p_payload ->> 'rank')::smallint,
        trim(p_payload ->> 'title'), nullif(p_payload ->> 'outcome', '')
      ) returning * into v_priority;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_priority.revision, 'record', to_jsonb(v_priority));
    else
      select * into v_priority from public.priorities
        where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_priority.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object(
          'revision', v_priority.revision, 'payload', to_jsonb(v_priority)));
      else
        select * into v_plan from public.daily_plans
          where id = v_priority.daily_plan_id and user_id = v_user_id for update;
        if (p_payload ? 'rank' or p_payload ? 'state') then
          select count(*) into v_count from public.priorities
            where user_id = v_user_id and daily_plan_id = v_priority.daily_plan_id
              and state = 'active' and id <> p_entity_id;
          if coalesce(p_payload ->> 'state', v_priority.state) = 'active' and v_count >= 3 then
            raise exception 'A daily plan can contain at most three active priorities' using errcode = '23514';
          end if;
        end if;
        update public.priorities set
          rank = coalesce((p_payload ->> 'rank')::smallint, rank),
          title = case when p_payload ? 'title' then trim(p_payload ->> 'title') else title end,
          outcome = case when p_payload ? 'outcome' then nullif(p_payload ->> 'outcome', '') else outcome end,
          state = coalesce(p_payload ->> 'state', state)
        where id = p_entity_id and user_id = v_user_id returning * into v_priority;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_priority.revision, 'record', to_jsonb(v_priority));
      end if;
    end if;

  elsif p_entity_type = 'task' then
    if p_expected_revision = 0 then
      insert into public.tasks (id, user_id, title, details, due_date, status, completed_at, sort_order)
      values (
        p_entity_id, v_user_id, trim(p_payload ->> 'title'), nullif(p_payload ->> 'details', ''),
        nullif(p_payload ->> 'due_date', '')::date, coalesce(p_payload ->> 'status', 'open'),
        nullif(p_payload ->> 'completed_at', '')::timestamptz, coalesce((p_payload ->> 'sort_order')::integer, 0)
      ) returning * into v_task;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_task.revision, 'record', to_jsonb(v_task));
    else
      select * into v_task from public.tasks where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_task.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object(
          'revision', v_task.revision, 'payload', to_jsonb(v_task)));
      else
        update public.tasks set
          title = case when p_payload ? 'title' then trim(p_payload ->> 'title') else title end,
          details = case when p_payload ? 'details' then nullif(p_payload ->> 'details', '') else details end,
          due_date = case when p_payload ? 'due_date' then nullif(p_payload ->> 'due_date', '')::date else due_date end,
          status = coalesce(p_payload ->> 'status', status),
          completed_at = case
            when coalesce(p_payload ->> 'status', status) = 'done' then coalesce(completed_at, now())
            when p_payload ? 'status' then null
            else completed_at
          end,
          sort_order = coalesce((p_payload ->> 'sort_order')::integer, sort_order)
        where id = p_entity_id and user_id = v_user_id returning * into v_task;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_task.revision, 'record', to_jsonb(v_task));
      end if;
    end if;

  elsif p_entity_type = 'priority_task_link' then
    if p_expected_revision = 0 then
      insert into public.priority_task_links (id, user_id, priority_id, task_id, active)
      values (
        p_entity_id, v_user_id, (p_payload ->> 'priority_id')::uuid,
        (p_payload ->> 'task_id')::uuid, coalesce((p_payload ->> 'active')::boolean, true)
      ) returning * into v_link;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_link.revision, 'record', to_jsonb(v_link));
    else
      select * into v_link from public.priority_task_links
        where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_link.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object(
          'revision', v_link.revision, 'payload', to_jsonb(v_link)));
      else
        update public.priority_task_links set active = coalesce((p_payload ->> 'active')::boolean, active)
          where id = p_entity_id and user_id = v_user_id returning * into v_link;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_link.revision, 'record', to_jsonb(v_link));
      end if;
    end if;

  elsif p_entity_type = 'routine' then
    select array_agg(day_value::smallint order by ordinal)
      into v_days from jsonb_array_elements_text(coalesce(p_payload -> 'days_of_week', '[]'::jsonb))
      with ordinality as days(day_value, ordinal);
    if p_expected_revision = 0 then
      insert into public.routines (id, user_id, title, days_of_week, time_label, active, sort_order)
      values (
        p_entity_id, v_user_id, trim(p_payload ->> 'title'), v_days,
        nullif(p_payload ->> 'time_label', ''), coalesce((p_payload ->> 'active')::boolean, true),
        coalesce((p_payload ->> 'sort_order')::integer, 0)
      ) returning * into v_routine;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_routine.revision, 'record', to_jsonb(v_routine));
    else
      select * into v_routine from public.routines where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_routine.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object(
          'revision', v_routine.revision, 'payload', to_jsonb(v_routine)));
      else
        update public.routines set
          title = case when p_payload ? 'title' then trim(p_payload ->> 'title') else title end,
          days_of_week = case when p_payload ? 'days_of_week' then v_days else days_of_week end,
          time_label = case when p_payload ? 'time_label' then nullif(p_payload ->> 'time_label', '') else time_label end,
          active = coalesce((p_payload ->> 'active')::boolean, active),
          sort_order = coalesce((p_payload ->> 'sort_order')::integer, sort_order)
        where id = p_entity_id and user_id = v_user_id returning * into v_routine;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_routine.revision, 'record', to_jsonb(v_routine));
      end if;
    end if;

  elsif p_entity_type = 'routine_log' then
    if p_expected_revision = 0 then
      insert into public.routine_logs (id, user_id, routine_id, local_date, completed, completed_at, note)
      values (
        p_entity_id, v_user_id, (p_payload ->> 'routine_id')::uuid, (p_payload ->> 'local_date')::date,
        coalesce((p_payload ->> 'completed')::boolean, false),
        case when coalesce((p_payload ->> 'completed')::boolean, false) then now() else null end,
        nullif(p_payload ->> 'note', '')
      ) returning * into v_routine_log;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_routine_log.revision, 'record', to_jsonb(v_routine_log));
    else
      select * into v_routine_log from public.routine_logs
        where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_routine_log.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object(
          'revision', v_routine_log.revision, 'payload', to_jsonb(v_routine_log)));
      else
        update public.routine_logs set
          completed = coalesce((p_payload ->> 'completed')::boolean, completed),
          completed_at = case
            when coalesce((p_payload ->> 'completed')::boolean, completed) then coalesce(completed_at, now())
            when p_payload ? 'completed' then null
            else completed_at
          end,
          note = case when p_payload ? 'note' then nullif(p_payload ->> 'note', '') else note end
        where id = p_entity_id and user_id = v_user_id returning * into v_routine_log;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_routine_log.revision, 'record', to_jsonb(v_routine_log));
      end if;
    end if;

  else
    raise exception 'Unsupported daily entity type' using errcode = '22023';
  end if;

  insert into public.sync_mutation_receipts (owner_id, mutation_id, response)
    values (v_user_id, p_mutation_id, v_response);
  return v_response;
end;
$$;

revoke all on function public.apply_daily_mutation(uuid, text, uuid, integer, text, jsonb) from public, anon;
grant execute on function public.apply_daily_mutation(uuid, text, uuid, integer, text, jsonb) to authenticated;

create or replace function public.finish_daily_plan(
  p_mutation_id uuid,
  p_plan_id uuid,
  p_expected_revision integer,
  p_outcomes jsonb,
  p_reflection text,
  p_carry_forward jsonb
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
  v_plan public.daily_plans%rowtype;
  v_priority public.priorities%rowtype;
  v_next_plan public.daily_plans%rowtype;
  v_entry jsonb;
  v_outcome text;
  v_priority_count integer;
  v_outcome_count integer;
  v_distinct_outcome_count integer;
  v_carry_count integer;
  v_distinct_carry_count integer;
  v_existing_count integer;
  v_next_rank smallint;
  v_new_id uuid;
  v_source_id uuid;
  v_plan_revision integer;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_mutation_id is null or p_plan_id is null or p_expected_revision < 1
    or jsonb_typeof(coalesce(p_outcomes, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_carry_forward, '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid day review request' using errcode = '22023';
  end if;
  -- Serialize retries by owner and mutation ID, including not_found replies that have no plan row to lock.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select response into v_receipt from public.sync_mutation_receipts
    where owner_id = v_user_id and mutation_id = p_mutation_id;
  if found then return v_receipt; end if;

  select * into v_plan from public.daily_plans
    where id = p_plan_id and user_id = v_user_id for update;
  if not found then
    v_response := jsonb_build_object('status', 'not_found');
    insert into public.sync_mutation_receipts (owner_id, mutation_id, response)
      values (v_user_id, p_mutation_id, v_response);
    return v_response;
  end if;
  select response into v_receipt from public.sync_mutation_receipts
    where owner_id = v_user_id and mutation_id = p_mutation_id;
  if found then return v_receipt; end if;
  if v_plan.revision <> p_expected_revision then
    v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object(
      'revision', v_plan.revision, 'payload', to_jsonb(v_plan)));
    insert into public.sync_mutation_receipts (owner_id, mutation_id, response)
      values (v_user_id, p_mutation_id, v_response);
    return v_response;
  end if;
  if v_plan.status not in ('active', 'backfill') then
    raise exception 'Only an active or backfill day can be ended' using errcode = '23514';
  end if;

  select count(*) into v_priority_count from public.priorities
    where user_id = v_user_id and daily_plan_id = p_plan_id and state = 'active';
  select count(*), count(distinct value ->> 'priority_id')
    into v_outcome_count, v_distinct_outcome_count
    from jsonb_array_elements(coalesce(p_outcomes, '[]'::jsonb));
  if v_outcome_count <> v_priority_count or v_outcome_count <> v_distinct_outcome_count then
    raise exception 'Choose one outcome for every priority before ending the day' using errcode = '23514';
  end if;

  for v_entry in select value from jsonb_array_elements(coalesce(p_outcomes, '[]'::jsonb)) loop
    v_source_id := (v_entry ->> 'priority_id')::uuid;
    v_outcome := v_entry ->> 'outcome';
    if v_outcome not in ('done', 'partly_done', 'not_done', 'no_longer_relevant') then
      raise exception 'Invalid priority outcome' using errcode = '22023';
    end if;
    update public.priorities set outcome = v_outcome
      where id = v_source_id and user_id = v_user_id and daily_plan_id = p_plan_id and state = 'active';
    if not found then raise exception 'Priority does not belong to this day' using errcode = '42501'; end if;
  end loop;

  select count(*), count(distinct value ->> 'source_priority_id')
    into v_carry_count, v_distinct_carry_count
    from jsonb_array_elements(coalesce(p_carry_forward, '[]'::jsonb));
  if v_carry_count <> v_distinct_carry_count then
    raise exception 'A priority can only be carried forward once' using errcode = '22023';
  end if;

  if v_carry_count > 0 then
    insert into public.daily_plans (id, user_id, local_date, timezone, status)
      values (gen_random_uuid(), v_user_id, v_plan.local_date + 1, v_plan.timezone, 'draft')
      on conflict (user_id, local_date) do nothing;
    select * into v_next_plan from public.daily_plans
      where user_id = v_user_id and local_date = v_plan.local_date + 1 for update;
    if not found or v_next_plan.status = 'ended' then
      raise exception 'The next day is closed; choose another date for carry-forward' using errcode = '23514';
    end if;
    select count(*) into v_existing_count from public.priorities
      where user_id = v_user_id and daily_plan_id = v_next_plan.id and state = 'active';
    if v_existing_count + v_carry_count > 3 then
      raise exception 'The next day has room for fewer carried priorities' using errcode = '23514';
    end if;

    for v_entry in select value from jsonb_array_elements(coalesce(p_carry_forward, '[]'::jsonb)) loop
      v_source_id := (v_entry ->> 'source_priority_id')::uuid;
      v_new_id := (v_entry ->> 'new_priority_id')::uuid;
      select * into v_priority from public.priorities
        where id = v_source_id and user_id = v_user_id and daily_plan_id = p_plan_id and state = 'active';
      if not found or v_priority.outcome not in ('partly_done', 'not_done') then
        raise exception 'Only unfinished priorities can be carried forward' using errcode = '23514';
      end if;
      v_next_rank := 1;
      while exists (
        select 1 from public.priorities
          where user_id = v_user_id and daily_plan_id = v_next_plan.id and state = 'active' and rank = v_next_rank
      ) loop
        v_next_rank := v_next_rank + 1;
      end loop;
      if v_next_rank > 3 then raise exception 'The next day is full' using errcode = '23514'; end if;
      insert into public.priorities (id, user_id, daily_plan_id, rank, title)
        values (v_new_id, v_user_id, v_next_plan.id, v_next_rank, v_priority.title);
    end loop;
  end if;

  update public.daily_plans set
    status = 'ended',
    reflection = nullif(trim(coalesce(p_reflection, '')), ''),
    ended_at = now()
  where id = p_plan_id and user_id = v_user_id returning revision into v_plan_revision;
  v_response := jsonb_build_object('status', 'applied', 'revision', v_plan_revision, 'carry_forward_count', v_carry_count);
  insert into public.sync_mutation_receipts (owner_id, mutation_id, response)
    values (v_user_id, p_mutation_id, v_response);
  return v_response;
end;
$$;

revoke all on function public.finish_daily_plan(uuid, uuid, integer, jsonb, text, jsonb) from public, anon;
grant execute on function public.finish_daily_plan(uuid, uuid, integer, jsonb, text, jsonb) to authenticated;
