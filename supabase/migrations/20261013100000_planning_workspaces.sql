create table public.calendar_events (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  time_zone text not null check (time_zone <> ''),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (id, user_id)
);
create index calendar_events_by_start on public.calendar_events (user_id, starts_at, ends_at) where status = 'active';

create table public.calendar_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null check (provider = 'google'),
  provider_email text,
  encrypted_refresh_token text not null,
  encryption_iv text not null,
  granted_scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.external_calendars (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider = 'google'),
  provider_calendar_id text not null,
  name text not null check (length(trim(name)) > 0),
  time_zone text,
  selected boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, provider_calendar_id),
  unique (id, user_id)
);

create table public.external_calendar_events (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  external_calendar_id uuid not null,
  provider_event_id text not null,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  time_zone text not null,
  source_updated_at timestamptz,
  imported_at timestamptz not null default now(),
  foreign key (external_calendar_id, user_id)
    references public.external_calendars (id, user_id) on delete cascade,
  check (ends_at > starts_at),
  unique (external_calendar_id, provider_event_id),
  unique (id, user_id)
);
create index external_calendar_events_by_start on public.external_calendar_events (user_id, starts_at, ends_at);

create table public.projects (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  sort_order integer not null default 0,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  archived_at timestamptz,
  unique (id, user_id)
);
create index projects_by_owner_status on public.projects (user_id, status, sort_order);

create table public.project_stages (
  id uuid primary key,
  user_id uuid not null,
  project_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  color text,
  sort_order integer not null default 0,
  is_complete boolean not null default false,
  is_archived boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade,
  unique (id, project_id, user_id)
);
create index project_stages_by_project on public.project_stages (user_id, project_id, is_archived, sort_order);

create table public.project_task_links (
  id uuid primary key,
  user_id uuid not null,
  project_id uuid not null,
  task_id uuid not null,
  stage_id uuid not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade,
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade,
  foreign key (stage_id, project_id, user_id)
    references public.project_stages (id, project_id, user_id) on delete cascade,
  unique (project_id, task_id),
  unique (id, user_id)
);
create index project_task_links_by_board on public.project_task_links (user_id, project_id, stage_id, active, sort_order);

create table public.life_areas (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, name)
);
create index life_areas_by_owner on public.life_areas (user_id, is_archived, sort_order);

create table public.goals (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text,
  kind text not null check (kind in ('qualitative', 'measurable')),
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  life_area_id uuid,
  baseline_value numeric,
  target_value numeric,
  target_unit text,
  direction text check (direction in ('increase', 'decrease')),
  due_date date,
  sort_order integer not null default 0,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  archived_at timestamptz,
  foreign key (life_area_id, user_id) references public.life_areas (id, user_id) on delete set null (life_area_id),
  check (
    (kind = 'qualitative' and target_value is null and target_unit is null and direction is null)
    or (kind = 'measurable' and target_value is not null and target_unit is not null and direction is not null)
  ),
  unique (id, user_id)
);
create index goals_by_owner_status on public.goals (user_id, status, sort_order);

create table public.goal_updates (
  id uuid primary key,
  user_id uuid not null,
  goal_id uuid not null,
  value numeric,
  unit text,
  note text,
  source text not null check (length(trim(source)) > 0),
  measured_at timestamptz not null,
  active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade,
  check (value is not null or nullif(trim(note), '') is not null),
  unique (id, user_id)
);
create index goal_updates_by_goal_date on public.goal_updates (user_id, goal_id, active, measured_at desc);

create table public.goal_project_links (
  id uuid primary key,
  user_id uuid not null,
  goal_id uuid not null,
  project_id uuid not null,
  active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade,
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade,
  unique (goal_id, project_id),
  unique (id, user_id)
);

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'calendar_events', 'external_calendars', 'projects', 'project_stages',
    'project_task_links', 'life_areas', 'goals', 'goal_updates', 'goal_project_links'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.capture_daily_before_image()', v_table || '_capture_before_image', v_table);
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('grant select on public.%I to authenticated', v_table);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id)', v_table || '_read_owner', v_table);
  end loop;
