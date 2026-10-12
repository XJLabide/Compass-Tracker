alter function public.apply_daily_mutation(uuid, text, uuid, integer, text, jsonb)
  rename to apply_daily_mutation_once;

alter function public.finish_daily_plan(uuid, uuid, integer, jsonb, text, jsonb)
  rename to finish_daily_plan_once;

revoke all on function public.apply_daily_mutation_once(uuid, text, uuid, integer, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.finish_daily_plan_once(uuid, uuid, integer, jsonb, text, jsonb)
  from public, anon, authenticated;

create function public.apply_daily_mutation(
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
  v_response jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_mutation_id is null then raise exception 'Mutation ID is required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select response into v_response from public.sync_mutation_receipts
    where owner_id = v_user_id and mutation_id = p_mutation_id;
  if found then return v_response; end if;
  return public.apply_daily_mutation_once(
    p_mutation_id, p_entity_type, p_entity_id, p_expected_revision, p_operation, p_payload
  );
end;
$$;

create function public.finish_daily_plan(
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
  v_response jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_mutation_id is null then raise exception 'Mutation ID is required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select response into v_response from public.sync_mutation_receipts
    where owner_id = v_user_id and mutation_id = p_mutation_id;
  if found then return v_response; end if;

  v_response := public.finish_daily_plan_once(
    p_mutation_id, p_plan_id, p_expected_revision, p_outcomes, p_reflection, p_carry_forward
  );
  insert into public.sync_mutation_receipts (owner_id, mutation_id, response)
    values (v_user_id, p_mutation_id, v_response)
    on conflict (owner_id, mutation_id) do nothing;
  select response into v_response from public.sync_mutation_receipts
    where owner_id = v_user_id and mutation_id = p_mutation_id;
  return v_response;
end;
$$;

revoke all on function public.apply_daily_mutation(uuid, text, uuid, integer, text, jsonb) from public, anon;
revoke all on function public.finish_daily_plan(uuid, uuid, integer, jsonb, text, jsonb) from public, anon;
grant execute on function public.apply_daily_mutation(uuid, text, uuid, integer, text, jsonb) to authenticated;
grant execute on function public.finish_daily_plan(uuid, uuid, integer, jsonb, text, jsonb) to authenticated;
