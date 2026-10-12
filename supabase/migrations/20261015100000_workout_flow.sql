-- Preserve date-specific session plans and complete workout time ranges in
-- owner-scoped records. The existing before-image trigger keeps prior edits
-- available to recovery.
alter table public.strength_session_overrides
  add column exercises jsonb check (exercises is null or jsonb_typeof(exercises) = 'array');

alter table public.workout_logs
  add column started_at timestamptz,
  add constraint workout_logs_time_range_valid check (started_at is null or completed_at >= started_at);

-- Extend the installed mutation implementation without rewriting its
-- idempotency, ownership checks, conflict handling, or recovery behavior.
do $$
declare
  v_definition text := pg_get_functiondef(
    'public.apply_fitness_mutation_once(uuid,text,uuid,integer,jsonb)'::regprocedure
  );
  v_old text;
begin
  v_old := $old$insert into public.strength_session_overrides (id, user_id, program_day_id, local_date, title, notes, skipped)
      values ($old$;
  if position(v_old in v_definition) = 0 then raise exception 'Could not locate override insert in fitness mutation'; end if;
  v_definition := replace(v_definition, v_old,
    $new$insert into public.strength_session_overrides (id, user_id, program_day_id, local_date, title, notes, skipped, exercises)
      values ($new$);

  v_old := $old$coalesce((p_payload ->> 'skipped')::boolean, false)
      ) returning * into v_override;$old$;
  if position(v_old in v_definition) = 0 then raise exception 'Could not locate override values in fitness mutation'; end if;
  v_definition := replace(v_definition, v_old,
    $new$coalesce((p_payload ->> 'skipped')::boolean, false),
        nullif(p_payload -> 'exercises', 'null'::jsonb)
      ) returning * into v_override;$new$);

  v_old := $old$skipped = coalesce((p_payload ->> 'skipped')::boolean, skipped)
        where id = p_entity_id and user_id = v_user_id returning * into v_override;$old$;
  if position(v_old in v_definition) = 0 then raise exception 'Could not locate override update in fitness mutation'; end if;
  v_definition := replace(v_definition, v_old,
    $new$skipped = coalesce((p_payload ->> 'skipped')::boolean, skipped),
          exercises = case when p_payload ? 'exercises' then nullif(p_payload -> 'exercises', 'null'::jsonb) else exercises end
        where id = p_entity_id and user_id = v_user_id returning * into v_override;$new$);

  v_old := $old$title_snapshot, completed_at, notes, exercises, status
      ) values ($old$;
  if position(v_old in v_definition) = 0 then raise exception 'Could not locate workout insert columns in fitness mutation'; end if;
  v_definition := replace(v_definition, v_old,
    $new$title_snapshot, started_at, completed_at, notes, exercises, status
      ) values ($new$);

  v_old := $old$coalesce(nullif(trim(p_payload ->> 'title_snapshot'), ''), v_title_snapshot, 'Workout'),
        coalesce(nullif(p_payload ->> 'completed_at', '')::timestamptz, now()),$old$;
  if position(v_old in v_definition) = 0 then raise exception 'Could not locate workout insert values in fitness mutation'; end if;
  v_definition := replace(v_definition, v_old,
    $new$coalesce(nullif(trim(p_payload ->> 'title_snapshot'), ''), v_title_snapshot, 'Workout'),
        nullif(p_payload ->> 'started_at', '')::timestamptz,
        coalesce(nullif(p_payload ->> 'completed_at', '')::timestamptz, now()),$new$);

  v_old := $old$update public.workout_logs set
          notes = case when p_payload ? 'notes' then nullif(trim(p_payload ->> 'notes'), '') else notes end,
          status = coalesce(p_payload ->> 'status', status)$old$;
  if position(v_old in v_definition) = 0 then raise exception 'Could not locate workout update in fitness mutation'; end if;
  v_definition := replace(v_definition, v_old,
    $new$update public.workout_logs set
          local_date = case when p_payload ? 'local_date' then (p_payload ->> 'local_date')::date else local_date end,
          timezone = coalesce(nullif(trim(p_payload ->> 'timezone'), ''), timezone),
          title_snapshot = coalesce(nullif(trim(p_payload ->> 'title_snapshot'), ''), title_snapshot),
          started_at = case when p_payload ? 'started_at' then nullif(p_payload ->> 'started_at', '')::timestamptz else started_at end,
          completed_at = coalesce(nullif(p_payload ->> 'completed_at', '')::timestamptz, completed_at),
          notes = case when p_payload ? 'notes' then nullif(trim(p_payload ->> 'notes'), '') else notes end,
          exercises = case when p_payload ? 'exercises' then public.validate_logged_strength_exercises(p_payload -> 'exercises') else exercises end,
          status = coalesce(p_payload ->> 'status', status)$new$);

  execute v_definition;
end;
$$;
