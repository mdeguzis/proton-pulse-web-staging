-- Track when a logged-in user last visited the site. Updated client-side
-- from topbar.js on every page load while a session is active.
alter table public.author_avatars
  add column if not exists last_seen_at timestamptz;
