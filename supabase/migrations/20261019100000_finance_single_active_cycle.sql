-- A person can track one budget period at a time; currency totals remain separate within that period.
create or replace function public.prevent_overlapping_finance_budget_cycles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.finance_budget_cycles c
    where c.user_id = new.user_id
      and c.id <> new.id
      and daterange(c.period_start, c.period_end, '[]') && daterange(new.period_start, new.period_end, '[]')
  ) then
    raise exception 'A budget period overlaps an existing cycle' using errcode = '23P01';
  end if;
  return new;
end;
$$;

create trigger finance_budget_cycles_no_overlap
before insert or update of period_start, period_end, user_id
on public.finance_budget_cycles
for each row execute function public.prevent_overlapping_finance_budget_cycles();
