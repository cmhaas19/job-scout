# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Job Scout is an AI-powered job fit evaluation platform. Users define LinkedIn job searches, the system scrapes results on a daily cron schedule (or on-demand), and Claude evaluates each job against the user's resume using a weighted rubric (100-point scale across 6 categories). Users can rate jobs to calibrate future evaluations.

## Commands

```bash
npm run dev            # Start Next.js dev server on :3210
npm run build          # Production build
npm run lint           # ESLint
npm test               # Run Vitest once (also: test:watch, test:coverage)

npm run db:new <name>  # Create a timestamped Supabase migration
npm run db:push        # Apply migrations to the linked project
npm run db:types       # Regenerate src/lib/database.types.ts

# Local Inngest (run alongside `npm run dev`; needs INNGEST_DEV=1 in .env.local)
npx inngest-cli@latest dev -u http://localhost:3210/api/inngest   # dashboard on :8288
```

Tests use **Vitest**; specs live next to the code as `src/lib/**/*.test.ts`.

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

- `src/lib/evaluator.ts` — Claude API integration. `buildEvalContext(userId, resumeText)` assembles the system prompt (threshold interpolation + rated-jobs calibration) + model + prompt version **once per run**; `evaluateJobWithContext(ctx, …)` runs the single Claude call reusing it — with Anthropic prompt caching on the constant system+resume, and SDK `maxRetries` for 429/529 overloads. `evaluateJob(...)` is the one-shot wrapper (builds context inline) kept for isolated re-evaluations. Returns scores across 6 weighted categories (total 100 points) with fit categories `STRONG FIT`, `GOOD FIT`, `BORDERLINE`, `WEAK FIT`.
- `src/lib/scraper/pipeline.ts` — Decomposed into `scrapeAndFilter(userId, searchId, config)` (scrape → dedup vs existing → publisher/comp/location filters → builds eval context) and `processJobBatch(userId, jobs, evalContext, config)` (fetch descriptions + evaluate + upsert a batch, returns a stats delta; `mergeStats` accumulates). `runPipeline(userId, searchIds?, runLogId?, onLog?)` composes them sequentially for the non-Inngest callers (admin rerun, cron backstop, on-demand SSE) and keeps the heartbeat/cancel behavior. The **Inngest `scrapeSearch`** orchestrator instead runs `scrape-filter` once then each `scrape_batch_size`-sized batch as its own `step.run` — a fresh 300s budget per batch, so a search can never time out. Respects `delay_between_fetches_ms`, `fetch_concurrency`, `eval_concurrency`, `scrape_batch_size`.
- `src/lib/scraper/parser.ts` — HTML parsing of LinkedIn search results and job detail pages.
- `src/lib/scraper/url-builder.ts` — Maps search parameters to LinkedIn URL query params.
- `src/lib/scraper/salary.ts` — Salary extraction from job descriptions.
- `src/lib/scraper/stale-runs.ts` — `failStaleRuns()` self-heals orphaned `run_logs` rows. A run stuck in `running` with no heartbeat within `STALE_RUN_THRESHOLD_MS` (3 min) is almost always a serverless function that hit the Vercel time limit and was killed before recording a final status; it gets marked `failed`. Called from the scrape and cron routes.
- `src/lib/constants.ts` — Source of truth for fit category labels/colors and the per-category rubric weights (`SCORE_LABELS`: required_skills 30, industry_domain_match 30, role_level_alignment 20, years_of_experience 10, nice_to_have_skills 5, education_certs 5). Keep in sync with the evaluator prompt.
- `src/lib/email.ts` — Resend-backed digest emails of top job matches (`sendDigestEmail`), gated by the `email_digest` config and `RESEND_API_KEY`. `buildDigestHtml` renders a dark-header layout with summary chips, an "Apply now" block surfacing remote STRONG/GOOD-FIT roles (remote = `location` text match OR the originating search's `remote_filter`), fit-tier card sections, a compact weak-fit list, per-role color-coded search pills, and a Top-10-this-week section sorted by fit then score. Testable via `/api/email/test` (add `?empty=true` for the quiet-day fallback).

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

### Scheduling (Inngest)

Scheduled scrapes run on **Inngest** (`src/lib/inngest/`), served at `/api/inngest`. This replaced the Vercel Hobby cron, which was limited to one run/day and shared a single 300s function budget across every user's whole pipeline (so multi-search runs timed out).

- **`scheduledScrape`** — cron `TZ=America/Los_Angeles 0 6,12,17 * * *` (6am/noon/5pm Pacific, DST-aware). Sweeps stale runs, then dispatches one `scrape/user.requested` per user with a resume + active searches.
- **`scrapeUser`** — event `scrape/user.requested` (`{ userId, searchIds?, trigger }`). Fans out one `scrapeSearch` per active search (or the given subset) and sends a single digest once they all finish.
- **`scrapeSearch`** — event `scrape/search.requested`; a durable orchestrator for one search under its own `run_logs` row: `start → config → scrape-filter → checkpoint/batch pairs → finalize`. Each `batch-N` (`scrape_batch_size` jobs) is its own `step.run` with a fresh 300s budget + independent retry, and completed steps are memoized, so a search can process arbitrarily many jobs without any single invocation timing out. `checkpoint-N` writes a heartbeat + honors admin cancel between batches. run_log lifecycle helpers live in [src/lib/scraper/run.ts](src/lib/scraper/run.ts) (`createRunLog` / `writeRunLogProgress` / `finalizeRunLog`). `concurrency: { limit: 2 }` keeps LinkedIn load gentle.

**Manual runs** (the Run All / per-search play buttons on the Searches page) also go through Inngest: `POST /api/scrape/trigger` rate-limits (cooldown derived from `max_refreshes_per_hour`) then emits `scrape/user.requested` with `trigger: "on_demand"` and returns immediately — progress is tracked via Run Logs, not a live SSE stream. The old inline SSE route (`/api/scrape`) is no longer used by the UI.

`vercel.json` no longer defines a cron. `/api/scrape/cron` remains as a manual/admin backstop but is no longer scheduled.

### Deployment

Vercel (custom domain `jobscout.oakworks.ai`). Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `RESEND_API_KEY` (email digests), `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` (set by the Vercel↔Inngest integration; the local `inngest-cli dev` server needs neither), and `INNGEST_SERVE_HOST=https://jobscout.oakworks.ai` so Inngest syncs the stable custom domain instead of the ephemeral per-deploy URL. **Vercel Deployment Protection (Vercel Authentication) must stay OFF** — when on, it bounces Inngest's sync of `/api/inngest` to an SSO wall and the app never registers. `INNGEST_DEV` is local-only, never set in Vercel. Because scrapes run inside time-limited serverless functions, long runs can be killed mid-flight — hence the heartbeat/`failStaleRuns` self-healing and the admin run-log cancel/rerun controls.

## Conventions

- UI primitives in `src/components/ui/` use Tailwind + `class-variance-authority`
- Color scheme uses HSL CSS variables defined in `src/app/globals.css`
- API routes return `NextResponse.json({ error }, { status })` on failure
- ESLint allows `any` types and unused vars prefixed with `_`
- Supabase queries use chained `.select()/.eq()/.order()/.limit()` pattern
