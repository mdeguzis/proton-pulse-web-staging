alter table public.user_systems enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_systems'
      and policyname = 'user_systems_select_own'
  ) then
    create policy user_systems_select_own
      on public.user_systems
      for select
      to authenticated
      using (proton_pulse_user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_systems'
      and policyname = 'user_systems_update_own'
  ) then
    create policy user_systems_update_own
      on public.user_systems
      for update
      to authenticated
      using (proton_pulse_user_id = auth.uid())
      with check (proton_pulse_user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_systems'
      and policyname = 'user_systems_delete_own'
  ) then
    create policy user_systems_delete_own
      on public.user_systems
      for delete
      to authenticated
      using (proton_pulse_user_id = auth.uid());
  end if;
end $$;
