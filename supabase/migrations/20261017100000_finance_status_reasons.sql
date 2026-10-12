-- An unavailable quote/rate must explain why it cannot currently be used.
alter table public.finance_position_valuations
  add constraint finance_valuations_unavailable_reason
  check (freshness <> 'unavailable' or nullif(trim(reason), '') is not null);

alter table public.finance_fx_rates
  add constraint finance_fx_rates_unavailable_reason
  check (freshness <> 'unavailable' or nullif(trim(reason), '') is not null);
