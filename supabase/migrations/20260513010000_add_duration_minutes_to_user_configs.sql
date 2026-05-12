-- Store exact playtime minutes alongside the bucket string so the website
-- can display real hours instead of approximate ranges.
ALTER TABLE user_configs ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
