-- Manual-first finance records with exact minor-unit storage and recoverable edits.
create table public.finance_accounts (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  account_type text not null check (account_type in ('cash', 'checking', 'savings', 'credit', 'investment', 'other')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  opening_balance_minor bigint not null check (opening_balance_minor >= 0),
  opened_on date not null,
  closed_on date,
  active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closed_on is null or closed_on >= opened_on),
  unique (id, user_id)
);
create index finance_accounts_by_owner on public.finance_accounts (user_id, active, name);

create table public.finance_transactions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null,
  transaction_type text not null check (transaction_type in ('income', 'expense')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  local_date date not null,
  category text not null check (length(trim(category)) > 0),
  description text not null check (length(trim(description)) > 0),
  notes text,
  active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, user_id) references public.finance_accounts (id, user_id) on delete cascade,
  unique (id, user_id)
);
create index finance_transactions_by_date on public.finance_transactions (user_id, local_date desc, account_id) where active;

create table public.finance_budgets (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (length(trim(category)) > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  period_start date not null check (extract(day from period_start) = 1),
  amount_minor bigint not null check (amount_minor > 0),
  active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category, currency, period_start),
  unique (id, user_id)
);
create index finance_budgets_by_period on public.finance_budgets (user_id, period_start desc, active);

create table public.finance_recurring_charges (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid,
  name text not null check (length(trim(name)) > 0),
  category text not null check (length(trim(category)) > 0),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  cadence text not null check (cadence in ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_due_on date not null,
  notes text,
  active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, user_id) references public.finance_accounts (id, user_id) on delete set null (account_id),
  unique (id, user_id)
);
create index finance_recurring_by_due_date on public.finance_recurring_charges (user_id, next_due_on) where active;

create table public.finance_positions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  position_type text not null check (position_type in ('asset', 'debt', 'holding')),
  account_id uuid,
  name text not null check (length(trim(name)) > 0),
  symbol text,
  quantity numeric(24, 8),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  opened_on date not null,
  closed_on date,
  active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closed_on is null or closed_on >= opened_on),
  check ((position_type = 'holding' and nullif(trim(symbol), '') is not null and quantity > 0) or (position_type <> 'holding' and quantity is null)),
  foreign key (account_id, user_id) references public.finance_accounts (id, user_id) on delete set null (account_id),
  unique (id, user_id)
);
create index finance_positions_by_owner on public.finance_positions (user_id, position_type, active);

create table public.finance_position_valuations (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  position_id uuid not null,
  local_date date not null,
  as_of timestamptz not null,
  value_minor bigint check (value_minor is null or value_minor >= 0),
  unit_price_minor bigint check (unit_price_minor is null or unit_price_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  source text not null check (length(trim(source)) > 0),
  freshness text not null check (freshness in ('fresh', 'stale', 'unavailable')),
  reason text,
  notes text,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((freshness = 'unavailable' and value_minor is null) or (freshness <> 'unavailable' and value_minor is not null)),
  foreign key (position_id, user_id) references public.finance_positions (id, user_id) on delete cascade,
  unique (user_id, position_id, local_date),
  unique (id, user_id)
);
create index finance_valuations_by_position_date on public.finance_position_valuations (user_id, position_id, local_date desc);

create table public.finance_fx_rates (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text not null check (quote_currency ~ '^[A-Z]{3}$'),
  rate numeric(30, 12) check (rate is null or rate > 0),
  source text not null check (length(trim(source)) > 0),
  as_of timestamptz not null,
  freshness text not null check (freshness in ('fresh', 'stale', 'unavailable')),
  reason text,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (base_currency <> quote_currency),
  check ((freshness = 'unavailable' and rate is null) or (freshness <> 'unavailable' and rate is not null)),
  unique (id, user_id)
);
create index finance_fx_rates_by_pair_date on public.finance_fx_rates (user_id, base_currency, quote_currency, as_of desc);

create table public.finance_conversions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  fx_rate_id uuid,
  local_date date not null,
  from_amount_minor bigint not null check (from_amount_minor > 0),
  from_currency text not null check (from_currency ~ '^[A-Z]{3}$'),
  to_amount_minor bigint not null check (to_amount_minor >= 0),
  to_currency text not null check (to_currency ~ '^[A-Z]{3}$'),
  rate numeric(30, 12) not null check (rate > 0),
  source text not null check (length(trim(source)) > 0),
  as_of timestamptz not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  foreign key (fx_rate_id, user_id) references public.finance_fx_rates (id, user_id) on delete set null (fx_rate_id),
  unique (id, user_id),
  check (from_currency <> to_currency)
);
create index finance_conversions_by_date on public.finance_conversions (user_id, local_date desc);

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'finance_accounts', 'finance_transactions', 'finance_budgets', 'finance_recurring_charges',
    'finance_positions', 'finance_position_valuations', 'finance_fx_rates', 'finance_conversions'
  ] loop
    if v_table <> 'finance_conversions' then
      execute format('create trigger %I before update on public.%I for each row execute function public.capture_daily_before_image()', v_table || '_capture_before_image', v_table);
    end if;
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('grant select on public.%I to authenticated', v_table);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id)', v_table || '_read_owner', v_table);
  end loop;
