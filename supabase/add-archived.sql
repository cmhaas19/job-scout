ALTER TABLE job_evaluations ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX idx_job_evaluations_archived ON job_evaluations (user_id, archived);
