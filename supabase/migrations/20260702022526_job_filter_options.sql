-- Distinct filter-option values for the Jobs page dropdowns.
-- Replaces the previous approach of pulling raw rows and deduping in JS, which
-- silently truncated at Supabase's default 1000-row cap (newest prompt versions
-- at the tail were dropped). Returns true DISTINCT values regardless of row count.
--
-- SECURITY INVOKER so RLS on job_evaluations still restricts to the caller's own
-- rows; the explicit auth.uid() filter is defense-in-depth.

create or replace function public.get_job_filter_options()
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select json_build_object(
    'companies', coalesce((select json_agg(company order by company)
      from (select distinct company from job_evaluations
            where user_id = auth.uid() and skipped = false and archived = false
              and company is not null) c), '[]'::json),
    'locations', coalesce((select json_agg(location order by location)
      from (select distinct location from job_evaluations
            where user_id = auth.uid() and skipped = false and archived = false
              and location is not null) l), '[]'::json),
    'searches', coalesce((select json_agg(search_query order by search_query)
      from (select distinct search_query from job_evaluations
            where user_id = auth.uid() and skipped = false and archived = false
              and search_query is not null) s), '[]'::json),
    'promptVersions', coalesce((select json_agg(prompt_version::text order by prompt_version)
      from (select distinct prompt_version from job_evaluations
            where user_id = auth.uid() and skipped = false and archived = false
              and prompt_version is not null) v), '[]'::json)
  );
$$;

grant execute on function public.get_job_filter_options() to authenticated;
