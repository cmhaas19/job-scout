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

- `src/lib/evaluator.ts` — Claude API integration. Loads prompt from `system_prompts` table, interpolates threshold variables, includes user's rated jobs as calibration data. Returns scores across 6 weighted categories (total 100 points) with fit categories: Strong (≥85), Good (≥70), Borderline (≥60), Weak (<60).
- `src/lib/scraper/pipeline.ts` — Main orchestration. For each active search: builds LinkedIn URL, fetches/parses results, filters (blocked publishers, salary thresholds, duplicates), fetches full descriptions, evaluates with Claude, saves to DB. Respects `delay_between_fetches_ms` and `eval_concurrency` config.
- `src/lib/scraper/parser.ts` — HTML parsing of LinkedIn search results and job detail pages.
- `src/lib/scraper/url-builder.ts` — Maps search parameters to LinkedIn URL query params.
- `src/lib/scraper/salary.ts` — Salary extraction from job descriptions.

### Auth Pattern

All API routes check `supabase.auth.getUser()` and return 401 if unauthorized. Admin routes additionally check `profile.role === 'admin'`. Auth helpers in `src/lib/auth.ts` provide `getUser()`, `requireUser()`, `getProfile()`, `requireAdmin()`.

Two Supabase clients: server client (SSR, uses request cookies) and service role client (for admin/cron operations that bypass RLS).

### Database

Schema lives in `supabase/migration.sql`. Key tables: `profiles`, `saved_searches`, `job_evaluations`, `run_logs`, `system_config`, `system_prompts`, `prompt_versions`. RLS policies enforce multi-tenant isolation. Deduplication via UNIQUE constraint on `(user_id, job_url)`.

### Admin-Configurable Settings

Stored in `system_config` table, read via `src/lib/config.ts` with defaults: `blocked_publishers`, `min_comp_top_end`, score thresholds, `eval_model`, `eval_concurrency`, `delay_between_fetches_ms`, `max_searches_per_user`, `max_refreshes_per_hour`, `max_results_per_search`.

### Streaming

Scrape progress and re-evaluation use Server-Sent Events (SSE) — see `/api/scrape/status/[runId]` and `/api/jobs/re-evaluate`.

### Deployment

Vercel with cron configured in `vercel.json` (daily at 14:00 UTC). Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`.

## Conventions

- UI primitives in `src/components/ui/` use Tailwind + `class-variance-authority`
- Color scheme uses HSL CSS variables defined in `src/app/globals.css`
- API routes return `NextResponse.json({ error }, { status })` on failure
- ESLint allows `any` types and unused vars prefixed with `_`
- Supabase queries use chained `.select()/.eq()/.order()/.limit()` pattern
