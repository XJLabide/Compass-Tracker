create table public.sync_probe_records (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sync_probe_records enable row level security;
revoke all on public.sync_probe_records from anon, authenticated;
grant select on public.sync_probe_records to authenticated;

create policy "Users can read their own sync probe records"
  on public.sync_probe_records for select to authenticated
  using ((select auth.uid()) = owner_id);

create table public.record_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  record_type text not null check (record_type <> ''),
  record_id uuid not null,
  revision integer not null check (revision > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  unique (owner_id, record_type, record_id, revision),
  check (expires_at > created_at)
);

alter table public.record_versions enable row level security;
revoke all on public.record_versions from anon, authenticated;
grant select on public.record_versions to authenticated;

create policy "Users can read their own record versions"
  on public.record_versions for select to authenticated
  using ((select auth.uid()) = owner_id);

create table public.sync_mutation_receipts (
  owner_id uuid not null references auth.users (id) on delete cascade,
  mutation_id uuid not null,
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  primary key (owner_id, mutation_id)
);

alter table public.sync_mutation_receipts enable row level security;
revoke all on public.sync_mutation_receipts from anon, authenticated;

create table public.account_deletion_tombstones (
  owner_id uuid primary key,
  deleted_at timestamptz not null default now(),
  purge_after timestamptz not null default (now() + interval '7 days'),
  check (purge_after >= deleted_at)
);

alter table public.account_deletion_tombstones enable row level security;
revoke all on public.account_deletion_tombstones from anon, authenticated;

create or replace function public.apply_sync_probe_mutation(
  p_mutation_id uuid,
  p_record_id uuid,
  p_expected_revision integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_response jsonb;
  v_record public.sync_probe_records%rowtype;
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_mutation_id is null or p_record_id is null or p_expected_revision < 0
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid sync mutation' using errcode = '22023';
  end if;

  select response into v_response
    from public.sync_mutation_receipts
    where owner_id = v_owner_id and mutation_id = p_mutation_id;
  if found then return v_response; end if;

  if p_expected_revision = 0 then
    insert into public.sync_probe_records (id, owner_id, payload)
      values (p_record_id, v_owner_id, p_payload)
      on conflict (id) do nothing
      returning * into v_record;

    if found then
      v_response := jsonb_build_object(
        'status', 'applied',
        'revision', v_record.revision,
        'record', jsonb_build_object('id', v_record.id, 'payload', v_record.payload)
      );
      insert into public.sync_mutation_receipts (owner_id, mutation_id, response)
        values (v_owner_id, p_mutation_id, v_response);
      return v_response;
    end if;
  end if;

  select * into v_record
    from public.sync_probe_records
    where id = p_record_id and owner_id = v_owner_id
    for update;

  if not found then
    v_response := jsonb_build_object('status', 'not_found');
  else
    -- Recheck after acquiring the record lock so concurrent replays of one mutation are idempotent.
    select response into v_response
      from public.sync_mutation_receipts
      where owner_id = v_owner_id and mutation_id = p_mutation_id;
    if found then return v_response; end if;

    if v_record.revision <> p_expected_revision then
      v_response := jsonb_build_object(
        'status', 'conflict',
        'server', jsonb_build_object(
          'id', v_record.id,
          'revision', v_record.revision,
          'payload', v_record.payload,
          'updatedAt', v_record.updated_at
        )
      );
    else
      insert into public.record_versions (owner_id, record_type, record_id, revision, snapshot)
        values (
          v_owner_id,
          'sync_probe',
          v_record.id,
          v_record.revision,
          jsonb_build_object(
            'id', v_record.id,
            'payload', v_record.payload,
            'revision', v_record.revision,
            'updatedAt', v_record.updated_at
          )
        );

      update public.sync_probe_records
        set payload = p_payload,
            revision = revision + 1,
            updated_at = now()
        where id = v_record.id
        returning * into v_record;

      v_response := jsonb_build_object(
        'status', 'applied',
        'revision', v_record.revision,
        'record', jsonb_build_object('id', v_record.id, 'payload', v_record.payload)
      );
    end if;
  end if;

  insert into public.sync_mutation_receipts (owner_id, mutation_id, response)
    values (v_owner_id, p_mutation_id, v_response);
  return v_response;
end;
$$;

revoke all on function public.apply_sync_probe_mutation(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.apply_sync_probe_mutation(uuid, uuid, integer, jsonb) to authenticated;
