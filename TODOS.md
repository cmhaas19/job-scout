# TODOS

## Chrome Extension / Extension API

### Add an indexed LinkedIn job-ID column to job_evaluations
**Priority:** P1
Cached-score matching extracts the numeric LinkedIn ID from `job_url` in JS, which forces `fetchEvalIndexByJobId` to page through the user's entire table on every lookup/evaluate call (a DB amplifier that grows forever), and the `(user_id, job_url)` unique constraint can't stop a slugged-URL pipeline row and a slug-free extension row coexisting for the same job in a write race. Fix: generated/backfilled `linkedin_job_id` column, index it, query with `.in()`, and add a partial unique constraint on `(user_id, linkedin_job_id)`.
Noticed on: chrome-extension (flagged by performance specialist, Codex adversarial, and Claude adversarial).

### Harden api_key_hash column access
**Priority:** P1
RLS lets authenticated users UPDATE (and SELECT) their own whole profiles row via PostgREST, so a user/XSS'd session can plant an arbitrary `api_key_hash`, bypassing the server's 256-bit key generation. Fix: `revoke update (api_key_hash, api_key_created_at) on public.profiles from authenticated;` and switch the key-generation route's writes to the service client (the RLS client would lose write access).
Noticed on: chrome-extension (red team + Codex adversarial).

### Atomic spend metering for extension evaluations
**Priority:** P2
The hourly cap (100 evals/user/hour) counts persisted rows before starting work — parallel bursts can overshoot ~2–3× and transient-error evals don't count. User accepted the soft cap for ship; upgrade to an atomic counter/reservation if the extension ever serves more than personal use.
Noticed on: chrome-extension (Codex adversarial; user decision D4).

### Expose skip_reason to the extension for smarter badges
**Priority:** P2
Lookup counts skipped rows as hits (by design, to avoid re-submitting known-bad jobs), but the extension badges every score-less hit as "no description available". Legacy `eval_failed` rows (route no longer writes them) and future skip reasons are indistinguishable. Include `skip_reason` in lookup/evaluate responses and badge accordingly.
Noticed on: chrome-extension (API-contract specialist).

## Admin / Hygiene

### Use explicit column lists where profiles is selected with *
**Priority:** P2
`/api/admin/users` and `getProfile()` use `select("*")` on profiles, which now ships `api_key_hash` (and already shipped `resume_text`) into admin/RSC payloads. The hash is preimage-resistant so this is exposure hygiene, not a vulnerability — replace with explicit column lists.
Noticed on: chrome-extension (Claude adversarial).

### Share extension constants (base URL, normalize helper)
**Priority:** P3
`https://jobscout.oakworks.ai` and the trailing-slash strip are duplicated across background.js / options.js / options.html placeholder. Hoist into a shared `defaults.js` (importScripts + script tag — no build step needed).
Noticed on: chrome-extension (maintainability specialist).

## Completed
