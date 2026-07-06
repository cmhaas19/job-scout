# Job Scout

AI-powered job fit evaluation platform. Define LinkedIn job searches, scrape results on a schedule or on-demand, and let Claude score each job against your resume with a weighted rubric. Rate results to calibrate future evaluations. A companion Chrome extension scores LinkedIn search results in place as you browse.

## Screenshots

| Home | Jobs |
|------|------|
| ![Home](docs/screenshots/home.png) | ![Jobs](docs/screenshots/jobs.png) |

| Searches | Run Logs |
|----------|----------|
| ![Searches](docs/screenshots/searches.png) | ![Run Logs](docs/screenshots/run-logs.png) |

## How It Works

1. **Upload your resume** (.md or .txt) so the AI evaluator has context about your background.
2. **Create saved searches** with LinkedIn search parameters (keywords, location, job type, experience level, remote filter, etc.).
3. **Run searches** on-demand or let scheduled runs handle it (three times daily via Inngest). The scraper fetches job listings from LinkedIn's public search pages, filters out blocked publishers and low-comp roles, fetches full job descriptions, and sends each one to Claude for evaluation.
4. **Review scored results** in a sortable, filterable table. Each job gets a 0-100 score across six rubric categories (required skills, experience, role level, industry match, nice-to-haves, education).
5. **Rate jobs** 1-4 stars with notes. Your ratings feed back into the evaluator as calibration data, so the AI learns what you actually care about beyond what the rubric captures.
6. **Re-evaluate** jobs after changing the evaluator prompt. Prompt versions are tracked so you can see which version scored each job.

## Tech Stack

- **Next.js 15** (App Router) with TypeScript
- **Supabase** (Postgres, Auth, Storage, Row-Level Security)
- **Anthropic Claude API** for job evaluation
- **Tailwind CSS** with custom UI components
- **Cheerio** for HTML parsing
- **Inngest** for durable scheduled scraping
- **Vercel** for deployment

## Features

