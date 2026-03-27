# Job Scout

AI-powered job fit evaluation platform. Define LinkedIn job searches, scrape results on a daily schedule or on-demand, and let Claude score each job against your resume with a weighted rubric. Rate results to calibrate future evaluations.

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
3. **Run searches** on-demand or let the daily cron handle it. The scraper fetches job listings from LinkedIn's public search pages, filters out blocked publishers and low-comp roles, fetches full job descriptions, and sends each one to Claude for evaluation.
4. **Review scored results** in a sortable, filterable table. Each job gets a 0-100 score across six rubric categories (required skills, experience, role level, industry match, nice-to-haves, education).
5. **Rate jobs** 1-4 stars with notes. Your ratings feed back into the evaluator as calibration data, so the AI learns what you actually care about beyond what the rubric captures.
6. **Re-evaluate** jobs after changing the evaluator prompt. Prompt versions are tracked so you can see which version scored each job.

## Tech Stack

- **Next.js 15** (App Router) with TypeScript
- **Supabase** (Postgres, Auth, Storage, Row-Level Security)
- **Anthropic Claude API** for job evaluation
- **Tailwind CSS** with custom UI components
- **Cheerio** for HTML parsing
- **Vercel** for deployment and cron scheduling

## Features

- Email/password authentication via Supabase Auth
- Resume upload with markdown preview
- Up to 10 configurable saved searches per user (admin-adjustable)
- LinkedIn scraper with pagination, deduplication, blocked publisher filtering, and compensation filtering
- AI evaluation with a 6-category weighted scoring rubric
- Per-user calibration from star ratings and notes
- Sortable/filterable job results table with sticky headers and fixed pagination footer
- Slide-out job detail panel with score breakdown, strengths/gaps, AI summary, and inline rating
- Streaming progress for scrape and re-evaluate operations (SSE)
- Prompt version tracking with rollback support
- Admin dashboard with global config, prompt editor, user management, and system-wide run logs
- Daily scheduled scraping via Vercel Cron
- Rate limiting on on-demand scrapes (configurable)
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

Run the contents of `supabase/migration.sql` in your Supabase SQL Editor. This creates all tables, RLS policies, storage bucket, triggers, and seed data.

Then run the fix scripts:

- `supabase/fix-rls.sql` - Fixes infinite recursion in admin RLS policies
- `supabase/fix-date-posted.sql` - Changes `date_posted` to `TIMESTAMPTZ`
- `supabase/fix-prompt-version.sql` - Adds prompt version tracking

### 4. Create the first admin

After registering your first account, promote yourself to admin:

```sql
UPDATE profiles SET role = 'admin' WHERE email = 'your-email@example.com';
```

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deployment

Deploy to Vercel and set the environment variables in the Vercel dashboard. The `vercel.json` configures a daily cron job at 6:00 AM UTC that runs all users' active searches.

```json
{
  "crons": [
    {
      "path": "/api/scrape/cron",
      "schedule": "0 6 * * *"
    }
  ]
}
```

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
    admin/            Admin dashboard, settings, prompts, users, run logs
    dashboard/        Job results, searches, resume, run history
    api/              All API routes (jobs, searches, scrape, admin, resume)
  components/         Sidebar, job detail panel, search form, UI primitives
  lib/
    scraper/          LinkedIn URL builder, HTML parser, salary parser, pipeline
    evaluator.ts      Claude API integration with prompt rendering and calibration
    config.ts         System config reader with defaults
    auth.ts           Server-side auth helpers
    supabase/         Supabase client (browser, server, middleware)
supabase/
  migration.sql       Full database schema, RLS, triggers, seed data
  fix-*.sql           Incremental migration fixes
```

## License

MIT
