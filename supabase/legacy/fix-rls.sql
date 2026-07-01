-- Fix: infinite recursion in profiles RLS policies
-- The admin policies query the profiles table from within profiles RLS,
-- causing infinite recursion. Fix by checking role from auth.jwt() metadata instead.

-- Drop the recursive admin policies on profiles
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;

-- Recreate using auth.jwt() which doesn't trigger RLS
-- Note: this requires the role to be in the JWT. Since it isn't by default,
-- we'll use a security definer function instead.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can update all profiles"
  ON profiles FOR UPDATE
  USING (public.is_admin());

-- Fix same pattern on run_logs
DROP POLICY IF EXISTS "Admins can view all run logs" ON run_logs;

CREATE POLICY "Admins can view all run logs"
  ON run_logs FOR SELECT
  USING (public.is_admin());

-- Fix same pattern on system_config
DROP POLICY IF EXISTS "Only admins can modify config" ON system_config;

CREATE POLICY "Only admins can modify config"
  ON system_config FOR ALL
  USING (public.is_admin());

-- Fix same pattern on config_audit_log
DROP POLICY IF EXISTS "Only admins can read audit log" ON config_audit_log;
DROP POLICY IF EXISTS "Only admins can insert audit log" ON config_audit_log;

CREATE POLICY "Only admins can read audit log"
  ON config_audit_log FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Only admins can insert audit log"
  ON config_audit_log FOR INSERT
  WITH CHECK (public.is_admin());

-- Fix same pattern on system_prompts
DROP POLICY IF EXISTS "Only admins can modify prompts" ON system_prompts;

CREATE POLICY "Only admins can modify prompts"
  ON system_prompts FOR ALL
  USING (public.is_admin());

-- Fix same pattern on prompt_versions
DROP POLICY IF EXISTS "Only admins can modify prompt versions" ON prompt_versions;

CREATE POLICY "Only admins can modify prompt versions"
  ON prompt_versions FOR ALL
  USING (public.is_admin());
