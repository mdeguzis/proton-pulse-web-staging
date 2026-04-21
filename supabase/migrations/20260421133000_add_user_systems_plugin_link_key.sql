alter table public.user_systems
  add column if not exists proton_pulse_user_id uuid,
  add column if not exists installation_id text;

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'user_systems'
      and constraint_name = 'user_systems_pkey'
      and constraint_type = 'PRIMARY KEY'
  ) then
    alter table public.user_systems drop constraint user_systems_pkey;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_systems'
      and column_name = 'steam_id'
  ) then
    alter table public.user_systems alter column steam_id drop not null;
  end if;
end $$;

create unique index if not exists uq_user_systems_steam_device
  on public.user_systems (steam_id, device_id)
  where steam_id is not null;

create index if not exists idx_user_systems_proton_pulse_user_id
  on public.user_systems (proton_pulse_user_id);

create unique index if not exists uq_user_systems_proton_pulse_user_device
  on public.user_systems (proton_pulse_user_id, device_id);

create unique index if not exists uq_user_systems_proton_pulse_user_default
  on public.user_systems (proton_pulse_user_id)
  where proton_pulse_user_id is not null and is_default;

grant select, insert, update, delete on table public.user_systems to service_role;