- Email/password authentication via Supabase Auth
- Resume upload with markdown preview
- Up to 10 configurable saved searches per user (admin-adjustable)
- LinkedIn scraper with pagination, deduplication, blocked publisher filtering, and compensation filtering
- AI evaluation with a 6-category weighted scoring rubric
- Per-user calibration from star ratings and notes
- Sortable/filterable job results table with sticky headers and fixed pagination footer
- Slide-out job detail panel with score breakdown, strengths/gaps, AI summary, and inline rating
- Streaming progress for re-evaluate operations (SSE); scrape runs tracked in Run Logs
- Prompt version tracking with rollback support
- Admin dashboard with global config, prompt editor, user management, and system-wide run logs
- Scheduled scraping three times daily (6am / noon / 5pm Pacific) via Inngest
- Rate limiting on on-demand scrapes (configurable)
- Chrome extension (`extension/`) that scores LinkedIn search-results pages in place, authenticated with a personal API key generated from Setup → Resume
- Mobile-responsive sidebar navigation

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- An [Anthropic API key](https://console.anthropic.com)

### 1. Clone and install

```bash
git clone https://github.com/cmhaas19/job-scout.git
cd job-scout
npm install
```

### 2. Set up environment variables

```bash
cp .env.local.example .env.local
```

Fill in your values:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ANTHROPIC_API_KEY=sk-ant-...
CRON_SECRET=any-random-string
```

### 3. Set up the database

Schema is managed with the [Supabase CLI](https://supabase.com/docs/guides/cli) (installed as a dev dependency), so migrations live in `supabase/migrations/` and are applied to the linked project — no more pasting SQL into the dashboard.

Link the project once (needs your Supabase access token + database password when prompted):

```bash
npx supabase link --project-ref <your-project-ref>
```

Existing database (schema already lives in Supabase — the normal case here): you don't need a baseline. The remote's migration history is empty, so new migrations you create apply cleanly on top of the current schema. Just start using the day-to-day loop below. The pre-CLI schema is preserved for reference in `supabase/legacy/`.

> **Docker note:** `db push`, `migration new/repair/list`, and `gen types` connect directly to the remote and need **no Docker**. Only `db pull`, `db diff`, and `db dump` require Docker (they provision a local shadow Postgres). If you have Docker Desktop, `npm run db:pull` will snapshot the remote into a baseline migration in one step; otherwise skip it.

Fresh database (brand-new Supabase project): apply the reference schema in `supabase/legacy/migration.sql` (plus the `fix-*`/`add-*` patches, in the order listed in `supabase/legacy/README.md`) once via the dashboard SQL editor, then use the CLI for everything after.

Day-to-day schema changes:

```bash
npm run db:new <name>  # create a new timestamped migration in supabase/migrations/
#   ...edit the generated .sql file...
npm run db:push        # apply it to the linked database
npm run db:types       # regenerate src/lib/database.types.ts
```

The original hand-applied SQL (pre-CLI) is archived in `supabase/legacy/` for reference only.

### 4. Create the first admin

After registering your first account, promote yourself to admin:

```sql
UPDATE profiles SET role = 'admin' WHERE email = 'your-email@example.com';
```

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:3210](http://localhost:3210).

## Deployment

Deploy to Vercel and set the environment variables in the Vercel dashboard. Scheduled scraping runs on [Inngest](https://www.inngest.com) (served at `/api/inngest`), not Vercel Cron — the Vercel↔Inngest integration sets `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`. See `CLAUDE.md` → "Scheduling (Inngest)" and "Deployment" for the full setup (custom domain, `INNGEST_SERVE_HOST`, and why Vercel Deployment Protection must stay off).

## Admin Configuration

All settings are editable at `/admin/settings` and take effect immediately:

| Setting | Default | Description |
|---|---|---|
| `blocked_publishers` | Jobgether, Ladders, Dice, etc. | Companies to auto-skip |
| `min_comp_top_end` | 300,000 | Minimum top-end salary (null to disable) |
| `score_threshold_strong` | 85 | Minimum score for "Strong Fit" |
| `score_threshold_good` | 70 | Minimum score for "Good Fit" |
| `score_threshold_borderline` | 60 | Minimum score for "Borderline" |
| `eval_model` | claude-sonnet-4-20250514 | Claude model for evaluations |
| `eval_concurrency` | 5 | Parallel evaluation requests |
| `max_searches_per_user` | 10 | Search limit per user |
| `max_refreshes_per_hour` | 2 | On-demand scrape rate limit |

## Project Structure

```
src/
  app/
    (auth)/           Login and registration pages
    (app)/            Authenticated app pages (dashboard, jobs, searches, setup)
    admin/            Admin dashboard, settings, prompts, users, run logs
    api/              All API routes (jobs, searches, scrape, extension, admin, resume)
  components/         Sidebar, job detail panel, search form, UI primitives
  lib/
    scraper/          LinkedIn URL builder, HTML parser, salary parser, pipeline
    evaluator.ts      Claude API integration with prompt rendering and calibration
    config.ts         System config reader with defaults
    auth.ts           Server-side auth helpers
    supabase/         Supabase client (browser, server, middleware)
supabase/
  config.toml         Supabase CLI configuration
  migrations/         CLI-managed, timestamped schema migrations
  legacy/             Archived pre-CLI SQL (reference only)
extension/
  manifest.json       Chrome extension (Manifest V3, no build step)
  content.js/.css     Badge injection + scoring UI on LinkedIn search pages
  background.js       Service worker; owns all Job Scout API calls
  options.html/.js    API key + backend URL settings
```

## Testing

Unit tests run on [Vitest](https://vitest.dev):

```bash
npm test               # run once
npm run test:watch     # watch mode
npm run test:coverage  # with coverage
```

Tests live next to the code they cover as `*.test.ts` (see `src/lib/`).

## License

MIT