end;
$$;

alter table public.calendar_connections enable row level security;
alter table public.external_calendar_events enable row level security;
revoke all on public.calendar_connections, public.external_calendar_events from anon, authenticated;
grant select on public.external_calendar_events to authenticated;
create policy external_calendar_events_read_owner on public.external_calendar_events
  for select to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create or replace function public.apply_calendar_mutation(
  p_mutation_id uuid,
  p_event_id uuid,
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
  v_event public.calendar_events%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_mutation_id is null or p_event_id is null or p_expected_revision < 0
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid calendar mutation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select response into v_receipt from public.sync_mutation_receipts
    where owner_id = v_user_id and mutation_id = p_mutation_id;
  if found then return v_receipt; end if;

  if p_expected_revision = 0 then
    insert into public.calendar_events (
      id, user_id, title, description, starts_at, ends_at, time_zone, status
    ) values (
      p_event_id, v_user_id, trim(p_payload ->> 'title'), nullif(trim(p_payload ->> 'description'), ''),
      (p_payload ->> 'starts_at')::timestamptz, (p_payload ->> 'ends_at')::timestamptz,
      trim(p_payload ->> 'time_zone'), coalesce(p_payload ->> 'status', 'active')
    ) returning * into v_event;
    v_response := jsonb_build_object('status', 'applied', 'revision', v_event.revision, 'record', to_jsonb(v_event));
  else
    select * into v_event from public.calendar_events
      where id = p_event_id and user_id = v_user_id for update;
    if not found then
      v_response := jsonb_build_object('status', 'not_found');
    elsif v_event.revision <> p_expected_revision then
      v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object(
        'revision', v_event.revision, 'payload', to_jsonb(v_event)));
    else
      update public.calendar_events set
        title = case when p_payload ? 'title' then trim(p_payload ->> 'title') else title end,
        description = case when p_payload ? 'description' then nullif(trim(p_payload ->> 'description'), '') else description end,
        starts_at = coalesce((p_payload ->> 'starts_at')::timestamptz, starts_at),
        ends_at = coalesce((p_payload ->> 'ends_at')::timestamptz, ends_at),
        time_zone = coalesce(nullif(trim(p_payload ->> 'time_zone'), ''), time_zone),
        status = coalesce(p_payload ->> 'status', status)
      where id = p_event_id and user_id = v_user_id returning * into v_event;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_event.revision, 'record', to_jsonb(v_event));
    end if;
  end if;

  insert into public.sync_mutation_receipts (owner_id, mutation_id, response)
    values (v_user_id, p_mutation_id, v_response);
  return v_response;
end;
$$;

