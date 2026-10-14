-- Flexible personal budget cycles and account-to-account transfers.
create table public.finance_budget_cycles (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  period_start date not null,
  period_end date not null,
  total_amount_minor bigint not null check (total_amount_minor > 0),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start and period_end <= period_start + 365),
  unique (id, user_id),
  unique (user_id, currency, period_start, period_end)
);
create index finance_budget_cycles_by_period on public.finance_budget_cycles (user_id, currency, period_start desc, period_end);

create table public.finance_budget_category_limits (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  cycle_id uuid not null,
  category text not null check (length(trim(category)) > 0),
  amount_minor bigint not null check (amount_minor > 0),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (cycle_id, user_id) references public.finance_budget_cycles (id, user_id) on delete cascade,
  unique (id, user_id),
  unique (cycle_id, category)
);
create index finance_budget_category_limits_by_cycle on public.finance_budget_category_limits (user_id, cycle_id, category);

create table public.finance_transfers (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  from_account_id uuid not null,
  to_account_id uuid not null,
  from_amount_minor bigint not null check (from_amount_minor > 0),
  from_currency text not null check (from_currency ~ '^[A-Z]{3}$'),
  to_amount_minor bigint not null check (to_amount_minor > 0),
  to_currency text not null check (to_currency ~ '^[A-Z]{3}$'),
  local_date date not null,
  rate numeric(30, 12) check (rate is null or rate > 0),
  source text,
  as_of timestamptz,
  notes text,
  active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (from_account_id, user_id) references public.finance_accounts (id, user_id) on delete cascade,
  foreign key (to_account_id, user_id) references public.finance_accounts (id, user_id) on delete cascade,
  unique (id, user_id),
  check (from_account_id <> to_account_id),
  check (
    (from_currency = to_currency and from_amount_minor = to_amount_minor and rate is null and source is null and as_of is null)
    or (from_currency <> to_currency and rate is not null and rate > 0 and source is not null and length(trim(source)) > 0 and as_of is not null)
  )
);
create index finance_transfers_by_date on public.finance_transfers (user_id, local_date desc, id) where active;

-- Preserve existing month/category limits as dated cycles with their former total equal to the sum of their categories.
insert into public.finance_budget_cycles (id, user_id, currency, period_start, period_end, total_amount_minor)
select md5(user_id::text || ':' || currency || ':' || period_start::text)::uuid,
       user_id, currency, period_start,
       (date_trunc('month', period_start::timestamp) + interval '1 month - 1 day')::date,
       sum(amount_minor)
from public.finance_budgets
where active
group by user_id, currency, period_start;

insert into public.finance_budget_category_limits (id, user_id, cycle_id, category, amount_minor)
select budgets.id, budgets.user_id,
       md5(budgets.user_id::text || ':' || budgets.currency || ':' || budgets.period_start::text)::uuid,
       budgets.category, budgets.amount_minor
from public.finance_budgets budgets
where budgets.active;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['finance_budget_cycles', 'finance_budget_category_limits', 'finance_transfers'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.capture_daily_before_image()', v_table || '_capture_before_image', v_table);
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('grant select on public.%I to authenticated', v_table);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id)', v_table || '_read_owner', v_table);
  end loop;
end;
$$;

create or replace function public.validate_finance_transfer_accounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from_currency text;
  v_to_currency text;
begin
  select currency into v_from_currency from public.finance_accounts where id = new.from_account_id and user_id = new.user_id;
  if not found then raise exception 'Source finance account not found' using errcode = 'P0002'; end if;
  select currency into v_to_currency from public.finance_accounts where id = new.to_account_id and user_id = new.user_id;
  if not found then raise exception 'Destination finance account not found' using errcode = 'P0002'; end if;
  if new.from_currency <> v_from_currency or new.to_currency <> v_to_currency then
    raise exception 'Transfer currencies must match their accounts' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger finance_transfers_match_account_currencies
before insert or update of from_account_id, to_account_id, user_id, from_currency, to_currency
on public.finance_transfers for each row execute function public.validate_finance_transfer_accounts();

