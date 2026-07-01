# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
