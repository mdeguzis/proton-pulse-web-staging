ALTER TABLE flagged_reports
  ADD COLUMN IF NOT EXISTS reason_category text,
  ADD COLUMN IF NOT EXISTS reason_text     text,
  ADD COLUMN IF NOT EXISTS status          text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS reporter_client_id text;