create or replace function public.apply_finance_flow_mutation(
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
  v_row jsonb;
  v_revision integer;
  v_cycle_id uuid;
  v_cycle public.finance_budget_cycles%rowtype;
  v_total bigint;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_mutation_id is null or p_entity_id is null or p_expected_revision is null or p_expected_revision < 0
    or p_entity_type is null or p_entity_type not in ('finance_budget_cycle', 'finance_budget_category_limit', 'finance_transfer')
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid finance flow mutation' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select response into v_receipt from public.sync_mutation_receipts where owner_id = v_user_id and mutation_id = p_mutation_id;
  if found then return v_receipt; end if;

  if p_entity_type = 'finance_budget_cycle' then
    v_cycle_id := p_entity_id;
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':finance-budget-cycles', 0));
    if p_expected_revision = 0 then
      if exists (
        select 1 from public.finance_budget_cycles c
        where c.user_id = v_user_id
          and c.currency = upper(p_payload->>'currency')
          and daterange(c.period_start, c.period_end, '[]') && daterange((p_payload->>'period_start')::date, (p_payload->>'period_end')::date, '[]')
      ) then raise exception 'A budget period already overlaps those dates for this currency' using errcode = '23P01'; end if;
      insert into public.finance_budget_cycles (id,user_id,currency,period_start,period_end,total_amount_minor)
      values (p_entity_id,v_user_id,upper(p_payload->>'currency'),(p_payload->>'period_start')::date,(p_payload->>'period_end')::date,(p_payload->>'total_amount_minor')::bigint)
      returning to_jsonb(finance_budget_cycles),revision into v_row,v_revision;
      v_response := jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
    else
      select to_jsonb(c),c.revision into v_row,v_revision from public.finance_budget_cycles c where c.id=p_entity_id and c.user_id=v_user_id for update;
      if not found then v_response:=jsonb_build_object('status','not_found');
      elsif v_revision<>p_expected_revision then v_response:=jsonb_build_object('status','conflict','server',jsonb_build_object('revision',v_revision,'payload',v_row));
      else
        select * into v_cycle from public.finance_budget_cycles where id=p_entity_id and user_id=v_user_id;
        if exists (
          select 1 from public.finance_budget_cycles c
          where c.user_id=v_user_id and c.id<>p_entity_id and c.currency=v_cycle.currency
            and daterange(c.period_start,c.period_end,'[]') && daterange(coalesce(nullif(p_payload->>'period_start','')::date,v_cycle.period_start),coalesce(nullif(p_payload->>'period_end','')::date,v_cycle.period_end),'[]')
        ) then raise exception 'A budget period already overlaps those dates for this currency' using errcode = '23P01'; end if;
        select coalesce(sum(amount_minor),0) into v_total from public.finance_budget_category_limits where cycle_id=p_entity_id and user_id=v_user_id;
        if v_total > coalesce((p_payload->>'total_amount_minor')::bigint,v_cycle.total_amount_minor) then
          raise exception 'Category limits cannot exceed the overall budget cap' using errcode = '23514';
        end if;
        update public.finance_budget_cycles set period_start=coalesce(nullif(p_payload->>'period_start','')::date,period_start),period_end=coalesce(nullif(p_payload->>'period_end','')::date,period_end),total_amount_minor=coalesce((p_payload->>'total_amount_minor')::bigint,total_amount_minor)
        where id=p_entity_id and user_id=v_user_id returning to_jsonb(finance_budget_cycles),revision into v_row,v_revision;
        v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
      end if;
    end if;

  elsif p_entity_type = 'finance_budget_category_limit' then
    v_cycle_id := (p_payload->>'cycle_id')::uuid;
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':finance-budget-cycle:' || v_cycle_id::text, 0));
    select * into v_cycle from public.finance_budget_cycles where id=v_cycle_id and user_id=v_user_id for update;
    if not found then raise exception 'Budget cycle not found' using errcode = 'P0002'; end if;
    if p_expected_revision = 0 then
      select coalesce(sum(amount_minor),0) into v_total from public.finance_budget_category_limits where cycle_id=v_cycle_id and user_id=v_user_id;
      if v_total + (p_payload->>'amount_minor')::bigint > v_cycle.total_amount_minor then
        raise exception 'Category limits cannot exceed the overall budget cap' using errcode = '23514';
      end if;
      insert into public.finance_budget_category_limits (id,user_id,cycle_id,category,amount_minor)
      values (p_entity_id,v_user_id,v_cycle_id,trim(p_payload->>'category'),(p_payload->>'amount_minor')::bigint)
      returning to_jsonb(finance_budget_category_limits),revision into v_row,v_revision;
      v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
    else
      select to_jsonb(t),t.revision into v_row,v_revision from public.finance_budget_category_limits t where t.id=p_entity_id and t.user_id=v_user_id for update;
      if not found then v_response:=jsonb_build_object('status','not_found');
      elsif v_revision<>p_expected_revision then v_response:=jsonb_build_object('status','conflict','server',jsonb_build_object('revision',v_revision,'payload',v_row));
      else
        select coalesce(sum(amount_minor),0) into v_total from public.finance_budget_category_limits where cycle_id=v_cycle_id and user_id=v_user_id and id<>p_entity_id;
        if v_total + coalesce((p_payload->>'amount_minor')::bigint, (v_row->>'amount_minor')::bigint) > v_cycle.total_amount_minor then
          raise exception 'Category limits cannot exceed the overall budget cap' using errcode = '23514';
        end if;
        update public.finance_budget_category_limits set category=coalesce(nullif(trim(p_payload->>'category'),''),category),amount_minor=coalesce((p_payload->>'amount_minor')::bigint,amount_minor)
        where id=p_entity_id and user_id=v_user_id returning to_jsonb(finance_budget_category_limits),revision into v_row,v_revision;
        v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
      end if;
    end if;

  else
    if p_expected_revision = 0 then
      insert into public.finance_transfers (id,user_id,from_account_id,to_account_id,from_amount_minor,from_currency,to_amount_minor,to_currency,local_date,rate,source,as_of,notes,active)
      values (p_entity_id,v_user_id,(p_payload->>'from_account_id')::uuid,(p_payload->>'to_account_id')::uuid,(p_payload->>'from_amount_minor')::bigint,upper(p_payload->>'from_currency'),(p_payload->>'to_amount_minor')::bigint,upper(p_payload->>'to_currency'),(p_payload->>'local_date')::date,nullif(p_payload->>'rate','')::numeric,nullif(trim(p_payload->>'source'),''),nullif(p_payload->>'as_of','')::timestamptz,nullif(trim(p_payload->>'notes'),''),coalesce((p_payload->>'active')::boolean,true))
      returning to_jsonb(finance_transfers),revision into v_row,v_revision;
      v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
    else
      select to_jsonb(t),t.revision into v_row,v_revision from public.finance_transfers t where t.id=p_entity_id and t.user_id=v_user_id for update;
      if not found then v_response:=jsonb_build_object('status','not_found');
      elsif v_revision<>p_expected_revision then v_response:=jsonb_build_object('status','conflict','server',jsonb_build_object('revision',v_revision,'payload',v_row));
      else
        update public.finance_transfers set active=coalesce((p_payload->>'active')::boolean,active),notes=case when p_payload ? 'notes' then nullif(trim(p_payload->>'notes'),'') else notes end
        where id=p_entity_id and user_id=v_user_id returning to_jsonb(finance_transfers),revision into v_row,v_revision;
        v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
      end if;
    end if;
  end if;

  insert into public.sync_mutation_receipts (owner_id,mutation_id,response) values (v_user_id,p_mutation_id,v_response);
  return v_response;
end;
$$;

revoke all on function public.apply_finance_flow_mutation(uuid,text,uuid,integer,jsonb) from public, anon;
grant execute on function public.apply_finance_flow_mutation(uuid,text,uuid,integer,jsonb) to authenticated;