revoke all on function public.apply_calendar_mutation(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.apply_calendar_mutation(uuid, uuid, integer, jsonb) to authenticated;

create or replace function public.apply_project_mutation(
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
  v_project public.projects%rowtype;
  v_stage public.project_stages%rowtype;
  v_link public.project_task_links%rowtype;
  v_entry jsonb;
  v_active_stages integer;
  v_stages jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_mutation_id is null or p_entity_id is null or p_expected_revision is null or p_expected_revision < 0
    or p_entity_type is null or p_entity_type not in ('project', 'project_stage', 'project_task_link')
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid project mutation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select response into v_receipt from public.sync_mutation_receipts
    where owner_id = v_user_id and mutation_id = p_mutation_id;
  if found then return v_receipt; end if;

  if p_entity_type = 'project' then
    if p_expected_revision = 0 then
      insert into public.projects (id, user_id, title, description, status, sort_order)
      values (
        p_entity_id, v_user_id, trim(p_payload ->> 'title'), nullif(trim(p_payload ->> 'description'), ''),
        coalesce(p_payload ->> 'status', 'active'), coalesce((p_payload ->> 'sort_order')::integer, 0)
      ) returning * into v_project;
      v_stages := coalesce(p_payload -> 'stages', '[]'::jsonb);
      if jsonb_typeof(v_stages) is distinct from 'array' then
        raise exception 'Project stages must be an array' using errcode = '22023';
      end if;
      if jsonb_array_length(v_stages) = 0 then
        raise exception 'A project needs at least one stage' using errcode = '23514';
      end if;
      for v_entry in select value from jsonb_array_elements(v_stages) loop
        insert into public.project_stages (
          id, user_id, project_id, name, color, sort_order, is_complete
        ) values (
          (v_entry ->> 'id')::uuid, v_user_id, p_entity_id,
          trim(v_entry ->> 'name'), nullif(v_entry ->> 'color', ''),
          coalesce((v_entry ->> 'sort_order')::integer, 0), coalesce((v_entry ->> 'is_complete')::boolean, false)
        );
      end loop;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_project.revision, 'record', to_jsonb(v_project));
    else
      select * into v_project from public.projects where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_project.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object(
          'revision', v_project.revision, 'payload', to_jsonb(v_project)));
      else
        update public.projects set
          title = case when p_payload ? 'title' then trim(p_payload ->> 'title') else title end,
          description = case when p_payload ? 'description' then nullif(trim(p_payload ->> 'description'), '') else description end,
          status = coalesce(p_payload ->> 'status', status),
          sort_order = coalesce((p_payload ->> 'sort_order')::integer, sort_order),
          completed_at = case when p_payload ->> 'status' = 'completed' then coalesce(completed_at, now())
            when p_payload ->> 'status' = 'active' then null else completed_at end,
          archived_at = case when p_payload ->> 'status' = 'archived' then coalesce(archived_at, now())
            when p_payload ->> 'status' = 'active' then null else archived_at end
        where id = p_entity_id and user_id = v_user_id returning * into v_project;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_project.revision, 'record', to_jsonb(v_project));
      end if;
    end if;

  elsif p_entity_type = 'project_stage' then
    if p_expected_revision = 0 then
      if not exists (select 1 from public.projects where id = (p_payload ->> 'project_id')::uuid and user_id = v_user_id) then
        raise exception 'Project not found' using errcode = 'P0002';
      end if;
      insert into public.project_stages (id, user_id, project_id, name, color, sort_order, is_complete, is_archived)
      values (
        p_entity_id, v_user_id, (p_payload ->> 'project_id')::uuid, trim(p_payload ->> 'name'),
        nullif(p_payload ->> 'color', ''), coalesce((p_payload ->> 'sort_order')::integer, 0),
        coalesce((p_payload ->> 'is_complete')::boolean, false), coalesce((p_payload ->> 'is_archived')::boolean, false)
      ) returning * into v_stage;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_stage.revision, 'record', to_jsonb(v_stage));
    else
      select * into v_stage from public.project_stages where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_stage.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object(
          'revision', v_stage.revision, 'payload', to_jsonb(v_stage)));
      else
        if coalesce((p_payload ->> 'is_archived')::boolean, v_stage.is_archived) and not v_stage.is_archived then
          select count(*) into v_active_stages from public.project_stages
            where user_id = v_user_id and project_id = v_stage.project_id and not is_archived and id <> p_entity_id;
          if v_active_stages = 0 then raise exception 'A project must keep at least one active stage' using errcode = '23514'; end if;
          if exists (select 1 from public.project_task_links where user_id = v_user_id and stage_id = p_entity_id and active) then
            raise exception 'Move or archive the stage tasks before archiving this stage' using errcode = '23514';
          end if;
        end if;
        update public.project_stages set
          name = case when p_payload ? 'name' then trim(p_payload ->> 'name') else name end,
          color = case when p_payload ? 'color' then nullif(p_payload ->> 'color', '') else color end,
          sort_order = coalesce((p_payload ->> 'sort_order')::integer, sort_order),
          is_complete = coalesce((p_payload ->> 'is_complete')::boolean, is_complete),
          is_archived = coalesce((p_payload ->> 'is_archived')::boolean, is_archived)
        where id = p_entity_id and user_id = v_user_id returning * into v_stage;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_stage.revision, 'record', to_jsonb(v_stage));
      end if;
    end if;

  else
    if p_expected_revision = 0 then
      insert into public.project_task_links (id, user_id, project_id, task_id, stage_id, sort_order, active)
      values (
        p_entity_id, v_user_id, (p_payload ->> 'project_id')::uuid, (p_payload ->> 'task_id')::uuid,
        (p_payload ->> 'stage_id')::uuid, coalesce((p_payload ->> 'sort_order')::integer, 0), true
      ) returning * into v_link;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_link.revision, 'record', to_jsonb(v_link));
    else
      select * into v_link from public.project_task_links where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_link.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object(
          'revision', v_link.revision, 'payload', to_jsonb(v_link)));
      else
        update public.project_task_links set
          stage_id = coalesce((p_payload ->> 'stage_id')::uuid, stage_id),
          sort_order = coalesce((p_payload ->> 'sort_order')::integer, sort_order),
          active = coalesce((p_payload ->> 'active')::boolean, active)
        where id = p_entity_id and user_id = v_user_id returning * into v_link;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_link.revision, 'record', to_jsonb(v_link));
      end if;
    end if;
  end if;

  insert into public.sync_mutation_receipts (owner_id, mutation_id, response)
    values (v_user_id, p_mutation_id, v_response);
  return v_response;
