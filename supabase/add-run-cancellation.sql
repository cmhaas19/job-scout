-- Run heartbeat + cancellation support.
-- Run against existing databases (the base migration.sql already includes these for fresh installs).

ALTER TABLE run_logs DROP CONSTRAINT IF EXISTS run_logs_status_check;
ALTER TABLE run_logs ADD CONSTRAINT run_logs_status_check
  CHECK (status IN ('running', 'completed', 'failed', 'cancelled'));

ALTER TABLE run_logs ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;
ALTER TABLE run_logs ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT FALSE;
