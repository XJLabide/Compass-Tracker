-- Provider credentials, selection writes, and imported snapshots only flow through
-- authenticated server routes. Do not expose these RPCs to browser sessions.
drop function if exists public.store_google_calendar_connection(text, text, text, text[]);
drop function if exists public.read_google_calendar_connection();
drop function if exists public.save_google_calendar_selection(jsonb);
drop function if exists public.import_google_calendar_events(jsonb);

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

revoke all on function public.store_google_calendar_connection(uuid, text, text, text, text[]) from public, anon, authenticated;
revoke all on function public.read_google_calendar_connection(uuid) from public, anon, authenticated;
revoke all on function public.save_google_calendar_selection(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.import_google_calendar_events(uuid, uuid[], jsonb, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.store_google_calendar_connection(uuid, text, text, text, text[]) to service_role;
grant execute on function public.read_google_calendar_connection(uuid) to service_role;
grant execute on function public.save_google_calendar_selection(uuid, jsonb) to service_role;
grant execute on function public.import_google_calendar_events(uuid, uuid[], jsonb, timestamptz, timestamptz) to service_role;
