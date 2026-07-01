# Legacy SQL (archived)

These are the original, hand-applied schema files from before the project moved
to Supabase CLI migrations. They are kept for historical reference only and are
**no longer the source of truth** — do not run them against a live database.

Schema is now managed under `supabase/migrations/`. See the "Set up the database"
section of the root `README.md` for the current workflow (`npm run db:new`,
`db:push`, `db:pull`, `db:types`).

Original apply order:

1. `migration.sql` — base schema, RLS, storage bucket, triggers, seed data
2. `fix-rls.sql` — `public.is_admin()` to fix RLS recursion
3. `fix-date-posted.sql` — `date_posted` → `TIMESTAMPTZ`
4. `fix-prompt-version.sql` — prompt version tracking on `job_evaluations`
5. `add-email-digest.sql` — `email_digest_enabled` on `profiles`
6. `add-archived.sql` — `archived` on `job_evaluations`
7. `add-run-cancellation.sql` — `last_heartbeat_at` / `cancel_requested` on `run_logs`
