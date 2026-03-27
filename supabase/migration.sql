-- Job Scout Database Schema
-- Run this in your Supabase SQL editor

-- ============================================================
-- 1. PROFILES
-- ============================================================
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  full_name     TEXT,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  resume_text   TEXT,
  resume_uploaded_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_profiles_role ON profiles (role);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 2. SAVED SEARCHES
-- ============================================================
CREATE TABLE saved_searches (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  keyword           TEXT NOT NULL,
  location          TEXT,
  date_since_posted TEXT NOT NULL DEFAULT 'past week'
                    CHECK (date_since_posted IN ('24hr', 'past week', 'past month')),
  job_type          TEXT CHECK (job_type IS NULL OR job_type IN ('full time', 'part time', 'contract', 'temporary', 'volunteer', 'internship')),
  remote_filter     TEXT CHECK (remote_filter IS NULL OR remote_filter IN ('on site', 'remote', 'hybrid')),
  experience_level  TEXT[],
  result_limit      INTEGER DEFAULT 100 CHECK (result_limit > 0 AND result_limit <= 100),
  sort_by           TEXT DEFAULT 'relevant' CHECK (sort_by IN ('relevant', 'recent')),
  is_active         BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_saved_searches_user ON saved_searches (user_id);
CREATE INDEX idx_saved_searches_active ON saved_searches (user_id, is_active);

-- ============================================================
-- 3. JOB EVALUATIONS
-- ============================================================
CREATE TABLE job_evaluations (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  search_id       UUID REFERENCES saved_searches(id) ON DELETE SET NULL,
  job_url         TEXT NOT NULL,
  position        TEXT NOT NULL,
  company         TEXT NOT NULL,
  location        TEXT,
  ago_time        TEXT,
  date_posted     TIMESTAMPTZ,
  salary          TEXT,
  company_logo    TEXT,
  description     TEXT,
  search_query    TEXT,

  -- Evaluation results
  fit_category    TEXT CHECK (fit_category IS NULL OR fit_category IN ('STRONG FIT', 'GOOD FIT', 'BORDERLINE', 'WEAK FIT')),
  total_score     NUMERIC(5,2),
  score_details   JSONB,
  eval_summary    TEXT,
  strengths       JSONB,
  gaps            JSONB,

  -- Prompt version used for evaluation
  prompt_version  INTEGER,

  -- Skip tracking
  skipped         BOOLEAN DEFAULT FALSE,
  skip_reason     TEXT,

  -- User feedback
  user_rating     INTEGER CHECK (user_rating IS NULL OR (user_rating BETWEEN 1 AND 4)),
  user_notes      TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (user_id, job_url)
);

CREATE INDEX idx_job_eval_user ON job_evaluations (user_id);
CREATE INDEX idx_job_eval_user_fit ON job_evaluations (user_id, fit_category);
CREATE INDEX idx_job_eval_user_url ON job_evaluations (user_id, job_url);
CREATE INDEX idx_job_eval_user_skipped ON job_evaluations (user_id, skipped);

-- ============================================================
-- 4. RUN LOGS
-- ============================================================
CREATE TABLE run_logs (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  trigger_type  TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'on_demand')),
  search_id     UUID REFERENCES saved_searches(id) ON DELETE SET NULL,
  status        TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at    TIMESTAMPTZ NOT NULL,
  finished_at   TIMESTAMPTZ,
  duration_ms   INTEGER,
  stats         JSONB,
  error         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_run_logs_user ON run_logs (user_id);
CREATE INDEX idx_run_logs_user_started ON run_logs (user_id, started_at DESC);
CREATE INDEX idx_run_logs_trigger ON run_logs (trigger_type, started_at DESC);

-- ============================================================
-- 5. SYSTEM CONFIG
-- ============================================================
CREATE TABLE system_config (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_by  UUID REFERENCES profiles(id)
);

