-- Prevent any user from banning themselves.
-- The banned_by column records which admin initiated the ban.
ALTER TABLE public.banned_users DROP CONSTRAINT IF EXISTS no_self_ban;
ALTER TABLE public.banned_users ADD CONSTRAINT no_self_ban
  CHECK (proton_pulse_user_id IS NULL OR proton_pulse_user_id <> banned_by);