end;
$$;

revoke all on function public.apply_project_mutation(uuid, text, uuid, integer, jsonb) from public, anon;
grant execute on function public.apply_project_mutation(uuid, text, uuid, integer, jsonb) to authenticated;

create or replace function public.apply_goal_mutation(
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
  v_area public.life_areas%rowtype;
  v_goal public.goals%rowtype;
  v_update public.goal_updates%rowtype;
  v_link public.goal_project_links%rowtype;
  v_goal_kind text;
  v_target_unit text;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_mutation_id is null or p_entity_id is null or p_expected_revision is null or p_expected_revision < 0
    or p_entity_type is null or p_entity_type not in ('life_area', 'goal', 'goal_update', 'goal_project_link')
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid goal mutation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select response into v_receipt from public.sync_mutation_receipts
    where owner_id = v_user_id and mutation_id = p_mutation_id;
  if found then return v_receipt; end if;

  if p_entity_type = 'life_area' then
    if p_expected_revision = 0 then
      insert into public.life_areas (id, user_id, name, sort_order, is_archived)
      values (
        p_entity_id, v_user_id, trim(p_payload ->> 'name'), coalesce((p_payload ->> 'sort_order')::integer, 0),
        coalesce((p_payload ->> 'is_archived')::boolean, false)
      ) returning * into v_area;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_area.revision, 'record', to_jsonb(v_area));
    else
      select * into v_area from public.life_areas where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_area.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object(
          'revision', v_area.revision, 'payload', to_jsonb(v_area)));
      else
        update public.life_areas set
          name = case when p_payload ? 'name' then trim(p_payload ->> 'name') else name end,
          sort_order = coalesce((p_payload ->> 'sort_order')::integer, sort_order),
          is_archived = coalesce((p_payload ->> 'is_archived')::boolean, is_archived)
        where id = p_entity_id and user_id = v_user_id returning * into v_area;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_area.revision, 'record', to_jsonb(v_area));
      end if;
    end if;

  elsif p_entity_type = 'goal' then
    if p_expected_revision = 0 then
      insert into public.goals (
        id, user_id, title, description, kind, status, life_area_id, baseline_value,
        target_value, target_unit, direction, due_date, sort_order
      ) values (
        p_entity_id, v_user_id, trim(p_payload ->> 'title'), nullif(trim(p_payload ->> 'description'), ''),
        p_payload ->> 'kind', coalesce(p_payload ->> 'status', 'active'), nullif(p_payload ->> 'life_area_id', '')::uuid,
        nullif(p_payload ->> 'baseline_value', '')::numeric, nullif(p_payload ->> 'target_value', '')::numeric,
        nullif(trim(p_payload ->> 'target_unit'), ''), nullif(p_payload ->> 'direction', ''),
        nullif(p_payload ->> 'due_date', '')::date, coalesce((p_payload ->> 'sort_order')::integer, 0)
      ) returning * into v_goal;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_goal.revision, 'record', to_jsonb(v_goal));
    else
      select * into v_goal from public.goals where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_goal.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object(
          'revision', v_goal.revision, 'payload', to_jsonb(v_goal)));
      else
        update public.goals set
          title = case when p_payload ? 'title' then trim(p_payload ->> 'title') else title end,
          description = case when p_payload ? 'description' then nullif(trim(p_payload ->> 'description'), '') else description end,
          kind = coalesce(p_payload ->> 'kind', kind),
          status = coalesce(p_payload ->> 'status', status),
          life_area_id = case when p_payload ? 'life_area_id' then nullif(p_payload ->> 'life_area_id', '')::uuid else life_area_id end,
          baseline_value = case when p_payload ? 'baseline_value' then nullif(p_payload ->> 'baseline_value', '')::numeric else baseline_value end,
          target_value = case when p_payload ? 'target_value' then nullif(p_payload ->> 'target_value', '')::numeric else target_value end,
          target_unit = case when p_payload ? 'target_unit' then nullif(trim(p_payload ->> 'target_unit'), '') else target_unit end,
          direction = case when p_payload ? 'direction' then nullif(p_payload ->> 'direction', '') else direction end,
          due_date = case when p_payload ? 'due_date' then nullif(p_payload ->> 'due_date', '')::date else due_date end,
          sort_order = coalesce((p_payload ->> 'sort_order')::integer, sort_order),
          completed_at = case when p_payload ->> 'status' = 'completed' then coalesce(completed_at, now())
            when p_payload ->> 'status' = 'active' then null else completed_at end,
          archived_at = case when p_payload ->> 'status' = 'archived' then coalesce(archived_at, now())
            when p_payload ->> 'status' in ('active', 'completed') then null else archived_at end
        where id = p_entity_id and user_id = v_user_id returning * into v_goal;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_goal.revision, 'record', to_jsonb(v_goal));
      end if;
    end if;

  elsif p_entity_type = 'goal_update' then
    if p_expected_revision = 0 then
      select kind, target_unit into v_goal_kind, v_target_unit from public.goals
        where id = (p_payload ->> 'goal_id')::uuid and user_id = v_user_id;
      if not found then raise exception 'Goal not found' using errcode = 'P0002'; end if;
      if v_goal_kind = 'measurable' and (
        nullif(p_payload ->> 'value', '') is null
        or nullif(trim(p_payload ->> 'unit'), '') is distinct from v_target_unit
      ) then raise exception 'A measurable update needs a value in the goal unit' using errcode = '23514'; end if;
      if v_goal_kind = 'qualitative' and nullif(trim(p_payload ->> 'note'), '') is null then
        raise exception 'A qualitative update needs a note' using errcode = '23514';
      end if;
      insert into public.goal_updates (id, user_id, goal_id, value, unit, note, source, measured_at)
      values (
        p_entity_id, v_user_id, (p_payload ->> 'goal_id')::uuid,
        nullif(p_payload ->> 'value', '')::numeric, nullif(trim(p_payload ->> 'unit'), ''),
        nullif(trim(p_payload ->> 'note'), ''), trim(p_payload ->> 'source'),
        coalesce(nullif(p_payload ->> 'measured_at', '')::timestamptz, now())
      ) returning * into v_update;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_update.revision, 'record', to_jsonb(v_update));
    else
      select * into v_update from public.goal_updates where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_update.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object(
          'revision', v_update.revision, 'payload', to_jsonb(v_update)));
      else
        select kind, target_unit into v_goal_kind, v_target_unit from public.goals
          where id = v_update.goal_id and user_id = v_user_id;
        if not found then raise exception 'Goal not found' using errcode = 'P0002'; end if;
        if v_goal_kind = 'measurable' and (
          coalesce(nullif(p_payload ->> 'value', '')::numeric, v_update.value) is null
          or coalesce(nullif(trim(p_payload ->> 'unit'), ''), v_update.unit) is distinct from v_target_unit
        ) then raise exception 'A measurable update needs a value in the goal unit' using errcode = '23514'; end if;
        if v_goal_kind = 'qualitative' and nullif(trim(coalesce(p_payload ->> 'note', v_update.note)), '') is null then
          raise exception 'A qualitative update needs a note' using errcode = '23514';
        end if;
        update public.goal_updates set
          value = case when p_payload ? 'value' then nullif(p_payload ->> 'value', '')::numeric else value end,
          unit = case when p_payload ? 'unit' then nullif(trim(p_payload ->> 'unit'), '') else unit end,
          note = case when p_payload ? 'note' then nullif(trim(p_payload ->> 'note'), '') else note end,
          source = case when p_payload ? 'source' then trim(p_payload ->> 'source') else source end,
          measured_at = coalesce(nullif(p_payload ->> 'measured_at', '')::timestamptz, measured_at),
          active = coalesce((p_payload ->> 'active')::boolean, active)
        where id = p_entity_id and user_id = v_user_id returning * into v_update;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_update.revision, 'record', to_jsonb(v_update));
      end if;
    end if;

  else
    if p_expected_revision = 0 then
      insert into public.goal_project_links (id, user_id, goal_id, project_id, active)
      values (
        p_entity_id, v_user_id, (p_payload ->> 'goal_id')::uuid,
        (p_payload ->> 'project_id')::uuid, coalesce((p_payload ->> 'active')::boolean, true)
      ) returning * into v_link;
      v_response := jsonb_build_object('status', 'applied', 'revision', v_link.revision, 'record', to_jsonb(v_link));
    else
      select * into v_link from public.goal_project_links where id = p_entity_id and user_id = v_user_id for update;
      if not found then
        v_response := jsonb_build_object('status', 'not_found');
      elsif v_link.revision <> p_expected_revision then
        v_response := jsonb_build_object('status', 'conflict', 'server', jsonb_build_object(
          'revision', v_link.revision, 'payload', to_jsonb(v_link)));
      else
        update public.goal_project_links set active = coalesce((p_payload ->> 'active')::boolean, active)
          where id = p_entity_id and user_id = v_user_id returning * into v_link;
        v_response := jsonb_build_object('status', 'applied', 'revision', v_link.revision, 'record', to_jsonb(v_link));
      end if;
    end if;
  end if;

  insert into public.sync_mutation_receipts (owner_id, mutation_id, response)
    values (v_user_id, p_mutation_id, v_response);
  return v_response;