-- ============================================================
-- 6. CONFIG AUDIT LOG
-- ============================================================
CREATE TABLE config_audit_log (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_key    TEXT NOT NULL,
  old_value     JSONB,
  new_value     JSONB NOT NULL,
  changed_by    UUID NOT NULL REFERENCES profiles(id),
  changed_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_config_audit_key ON config_audit_log (config_key, changed_at DESC);

-- ============================================================
-- 7. SYSTEM PROMPTS
-- ============================================================
CREATE TABLE system_prompts (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  content     TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_by  UUID REFERENCES profiles(id)
);

-- ============================================================
-- 8. PROMPT VERSIONS
-- ============================================================
CREATE TABLE prompt_versions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prompt_id   UUID NOT NULL REFERENCES system_prompts(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  content     TEXT NOT NULL,
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_prompt_versions_prompt ON prompt_versions (prompt_id, version DESC);

-- ============================================================
-- 9. STORAGE BUCKET
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('resumes', 'resumes', false)
ON CONFLICT DO NOTHING;

-- Storage policies
CREATE POLICY "Users can upload own resume"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can read own resume"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can update own resume"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete own resume"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- 10. ROW LEVEL SECURITY
-- ============================================================

-- Profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Admins can update all profiles"
  ON profiles FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- Saved Searches
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own searches"
  ON saved_searches FOR ALL
  USING (auth.uid() = user_id);

-- Job Evaluations
ALTER TABLE job_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own evaluations"
  ON job_evaluations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own evaluations"
  ON job_evaluations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own evaluations"
  ON job_evaluations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Run Logs
ALTER TABLE run_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own run logs"
  ON run_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all run logs"
  ON run_logs FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Users can insert own run logs"
  ON run_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own run logs"
  ON run_logs FOR UPDATE
  USING (auth.uid() = user_id);

-- System Config
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read config"
  ON system_config FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Only admins can modify config"
  ON system_config FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Config Audit Log
ALTER TABLE config_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can read audit log"
  ON config_audit_log FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Only admins can insert audit log"
  ON config_audit_log FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- System Prompts
ALTER TABLE system_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read prompts"
  ON system_prompts FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Only admins can modify prompts"
  ON system_prompts FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Prompt Versions
ALTER TABLE prompt_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read prompt versions"
  ON prompt_versions FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Only admins can modify prompt versions"
  ON prompt_versions FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================================
-- 11. SEED DATA
-- ============================================================

-- System Config defaults
INSERT INTO system_config (key, value, description) VALUES
  ('blocked_publishers', '["Jobgether", "Ladders", "Dice", "RemoteHunter", "Lensa", "TopTal"]', 'Companies to auto-skip during scraping'),
  ('min_comp_top_end', '300000', 'Minimum top-end salary to pass comp filter'),
  ('score_threshold_strong', '85', 'Minimum score for STRONG FIT'),
  ('score_threshold_good', '70', 'Minimum score for GOOD FIT'),
  ('score_threshold_borderline', '60', 'Minimum score for BORDERLINE'),
  ('eval_model', '"claude-sonnet-4-20250514"', 'Claude model for evaluations'),
  ('eval_concurrency', '5', 'Max parallel Claude API calls per run'),
  ('delay_between_fetches_ms', '1500', 'Delay between JD fetch requests (ms)'),
  ('max_searches_per_user', '10', 'Max saved searches per user'),
  ('max_refreshes_per_hour', '2', 'Max on-demand scrapes per user per hour'),
  ('max_results_per_search', '100', 'Max results per search query')
ON CONFLICT DO NOTHING;

-- Evaluator system prompt
INSERT INTO system_prompts (slug, name, description, content) VALUES (
  'evaluator',
  'Job Fit Evaluator',
  'System prompt sent to Claude for scoring jobs',
  E'You are a job fit evaluator. You will be given a candidate''s resume and a job description. Score the fit using the weighted rubric below. Never fabricate or infer skills that aren''t in the resume.\n\nSCORING RUBRIC (weights sum to 100):\n- required_skills (max 35): Does each required skill appear in the resume? Score proportionally.\n- years_of_experience (max 10): Does the candidate meet or exceed the stated requirement?\n- role_level_alignment (max 20): Does seniority match? (VP role + VP/CPO background = full credit)\n- industry_domain_match (max 20): Does the candidate''s industry experience align?\n- nice_to_have_skills (max 10): How many preferred/bonus skills are present?\n- education_certs (max 5): Does any stated requirement exist in the resume?\n\nCOMPENSATION CHECK:\n- If the job description lists a compensation range and the top-end is below {{min_comp_top_end}}, this is a significant negative signal. Score the role as WEAK FIT regardless of other factors, and note the low compensation in your summary.\n- If no compensation is listed, ignore this factor entirely.\n\nSCORING RULES:\n- Score each category from 0 to its max weight.\n- Sum all scores for total_score (0-100).\n- Round total_score to the nearest whole number.\n\nFIT CATEGORIES:\n- {{strong_threshold}}-100: \"STRONG FIT\"\n- {{good_threshold}}-{{strong_threshold_minus_1}}: \"GOOD FIT\"\n- {{borderline_threshold}}-{{good_threshold_minus_1}}: \"BORDERLINE\"\n- Below {{borderline_threshold}}: \"WEAK FIT\"\n\nRespond with ONLY valid JSON (no markdown fences, no commentary) in this exact structure:\n{\n  \"scores\": {\n    \"required_skills\": <number 0-35>,\n    \"years_of_experience\": <number 0-10>,\n    \"role_level_alignment\": <number 0-20>,\n    \"industry_domain_match\": <number 0-20>,\n    \"nice_to_have_skills\": <number 0-10>,\n    \"education_certs\": <number 0-5>\n  },\n  \"total_score\": <number 0-100>,\n  \"fit_category\": \"<one of: STRONG FIT, GOOD FIT, BORDERLINE, WEAK FIT>\",\n  \"strengths\": [\"<specific resume element matching JD requirement>\", ...],\n  \"gaps\": [\"<JD requirement not in resume>\", ...],\n  \"summary\": \"<2-3 sentence plain-language summary>\"\n}'
) ON CONFLICT DO NOTHING;