end;
$$;

create or replace function public.validate_finance_account_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_currency text;
begin
  if new.account_id is null then return new; end if;
  select currency into v_currency from public.finance_accounts where id = new.account_id and user_id = new.user_id;
  if not found then raise exception 'Finance account not found' using errcode = 'P0002'; end if;
  if new.currency <> v_currency then raise exception 'Transaction currency must match the selected account' using errcode = '23514'; end if;
  return new;
end;
$$;

create trigger finance_transactions_match_account_currency
  before insert or update of account_id, user_id, currency on public.finance_transactions
  for each row execute function public.validate_finance_account_currency();
create trigger finance_recurring_match_account_currency
  before insert or update of account_id, user_id, currency on public.finance_recurring_charges
  for each row execute function public.validate_finance_account_currency();

create or replace function public.apply_finance_mutation(
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
  v_position public.finance_positions%rowtype;
  v_valuation_value bigint;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_mutation_id is null or p_entity_id is null or p_expected_revision is null or p_expected_revision < 0
    or p_entity_type is null or p_entity_type not in (
      'finance_account', 'finance_transaction', 'finance_budget', 'finance_recurring_charge',
      'finance_position', 'finance_valuation', 'finance_fx_rate', 'finance_conversion'
    ) or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid finance mutation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select response into v_receipt from public.sync_mutation_receipts where owner_id = v_user_id and mutation_id = p_mutation_id;
  if found then return v_receipt; end if;

  if p_entity_type = 'finance_account' then
    if p_expected_revision = 0 then
      insert into public.finance_accounts (id,user_id,name,account_type,currency,opening_balance_minor,opened_on,closed_on,active)
      values (p_entity_id,v_user_id,trim(p_payload->>'name'),p_payload->>'account_type',upper(p_payload->>'currency'),(p_payload->>'opening_balance_minor')::bigint,(p_payload->>'opened_on')::date,nullif(p_payload->>'closed_on','')::date,coalesce((p_payload->>'active')::boolean,true))
      returning to_jsonb(finance_accounts),revision into v_row,v_revision;
      v_response := jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
    else
      select to_jsonb(t),t.revision into v_row,v_revision from public.finance_accounts t where t.id=p_entity_id and t.user_id=v_user_id for update;
      if not found then v_response:=jsonb_build_object('status','not_found');
      elsif v_revision<>p_expected_revision then v_response:=jsonb_build_object('status','conflict','server',jsonb_build_object('revision',v_revision,'payload',v_row));
      else
        update public.finance_accounts set name=coalesce(nullif(trim(p_payload->>'name'),''),name),account_type=coalesce(p_payload->>'account_type',account_type),opening_balance_minor=coalesce((p_payload->>'opening_balance_minor')::bigint,opening_balance_minor),opened_on=coalesce(nullif(p_payload->>'opened_on','')::date,opened_on),closed_on=case when p_payload ? 'closed_on' then nullif(p_payload->>'closed_on','')::date else closed_on end,active=coalesce((p_payload->>'active')::boolean,active)
        where id=p_entity_id and user_id=v_user_id returning to_jsonb(finance_accounts),revision into v_row,v_revision;
        v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
      end if;
    end if;

  elsif p_entity_type = 'finance_transaction' then
    if p_expected_revision = 0 then
      insert into public.finance_transactions (id,user_id,account_id,transaction_type,amount_minor,currency,local_date,category,description,notes,active)
      values (p_entity_id,v_user_id,(p_payload->>'account_id')::uuid,p_payload->>'transaction_type',(p_payload->>'amount_minor')::bigint,upper(p_payload->>'currency'),(p_payload->>'local_date')::date,trim(p_payload->>'category'),trim(p_payload->>'description'),nullif(trim(p_payload->>'notes'),''),coalesce((p_payload->>'active')::boolean,true))
      returning to_jsonb(finance_transactions),revision into v_row,v_revision;
      v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
    else
      select to_jsonb(t),t.revision into v_row,v_revision from public.finance_transactions t where t.id=p_entity_id and t.user_id=v_user_id for update;
      if not found then v_response:=jsonb_build_object('status','not_found');
      elsif v_revision<>p_expected_revision then v_response:=jsonb_build_object('status','conflict','server',jsonb_build_object('revision',v_revision,'payload',v_row));
      else
        update public.finance_transactions set account_id=coalesce(nullif(p_payload->>'account_id','')::uuid,account_id),transaction_type=coalesce(p_payload->>'transaction_type',transaction_type),amount_minor=coalesce((p_payload->>'amount_minor')::bigint,amount_minor),local_date=coalesce(nullif(p_payload->>'local_date','')::date,local_date),category=coalesce(nullif(trim(p_payload->>'category'),''),category),description=coalesce(nullif(trim(p_payload->>'description'),''),description),notes=case when p_payload ? 'notes' then nullif(trim(p_payload->>'notes'),'') else notes end,active=coalesce((p_payload->>'active')::boolean,active)
        where id=p_entity_id and user_id=v_user_id returning to_jsonb(finance_transactions),revision into v_row,v_revision;
        v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
      end if;
    end if;

  elsif p_entity_type = 'finance_budget' then
    if p_expected_revision=0 then
      insert into public.finance_budgets (id,user_id,category,currency,period_start,amount_minor,active)
      values (p_entity_id,v_user_id,trim(p_payload->>'category'),upper(p_payload->>'currency'),(p_payload->>'period_start')::date,(p_payload->>'amount_minor')::bigint,coalesce((p_payload->>'active')::boolean,true))
      returning to_jsonb(finance_budgets),revision into v_row,v_revision;
      v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
    else
      select to_jsonb(t),t.revision into v_row,v_revision from public.finance_budgets t where t.id=p_entity_id and t.user_id=v_user_id for update;
      if not found then v_response:=jsonb_build_object('status','not_found');
      elsif v_revision<>p_expected_revision then v_response:=jsonb_build_object('status','conflict','server',jsonb_build_object('revision',v_revision,'payload',v_row));
      else
        update public.finance_budgets set category=coalesce(nullif(trim(p_payload->>'category'),''),category),currency=coalesce(upper(p_payload->>'currency'),currency),amount_minor=coalesce((p_payload->>'amount_minor')::bigint,amount_minor),period_start=coalesce(nullif(p_payload->>'period_start','')::date,period_start),active=coalesce((p_payload->>'active')::boolean,active)
        where id=p_entity_id and user_id=v_user_id returning to_jsonb(finance_budgets),revision into v_row,v_revision;
        v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
      end if;
    end if;

  elsif p_entity_type = 'finance_recurring_charge' then
    if p_expected_revision=0 then
      insert into public.finance_recurring_charges (id,user_id,account_id,name,category,amount_minor,currency,cadence,next_due_on,notes,active)
      values (p_entity_id,v_user_id,nullif(p_payload->>'account_id','')::uuid,trim(p_payload->>'name'),trim(p_payload->>'category'),(p_payload->>'amount_minor')::bigint,upper(p_payload->>'currency'),p_payload->>'cadence',(p_payload->>'next_due_on')::date,nullif(trim(p_payload->>'notes'),''),coalesce((p_payload->>'active')::boolean,true))
      returning to_jsonb(finance_recurring_charges),revision into v_row,v_revision;
      v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
    else
      select to_jsonb(t),t.revision into v_row,v_revision from public.finance_recurring_charges t where t.id=p_entity_id and t.user_id=v_user_id for update;
      if not found then v_response:=jsonb_build_object('status','not_found');
      elsif v_revision<>p_expected_revision then v_response:=jsonb_build_object('status','conflict','server',jsonb_build_object('revision',v_revision,'payload',v_row));
      else
        update public.finance_recurring_charges set account_id=case when p_payload ? 'account_id' then nullif(p_payload->>'account_id','')::uuid else account_id end,name=coalesce(nullif(trim(p_payload->>'name'),''),name),category=coalesce(nullif(trim(p_payload->>'category'),''),category),amount_minor=coalesce((p_payload->>'amount_minor')::bigint,amount_minor),currency=coalesce(upper(p_payload->>'currency'),currency),cadence=coalesce(p_payload->>'cadence',cadence),next_due_on=coalesce(nullif(p_payload->>'next_due_on','')::date,next_due_on),notes=case when p_payload ? 'notes' then nullif(trim(p_payload->>'notes'),'') else notes end,active=coalesce((p_payload->>'active')::boolean,active)
        where id=p_entity_id and user_id=v_user_id returning to_jsonb(finance_recurring_charges),revision into v_row,v_revision;
        v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
      end if;
    end if;

  elsif p_entity_type = 'finance_position' then
    if p_expected_revision=0 then
      insert into public.finance_positions (id,user_id,position_type,account_id,name,symbol,quantity,currency,opened_on,closed_on,active)
      values (p_entity_id,v_user_id,p_payload->>'position_type',nullif(p_payload->>'account_id','')::uuid,trim(p_payload->>'name'),nullif(upper(trim(p_payload->>'symbol')),''),nullif(p_payload->>'quantity','')::numeric,upper(p_payload->>'currency'),(p_payload->>'opened_on')::date,nullif(p_payload->>'closed_on','')::date,coalesce((p_payload->>'active')::boolean,true))
      returning to_jsonb(finance_positions),revision into v_row,v_revision;
      v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
    else
      select to_jsonb(t),t.revision into v_row,v_revision from public.finance_positions t where t.id=p_entity_id and t.user_id=v_user_id for update;
      if not found then v_response:=jsonb_build_object('status','not_found');
      elsif v_revision<>p_expected_revision then v_response:=jsonb_build_object('status','conflict','server',jsonb_build_object('revision',v_revision,'payload',v_row));
      else
        update public.finance_positions set position_type=coalesce(p_payload->>'position_type',position_type),account_id=case when p_payload ? 'account_id' then nullif(p_payload->>'account_id','')::uuid else account_id end,name=coalesce(nullif(trim(p_payload->>'name'),''),name),symbol=case when p_payload ? 'symbol' then nullif(upper(trim(p_payload->>'symbol')),'') else symbol end,quantity=case when p_payload ? 'quantity' then nullif(p_payload->>'quantity','')::numeric else quantity end,opened_on=coalesce(nullif(p_payload->>'opened_on','')::date,opened_on),closed_on=case when p_payload ? 'closed_on' then nullif(p_payload->>'closed_on','')::date else closed_on end,active=coalesce((p_payload->>'active')::boolean,active)
        where id=p_entity_id and user_id=v_user_id returning to_jsonb(finance_positions),revision into v_row,v_revision;
        v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
      end if;
    end if;

  elsif p_entity_type = 'finance_valuation' then
    select * into v_position from public.finance_positions where id=(p_payload->>'position_id')::uuid and user_id=v_user_id;
    if not found then raise exception 'Finance position not found' using errcode='P0002'; end if;
    if upper(p_payload->>'currency')<>v_position.currency then raise exception 'Valuation currency must match the position currency' using errcode='23514'; end if;
    if p_payload->>'freshness'='unavailable' then v_valuation_value:=null;
    elsif v_position.position_type='holding' then
      if nullif(p_payload->>'unit_price_minor','') is null then raise exception 'Manual holding quotes need a unit price' using errcode='22023'; end if;
      v_valuation_value:=round(v_position.quantity*(p_payload->>'unit_price_minor')::bigint)::bigint;
    else
      v_valuation_value:=(p_payload->>'value_minor')::bigint;
    end if;
    if p_expected_revision=0 then
      insert into public.finance_position_valuations (id,user_id,position_id,local_date,as_of,value_minor,unit_price_minor,currency,source,freshness,reason,notes)
      values (p_entity_id,v_user_id,v_position.id,(p_payload->>'local_date')::date,(p_payload->>'as_of')::timestamptz,v_valuation_value,nullif(p_payload->>'unit_price_minor','')::bigint,v_position.currency,trim(p_payload->>'source'),p_payload->>'freshness',nullif(trim(p_payload->>'reason'),''),nullif(trim(p_payload->>'notes'),''))
      returning to_jsonb(finance_position_valuations),revision into v_row,v_revision;
      v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
    else
      select to_jsonb(t),t.revision into v_row,v_revision from public.finance_position_valuations t where t.id=p_entity_id and t.user_id=v_user_id for update;
      if not found then v_response:=jsonb_build_object('status','not_found');
      elsif v_revision<>p_expected_revision then v_response:=jsonb_build_object('status','conflict','server',jsonb_build_object('revision',v_revision,'payload',v_row));
      else
        update public.finance_position_valuations set position_id=v_position.id,local_date=coalesce(nullif(p_payload->>'local_date','')::date,local_date),as_of=coalesce(nullif(p_payload->>'as_of','')::timestamptz,as_of),value_minor=v_valuation_value,unit_price_minor=nullif(p_payload->>'unit_price_minor','')::bigint,source=coalesce(nullif(trim(p_payload->>'source'),''),source),freshness=coalesce(p_payload->>'freshness',freshness),reason=case when p_payload ? 'reason' then nullif(trim(p_payload->>'reason'),'') else reason end,notes=case when p_payload ? 'notes' then nullif(trim(p_payload->>'notes'),'') else notes end
        where id=p_entity_id and user_id=v_user_id returning to_jsonb(finance_position_valuations),revision into v_row,v_revision;
        v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
      end if;
    end if;

  elsif p_entity_type = 'finance_fx_rate' then
    if p_expected_revision=0 then
      insert into public.finance_fx_rates (id,user_id,base_currency,quote_currency,rate,source,as_of,freshness,reason)
      values (p_entity_id,v_user_id,upper(p_payload->>'base_currency'),upper(p_payload->>'quote_currency'),nullif(p_payload->>'rate','')::numeric,trim(p_payload->>'source'),(p_payload->>'as_of')::timestamptz,p_payload->>'freshness',nullif(trim(p_payload->>'reason'),''))
      returning to_jsonb(finance_fx_rates),revision into v_row,v_revision;
      v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
    else
      select to_jsonb(t),t.revision into v_row,v_revision from public.finance_fx_rates t where t.id=p_entity_id and t.user_id=v_user_id for update;
      if not found then v_response:=jsonb_build_object('status','not_found');
      elsif v_revision<>p_expected_revision then v_response:=jsonb_build_object('status','conflict','server',jsonb_build_object('revision',v_revision,'payload',v_row));
      else
        update public.finance_fx_rates set base_currency=coalesce(upper(p_payload->>'base_currency'),base_currency),quote_currency=coalesce(upper(p_payload->>'quote_currency'),quote_currency),rate=case when p_payload ? 'rate' then nullif(p_payload->>'rate','')::numeric else rate end,source=coalesce(nullif(trim(p_payload->>'source'),''),source),as_of=coalesce(nullif(p_payload->>'as_of','')::timestamptz,as_of),freshness=coalesce(p_payload->>'freshness',freshness),reason=case when p_payload ? 'reason' then nullif(trim(p_payload->>'reason'),'') else reason end
        where id=p_entity_id and user_id=v_user_id returning to_jsonb(finance_fx_rates),revision into v_row,v_revision;
        v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
      end if;
    end if;

  else
    if p_expected_revision<>0 then raise exception 'Conversions are immutable; create a new conversion record' using errcode='22023'; end if;
    insert into public.finance_conversions (id,user_id,fx_rate_id,local_date,from_amount_minor,from_currency,to_amount_minor,to_currency,rate,source,as_of)
    values (p_entity_id,v_user_id,nullif(p_payload->>'fx_rate_id','')::uuid,(p_payload->>'local_date')::date,(p_payload->>'from_amount_minor')::bigint,upper(p_payload->>'from_currency'),(p_payload->>'to_amount_minor')::bigint,upper(p_payload->>'to_currency'),(p_payload->>'rate')::numeric,trim(p_payload->>'source'),(p_payload->>'as_of')::timestamptz)
    returning to_jsonb(finance_conversions),revision into v_row,v_revision;
    v_response:=jsonb_build_object('status','applied','revision',v_revision,'record',v_row);
  end if;

  insert into public.sync_mutation_receipts (owner_id,mutation_id,response) values (v_user_id,p_mutation_id,v_response);
  return v_response;
end;
$$;

revoke all on function public.apply_finance_mutation(uuid,text,uuid,integer,jsonb) from public, anon;
grant execute on function public.apply_finance_mutation(uuid,text,uuid,integer,jsonb) to authenticated;
