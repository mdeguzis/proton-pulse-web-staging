-- Fix: user_configs_history.app_id was created as bigint, but
-- user_configs.app_id is text. The snapshot_user_configs_before_update()
-- trigger copies old.app_id (text) into user_configs_history.app_id (bigint),
-- which Postgres refuses to implicitly cast ("column app_id is of type bigint
-- but expression is of type text"). That error rolls back ANY update to
-- user_configs, which broke banning a user (the ban insert fires a trigger
-- that updates user_configs to hide their reports), report edits, and hides.
--
-- The history table is empty at the time of this migration, so the type change
-- needs no data rewrite, but USING is included for safety.
ALTER TABLE public.user_configs_history
  ALTER COLUMN app_id TYPE text USING app_id::text;