end;
$$;

revoke all on function public.apply_goal_mutation(uuid, text, uuid, integer, jsonb) from public, anon;
grant execute on function public.apply_goal_mutation(uuid, text, uuid, integer, jsonb) to authenticated;

create or replace function public.store_google_calendar_connection(
  p_user_id uuid,
  p_provider_email text,
  p_encrypted_refresh_token text,
  p_encryption_iv text,
  p_granted_scopes text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := p_user_id;
begin
  if (select auth.role()) is distinct from 'service_role' or v_user_id is null then
    raise exception 'Server authorization required' using errcode = '42501';
  end if;
  if (p_encrypted_refresh_token is null) <> (p_encryption_iv is null) then
    raise exception 'Encrypted calendar credential fields must be paired' using errcode = '22023';
  end if;
  if p_encrypted_refresh_token is null then
    update public.calendar_connections set
      provider_email = coalesce(nullif(trim(p_provider_email), ''), provider_email),
      granted_scopes = case when coalesce(cardinality(p_granted_scopes), 0) = 0 then granted_scopes else p_granted_scopes end,
      updated_at = now()
    where user_id = v_user_id and provider = 'google';
    if not found then raise exception 'A refresh token is required for a new calendar connection' using errcode = '22023'; end if;
  else
    insert into public.calendar_connections (
      user_id, provider, provider_email, encrypted_refresh_token, encryption_iv, granted_scopes
    ) values (
      v_user_id, 'google', nullif(trim(p_provider_email), ''), p_encrypted_refresh_token,
      p_encryption_iv, coalesce(p_granted_scopes, '{}'::text[])
    ) on conflict (user_id) do update set
      provider = 'google',
      provider_email = coalesce(excluded.provider_email, public.calendar_connections.provider_email),
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      encryption_iv = excluded.encryption_iv,
      granted_scopes = case when cardinality(excluded.granted_scopes) = 0 then public.calendar_connections.granted_scopes else excluded.granted_scopes end,
      updated_at = now();
  end if;
  return jsonb_build_object('connected', true);
end;
$$;

create or replace function public.read_google_calendar_connection(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'provider_email', provider_email,
    'encrypted_refresh_token', encrypted_refresh_token,
    'encryption_iv', encryption_iv,
    'granted_scopes', granted_scopes
  )
  from public.calendar_connections
  where user_id = p_user_id and (select auth.role()) = 'service_role';
$$;

create or replace function public.save_google_calendar_selection(p_user_id uuid, p_calendars jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := p_user_id;
  v_entry jsonb;
  v_count integer;
begin
  if (select auth.role()) is distinct from 'service_role' or v_user_id is null then
    raise exception 'Server authorization required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_calendars) is distinct from 'array' then
    raise exception 'Calendar selection must be an array' using errcode = '22023';
  end if;
  select count(*) into v_count from jsonb_array_elements(p_calendars);
  if v_count > 200 then raise exception 'Too many selected calendars' using errcode = '22023'; end if;

  update public.external_calendars set selected = false
    where user_id = v_user_id and selected;
  for v_entry in select value from jsonb_array_elements(p_calendars) loop
    if nullif(trim(v_entry ->> 'provider_calendar_id'), '') is null
      or nullif(trim(v_entry ->> 'name'), '') is null then
      raise exception 'Calendar selections need an ID and name' using errcode = '22023';
    end if;
    insert into public.external_calendars (
      id, user_id, provider, provider_calendar_id, name, time_zone, selected
    ) values (
      coalesce(nullif(v_entry ->> 'id', '')::uuid, gen_random_uuid()), v_user_id, 'google', trim(v_entry ->> 'provider_calendar_id'),
      trim(v_entry ->> 'name'), nullif(trim(v_entry ->> 'time_zone'), ''),
      coalesce((v_entry ->> 'selected')::boolean, false)
    ) on conflict (user_id, provider, provider_calendar_id) do update set
      name = excluded.name,
      time_zone = excluded.time_zone,
      selected = excluded.selected
    where public.external_calendars.user_id = v_user_id;
  end loop;

  delete from public.external_calendar_events e
    using public.external_calendars c
    where e.external_calendar_id = c.id and e.user_id = v_user_id
      and c.user_id = v_user_id and not c.selected;
  return jsonb_build_object('saved', true);
end;
$$;

create or replace function public.import_google_calendar_events(
  p_user_id uuid,
  p_calendar_ids uuid[],
  p_events jsonb,
  p_from timestamptz,
  p_through timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := p_user_id;
  v_entry jsonb;
  v_calendar public.external_calendars%rowtype;
  v_imported integer := 0;
begin
  if (select auth.role()) is distinct from 'service_role' or v_user_id is null then
    raise exception 'Server authorization required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'Imported calendar events must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 5000 then raise exception 'Too many calendar events in one import' using errcode = '22023'; end if;
  if p_from is null or p_through is null or p_through <= p_from then
    raise exception 'A valid import range is required' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_calendar_ids, '{}'::uuid[])) requested(id)
    left join public.external_calendars c
      on c.id = requested.id and c.user_id = v_user_id and c.selected
    where c.id is null
  ) then
    raise exception 'Only selected calendars can be imported' using errcode = '42501';
  end if;

  delete from public.external_calendar_events cached
  where cached.user_id = v_user_id
    and cached.external_calendar_id = any(coalesce(p_calendar_ids, '{}'::uuid[]))
    and cached.starts_at < p_through and cached.ends_at > p_from
    and not exists (
      select 1 from jsonb_array_elements(p_events) incoming
      where incoming ->> 'external_calendar_id' = cached.external_calendar_id::text
        and incoming ->> 'provider_event_id' = cached.provider_event_id
    );

  for v_entry in select value from jsonb_array_elements(p_events) loop
    select * into v_calendar from public.external_calendars
      where id = (v_entry ->> 'external_calendar_id')::uuid
        and user_id = v_user_id and selected;
    if not found or not (v_calendar.id = any(coalesce(p_calendar_ids, '{}'::uuid[]))) then
      raise exception 'Only selected calendars can be imported' using errcode = '42501';
    end if;
    if nullif(trim(v_entry ->> 'provider_event_id'), '') is null
      or nullif(trim(v_entry ->> 'title'), '') is null then
      raise exception 'Imported events need a provider ID and title' using errcode = '22023';
    end if;
    insert into public.external_calendar_events (
      id, user_id, external_calendar_id, provider_event_id, title, description,
      starts_at, ends_at, time_zone, source_updated_at, imported_at
    ) values (
      gen_random_uuid(), v_user_id, v_calendar.id, trim(v_entry ->> 'provider_event_id'),
      trim(v_entry ->> 'title'), nullif(trim(v_entry ->> 'description'), ''),
      (v_entry ->> 'starts_at')::timestamptz, (v_entry ->> 'ends_at')::timestamptz,
      coalesce(nullif(trim(v_entry ->> 'time_zone'), ''), 'UTC'),
      nullif(v_entry ->> 'source_updated_at', '')::timestamptz, now()
    ) on conflict (external_calendar_id, provider_event_id) do update set
      title = excluded.title,
      description = excluded.description,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      time_zone = excluded.time_zone,
      source_updated_at = excluded.source_updated_at,
      imported_at = excluded.imported_at;
    v_imported := v_imported + 1;
  end loop;
  return jsonb_build_object('imported', v_imported);
end;
$$;

create or replace function public.disconnect_google_calendar()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  delete from public.external_calendars where user_id = v_user_id and provider = 'google';
  delete from public.calendar_connections where user_id = v_user_id and provider = 'google';
  return jsonb_build_object('connected', false);
end;
$$;

revoke all on function public.store_google_calendar_connection(uuid, text, text, text, text[]) from public, anon, authenticated;
revoke all on function public.read_google_calendar_connection(uuid) from public, anon, authenticated;
revoke all on function public.save_google_calendar_selection(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.import_google_calendar_events(uuid, uuid[], jsonb, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.disconnect_google_calendar() from public, anon;
grant execute on function public.store_google_calendar_connection(uuid, text, text, text, text[]) to service_role;
grant execute on function public.read_google_calendar_connection(uuid) to service_role;
grant execute on function public.save_google_calendar_selection(uuid, jsonb) to service_role;
grant execute on function public.import_google_calendar_events(uuid, uuid[], jsonb, timestamptz, timestamptz) to service_role;
grant execute on function public.disconnect_google_calendar() to authenticated;
