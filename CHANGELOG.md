# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] - 2026-07-05

### Added
- Chrome extension for LinkedIn: score every job on a search results page in place. A "Score new jobs" launcher shows live progress (animated queue, per-job spinners, score chips), then a summary of how many jobs were already in Job Scout vs newly scored, with a fit-tier breakdown matching the web app. Each job card gets a color-coded score badge (with a NEW chip for jobs the extension just added), and previously scored jobs badge instantly from cache.
- Personal API key for the extension: generate it from Setup → Resume (shown once, stored hashed), paste it into the extension's options page, and test the connection from there. Regenerating invalidates the old key.
- Extension-facing API: cached-score lookup by LinkedIn job ID and small-batch evaluation (fetch → Claude eval → save), with per-user hourly spend limits and time-budget-aware batching.

### Changed
- Jobs evaluated through the extension appear on the Jobs page tagged "Chrome Extension" and are deduplicated against scheduled scrapes by LinkedIn job ID.

### Fixed
- Transient LinkedIn or Claude failures during extension scoring are retried on the next run instead of being recorded as permanently skipped jobs.
- Cached-evaluation matching pages through the whole evaluation history, so jobs beyond the first 1,000 rows no longer look unevaluated (which previously caused duplicate evaluations).

## [0.2.0] - 2026-07-01

### Added
- Scheduled scraping now runs three times a day (6am / noon / 5pm Pacific) via Inngest, instead of once a day.
- "Run All" and per-search "Run Now" buttons queue immediately and process in the background; track progress in Run Logs.
- Anthropic prompt caching on the evaluation prompt, cutting per-job latency and token cost after the first job in a run.

### Changed
- Each saved search is scraped in its own run, and the fetch → evaluate work is processed in batches so a single search can no longer hit the serverless time limit, no matter how many jobs it returns.
- Description fetching and Claude evaluation now overlap (a job is evaluated as soon as its description loads), making runs noticeably faster.
- Job evaluations run at higher concurrency (12) with the per-run prompt/model context built once instead of per job.

### Fixed
- A single failing search no longer suppresses the digest email for that user's other searches.
- Cancelling a run is honored even if the cancel arrives during the final batch.
- Claude overloads (429/529) are retried with backoff, and each request has a 60s timeout so one stuck call can't stall a batch.
- LinkedIn requests time out after 15s instead of hanging indefinitely.

### Removed
- The daily Vercel cron (scheduling now lives in Inngest).
