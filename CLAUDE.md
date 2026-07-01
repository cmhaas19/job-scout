# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Job Scout is an AI-powered job fit evaluation platform. Users define LinkedIn job searches, the system scrapes results on a daily cron schedule (or on-demand), and Claude evaluates each job against the user's resume using a weighted rubric (100-point scale across 6 categories). Users can rate jobs to calibrate future evaluations.

## Commands

```bash
npm run dev      # Start Next.js dev server on :3000
npm run build    # Production build
npm run lint     # ESLint
```

No test framework is configured.

## Tech Stack

- **Next.js 15** (App Router) with TypeScript (strict mode)
- **Supabase** for PostgreSQL, Auth, Storage, and Row-Level Security
- **Anthropic Claude API** for job evaluation (`@anthropic-ai/sdk`)
- **Tailwind CSS 4** (new `@import` syntax) with `class-variance-authority` for component variants
- **Cheerio** for HTML parsing of LinkedIn results
- Path alias: `@/*` maps to `./src/*`

## Architecture

### Route Groups

- `src/app/(app)/` — Authenticated app pages (dashboard, jobs, setup)
- `src/app/(auth)/` — Public auth pages (login, register, password reset)
- `src/app/admin/` — Admin-only pages (settings, prompts, users, run logs)
- `src/app/api/` — API routes following Next.js App Router conventions

### Core Business Logic

- `src/lib/evaluator.ts` — Claude API integration. Loads prompt from `system_prompts` table, interpolates threshold variables, includes user's rated jobs as calibration data. Returns scores across 6 weighted categories (total 100 points) with fit categories `STRONG FIT`, `GOOD FIT`, `BORDERLINE`, `WEAK FIT`.
- `src/lib/scraper/pipeline.ts` — Main orchestration. For each active search: builds LinkedIn URL, fetches/parses results, filters (blocked publishers, salary thresholds, duplicates), fetches full descriptions, evaluates with Claude, saves to DB. Respects `delay_between_fetches_ms` and `eval_concurrency` config. Writes a heartbeat to `run_logs` as it progresses (see stale-run handling below).
- `src/lib/scraper/parser.ts` — HTML parsing of LinkedIn search results and job detail pages.
- `src/lib/scraper/url-builder.ts` — Maps search parameters to LinkedIn URL query params.
- `src/lib/scraper/salary.ts` — Salary extraction from job descriptions.
- `src/lib/scraper/stale-runs.ts` — `failStaleRuns()` self-heals orphaned `run_logs` rows. A run stuck in `running` with no heartbeat within `STALE_RUN_THRESHOLD_MS` (3 min) is almost always a serverless function that hit the Vercel time limit and was killed before recording a final status; it gets marked `failed`. Called from the scrape and cron routes.
- `src/lib/constants.ts` — Source of truth for fit category labels/colors and the per-category rubric weights (`SCORE_LABELS`: required_skills 30, industry_domain_match 30, role_level_alignment 20, years_of_experience 10, nice_to_have_skills 5, education_certs 5). Keep in sync with the evaluator prompt.
- `src/lib/email.ts` — Resend-backed digest emails of top job matches (`sendDigestEmail`), gated by the `email_digest` config and `RESEND_API_KEY`. Testable via `/api/email/test`.

### Auth Pattern

Two families of auth helpers, split by context:
- **Page components** (Server Components) use `src/lib/auth.ts` — `getUser()`, `requireUser()`, `getProfile()`, `requireAdmin()`. These `redirect()` on failure.
- **API route handlers** use `src/lib/api-auth.ts` — `requireApiUser()` / `requireApiAdmin()`. These return the `{ supabase, user }` context or a `NextResponse` (401/403) the route returns directly:
  ```ts
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  const { supabase, user } = gate;
  ```
  Do not hand-roll `auth.getUser()` + role checks in new routes; use these guards.

Two Supabase clients: server client (SSR, uses request cookies, RLS-enforced) and service role client (bypasses RLS). **Prefer the RLS client** (`createClient()`) for user-facing routes and let RLS enforce ownership. Use `createServiceClient()` only for: cron, genuine cross-user admin reads, and detached background tasks that outlive the request (e.g. the SSE re-evaluation loop) — where it's paired with an explicit `user_id` filter.

Both Supabase clients are parameterized with the generated `Database` type (`src/lib/database.types.ts`); run `npm run db:types` to populate it and get typed `.from()` results app-wide.

### Request validation, responses, logging

- **Validation:** `src/lib/validation.ts` — zod schemas + `parseBody(request, schema)` (returns typed data or a 400, also catches malformed JSON) and `parsePagination()` (clamps `page`/`limit`). Validate every mutating route body.
- **Responses:** `src/lib/api-response.ts` — `apiError(msg, status)`, `dbError(scope, error, clientMsg)` (logs the real DB error, returns a generic message so driver detail never leaks), and `serverError(scope, err)` for catch blocks.
- **Env:** `src/lib/env.ts` — `publicEnv()` / `serverEnv()` zod-validate required vars and fail fast naming the missing one. Use instead of `process.env.X!`.
- **Logging:** `src/lib/logger.ts` — `logger.info/warn/error(scope, msg, meta)` emits structured JSON lines. Use instead of `console.*`.

### Database

Schema is managed with the Supabase CLI (installed as a devDependency). Migrations live in `supabase/migrations/` (timestamped) and are applied to the linked project. Key tables: `profiles`, `saved_searches`, `job_evaluations`, `run_logs`, `system_config`, `system_prompts`, `prompt_versions`. RLS policies enforce multi-tenant isolation. Deduplication via UNIQUE constraint on `(user_id, job_url)`.

**Changing the schema:** `npm run db:new <name>` → edit the generated SQL in `supabase/migrations/` → `npm run db:push` (applies to the linked DB) → `npm run db:types` (regenerates `src/lib/database.types.ts`). Never edit an already-pushed migration in place; add a new one. The pre-CLI hand-applied SQL is archived in `supabase/legacy/` (reference only).

### Admin-Configurable Settings

Stored in `system_config` table, read via `src/lib/config.ts` with defaults: `blocked_publishers`, `min_comp_top_end`, score thresholds, `eval_model`, `eval_concurrency`, `delay_between_fetches_ms`, `max_searches_per_user`, `max_refreshes_per_hour`, `max_results_per_search`.

### Streaming

Scrape progress and re-evaluation use Server-Sent Events (SSE) — see `/api/scrape/status/[runId]` and `/api/jobs/re-evaluate`.

### Deployment

Vercel with cron configured in `vercel.json` (daily at 14:00 UTC, hits `/api/scrape/cron`). Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `RESEND_API_KEY` (email digests). Because scrapes run inside time-limited serverless functions, long runs can be killed mid-flight — hence the heartbeat/`failStaleRuns` self-healing and the admin run-log cancel/rerun controls.

## Conventions

- UI primitives in `src/components/ui/` use Tailwind + `class-variance-authority`
- Color scheme uses HSL CSS variables defined in `src/app/globals.css`
- API routes return `NextResponse.json({ error }, { status })` on failure
- ESLint allows `any` types and unused vars prefixed with `_`
- Supabase queries use chained `.select()/.eq()/.order()/.limit()` pattern
