-- Optional FPS metrics on Pulse reports. Web submit form starts with three
-- optional text fields (min / avg / max); the plugin will populate the same
-- columns automatically from MangoHud samples in a follow-up. All three are
-- nullable so nothing breaks for existing rows or reports without measurements.
--
-- Type: numeric(6,1) so we can carry one decimal for MangoHud averages
-- (e.g. 58.7) without over-committing storage. Range check keeps out obvious
-- garbage entered in the free-text form (negative FPS, 4-digit "999999").

alter table public.user_configs
  add column if not exists fps_min numeric(6,1),
  add column if not exists fps_avg numeric(6,1),
  add column if not exists fps_max numeric(6,1);

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_configs_fps_range_chk'
  ) then
    alter table public.user_configs
      add constraint user_configs_fps_range_chk check (
        (fps_min is null or (fps_min >= 0 and fps_min <= 1000)) and
        (fps_avg is null or (fps_avg >= 0 and fps_avg <= 1000)) and
        (fps_max is null or (fps_max >= 0 and fps_max <= 1000)) and
        (fps_min is null or fps_max is null or fps_min <= fps_max)
      );
  end if;
end $$;

-- Mirror in history so edit-history snapshots preserve the values.
alter table public.user_configs_history
  add column if not exists fps_min numeric(6,1),
  add column if not exists fps_avg numeric(6,1),
  add column if not exists fps_max numeric(6,1);

-- Refresh the snapshot trigger so it copies the new columns on UPDATE.
create or replace function public.snapshot_user_configs_before_update()
returns trigger language plpgsql as $$
declare
  table_size_mb float;
begin
  insert into public.user_configs_history
    (config_id, app_id, rating, proton_version, os, notes, config_key,
     fps_min, fps_avg, fps_max, recorded_at)
  values
    (old.id, old.app_id, old.rating, old.proton_version, old.os, old.notes, old.config_key,
     old.fps_min, old.fps_avg, old.fps_max, now());

  select pg_total_relation_size('public.user_configs_history') / 1048576.0 into table_size_mb;
  if table_size_mb > 50 then
    delete from public.user_configs_history
    where id in (
      select id from public.user_configs_history
      order by recorded_at asc
      limit 200
    );
  end if;

  return new;
end;
$$;
