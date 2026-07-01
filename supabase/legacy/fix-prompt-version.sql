-- Add prompt_version column to job_evaluations
ALTER TABLE job_evaluations ADD COLUMN IF NOT EXISTS prompt_version INTEGER;

-- Seed initial version for the evaluator prompt if none exists
INSERT INTO prompt_versions (prompt_id, version, content)
SELECT id, 1, content FROM system_prompts WHERE slug = 'evaluator'
AND NOT EXISTS (
  SELECT 1 FROM prompt_versions pv WHERE pv.prompt_id = system_prompts.id
);
