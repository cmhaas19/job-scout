import { createServiceClient } from "@/lib/supabase/server";
import { buildLinkedInSearchUrl, extractJobId, normalizeJobUrl } from "./url-builder";
import { parseSearchResults, fetchPage, fetchJobDescription, type JobCard } from "./parser";
import { parseTopSalary } from "./salary";
import { buildEvalContext, evaluateJobWithContext, type EvalContext } from "@/lib/evaluator";
import { getAllConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { Json } from "@/lib/database.types";

export interface PipelineStats {
  phase: string;
  searchesRun: number;
  jobsFound: number;
  jobsFiltered: number;
  jobsSkippedDuplicate: number;
  jobsSkippedPublisher: number;
  jobsSkippedComp: number;
  jobsSkippedLocationDup: number;
  jobsFetched: number;
  jobsEvaluated: number;
  jobsFailed: number;
  errors: string[];
  // Written to the run_logs.stats JSON column; index signature keeps it
  // assignable to Json. All fields above are JSON-serializable.
  [key: string]: Json;
}

interface SavedSearch {
  id: string;
  name: string;
  keyword: string;
  location: string | null;
  date_since_posted: string;
  job_type: string | null;
  remote_filter: string | null;
  experience_level: string[];
  result_limit: number;
  sort_by: string;
}

export type PipelineLogFn = (msg: string) => void;
type Config = Awaited<ReturnType<typeof getAllConfig>>;

/** Thrown when a run is cancelled via the `cancel_requested` flag on its run_logs row. */
export class CancelledError extends Error {
  constructor(message = "Cancelled by admin") {
    super(message);
    this.name = "CancelledError";
  }
}

function defaultLog(msg: string) {
  logger.info("pipeline", msg);
}

// A scraped job card, augmented with its originating search and the job
// description fetched later in the pipeline (attached transiently before eval).
export type ScrapedJob = JobCard & {
  searchId: string;
  searchName: string;
  _description?: string;
};

/** Everything `scrapeAndFilter` produces for a single search, pre fetch/eval. */
export interface ScrapeAndFilterResult {
  // null when the user has no resume — jobs are then stored unevaluated.
  evalContext: EvalContext | null;
  // The new, filtered jobs to fetch + evaluate.
  jobs: ScrapedJob[];
  // Partial stats from the scrape/dedup/filter phases.
  stats: PipelineStats;
}

export function emptyStats(): PipelineStats {
  return {
    phase: "starting",
    searchesRun: 0,
    jobsFound: 0,
    jobsFiltered: 0,
    jobsSkippedDuplicate: 0,
    jobsSkippedPublisher: 0,
    jobsSkippedComp: 0,
    jobsSkippedLocationDup: 0,
    jobsFetched: 0,
    jobsEvaluated: 0,
    jobsFailed: 0,
    errors: [],
  };
}

const NUMERIC_STAT_KEYS = [
  "searchesRun",
  "jobsFound",
  "jobsFiltered",
  "jobsSkippedDuplicate",
  "jobsSkippedPublisher",
  "jobsSkippedComp",
  "jobsSkippedLocationDup",
  "jobsFetched",
  "jobsEvaluated",
  "jobsFailed",
] as const;

/** Accumulate a per-search / per-batch stats delta into a running total. */
export function mergeStats(into: PipelineStats, from: Partial<PipelineStats>): void {
  for (const key of NUMERIC_STAT_KEYS) {
    const val = from[key];
    if (typeof val === "number") into[key] = (into[key] as number) + val;
  }
  if (Array.isArray(from.errors)) into.errors.push(...(from.errors as string[]));
}

// Columns common to every job_evaluations upsert.
function baseJobRow(userId: string, job: ScrapedJob) {
  return {
    user_id: userId,
    search_id: job.searchId,
    job_url: job.jobUrl,
    position: job.position,
    company: job.company,
    location: job.location,
    salary: job.salary,
    ago_time: job.agoTime,
    date_posted: job.datePosted,
    company_logo: job.companyLogo,
    search_query: job.searchName,
  };
}

// Stable dedup key: the numeric LinkedIn job ID when present, else the
// normalized URL (covers imported / non-LinkedIn jobs).
const dedupKey = (url: string) => extractJobId(url) ?? normalizeJobUrl(url);

/** Run `fn` over `items` with at most `limit` in flight at once. */
export async function mapPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  };
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    worker
  );
  await Promise.all(workers);
}

/** Minimal counting semaphore, used to bound the eval stage independently. */
export function createSemaphore(max: number) {
  let active = 0;
  const waiters: (() => void)[] = [];
  const pump = () => {
    while (active < max && waiters.length) {
      active++;
      waiters.shift()!();
    }
  };
  return {
    acquire: () => new Promise<void>((resolve) => {
      waiters.push(resolve);
      pump();
    }),
    release: () => {
      active--;
      pump();
    },
  };
}

/**
 * Scrape one search, drop jobs already in the DB and jobs failing the
 * publisher/comp/location filters, and build the (per-run) eval context.
 * Returns the new jobs ready for fetch+eval. Self-contained and idempotent so
 * it can back a single Inngest `step.run`.
 */
export async function scrapeAndFilter(
  userId: string,
  searchId: string,
  config: Config,
  onLog?: PipelineLogFn
): Promise<ScrapeAndFilterResult> {
  const log = (msg: string) => {
    defaultLog(msg);
    onLog?.(msg);
  };
  const supabase = await createServiceClient();
  const stats = emptyStats();

  const blockedPublishers = Array.isArray(config.blocked_publishers)
    ? (config.blocked_publishers as string[])
    : [];
  const minCompTopEnd =
    config.min_comp_top_end != null ? Number(config.min_comp_top_end) : null;

  // 1. Resume + eval context (built once here, reused for every job in the run)
  const { data: profile } = await supabase
    .from("profiles")
    .select("resume_text")
    .eq("id", userId)
    .single();
  const resumeText = profile?.resume_text ?? null;
  const evalContext = resumeText
    ? await buildEvalContext(userId, resumeText)
    : null;

  // 2. Load the search
  const { data: search } = await supabase
    .from("saved_searches")
    .select("*")
    .eq("id", searchId)
    .eq("user_id", userId)
    .single();

  if (!search) {
    log(`Search ${searchId} not found — nothing to do`);
    return { evalContext, jobs: [], stats };
  }
  stats.searchesRun = 1;

  // 3. Scrape (paginate LinkedIn guest search)
  const s = search as SavedSearch;
  const scraped: ScrapedJob[] = [];
  const seenKeys = new Set<string>();
  const limit = s.result_limit || 100;
  const MAX_EMPTY_OR_DUP_PAGES = 3;
  const MAX_PAGES = 40; // ~1000 results, LinkedIn's practical guest ceiling
  let start = 0;
  let page = 0;
  let nonProductivePages = 0;

  log(`Scraping "${s.name}" (keyword: "${s.keyword}", limit: ${limit})`);

  while (scraped.length < limit && page < MAX_PAGES) {
    const url = buildLinkedInSearchUrl({
      keyword: s.keyword,
      location: s.location,
      date_since_posted: s.date_since_posted,
      job_type: s.job_type,
      remote_filter: s.remote_filter,
      experience_level: s.experience_level,
      sort_by: s.sort_by,
      start,
    });

    try {
      const html = await fetchPage(url);
      const cards = parseSearchResults(html);
      page++;

      let newCards = 0;
      for (const card of cards) {
        const key = dedupKey(card.jobUrl);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          scraped.push({ ...card, searchId: s.id, searchName: s.name });
          newCards++;
        }
      }

      log(`  page start=${start}: ${cards.length} cards, ${newCards} new (${scraped.length} total)`);

      if (newCards === 0) {
        nonProductivePages++;
        if (nonProductivePages >= MAX_EMPTY_OR_DUP_PAGES) {
          log(`  ${nonProductivePages} consecutive non-productive pages — stopping`);
          break;
        }
      } else {
        nonProductivePages = 0;
      }

      start += 25;
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err: any) {
      log(`  ERROR: ${err.message}`);
      stats.errors.push(`Search "${s.name}" page ${start}: ${err.message}`);
      break;
    }
  }

  stats.jobsFound = scraped.length;

  // 4. Deduplicate against existing jobs (load all existing keys, 1000/page)
  const existingKeys = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: existingJobs } = await supabase
      .from("job_evaluations")
      .select("job_url")
      .eq("user_id", userId)
      .range(from, from + PAGE - 1);
    if (!existingJobs || existingJobs.length === 0) break;
    for (const j of existingJobs as { job_url: string }[]) {
      existingKeys.add(dedupKey(j.job_url));
    }
    if (existingJobs.length < PAGE) break;
  }

  let jobs = scraped.filter((job) => {
    if (existingKeys.has(dedupKey(job.jobUrl))) {
      stats.jobsSkippedDuplicate++;
      return false;
    }
    return true;
  });
  log(`After dedup: ${jobs.length} new (${stats.jobsSkippedDuplicate} already seen)`);

  // 5. Blocked publishers (record the skip; await so it can't be dropped on freeze)
  const kept: ScrapedJob[] = [];
  for (const job of jobs) {
    const companyLower = job.company.toLowerCase();
    const match = blockedPublishers.find((p) => companyLower.includes(p.toLowerCase()));
    if (match) {
      stats.jobsSkippedPublisher++;
      log(`  Blocked publisher: "${job.company}" matched "${match}"`);
      await recordSkipped(supabase, userId, job, `Blocked publisher: ${match}`);
    } else {
      kept.push(job);
    }
  }
  jobs = kept;

  // 6. Compensation floor
  const keptComp: ScrapedJob[] = [];
  for (const job of jobs) {
    const topSalary = parseTopSalary(job.salary);
    if (topSalary !== null && minCompTopEnd !== null && topSalary < minCompTopEnd) {
      stats.jobsSkippedComp++;
      log(`  Comp filter: "${job.company}" — ${job.salary} (top: $${topSalary} < $${minCompTopEnd})`);
      await recordSkipped(
        supabase,
        userId,
        job,
        `Compensation below threshold: ${topSalary} < ${minCompTopEnd}`
      );
    } else {
      keptComp.push(job);
    }
  }
  jobs = keptComp;

  // 7. Collapse location variants of the same role
  const seen = new Set<string>();
  jobs = jobs.filter((job) => {
    const key = `${job.company.toLowerCase()}|${job.position.toLowerCase()}`;
    if (seen.has(key)) {
      stats.jobsSkippedLocationDup++;
      return false;
    }
    seen.add(key);
    return true;
  });

  stats.jobsFiltered = jobs.length;
  log(
    `After filters: ${jobs.length} to process (publisher -${stats.jobsSkippedPublisher}, comp -${stats.jobsSkippedComp}, loc-dup -${stats.jobsSkippedLocationDup})`
  );

  return { evalContext, jobs, stats };
}

async function recordSkipped(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  userId: string,
  job: ScrapedJob,
  reason: string
): Promise<void> {
  const { error } = await supabase
    .from("job_evaluations")
    .upsert(
      { ...baseJobRow(userId, job), skipped: true, skip_reason: reason },
      { onConflict: "user_id,job_url" }
    );
  if (error) {
    logger.error("pipeline", "failed to record skipped job", {
      jobUrl: job.jobUrl,
      error: error.message,
    });
  }
}

/**
 * Fetch descriptions and evaluate one batch of jobs, upserting results. Returns
 * the stats delta for the batch. Sized so one call comfortably fits a single
 * function-timeout budget (see `scrape_batch_size`); the Inngest orchestrator
 * runs each batch as its own `step.run` for a fresh budget + retry.
 */
export async function processJobBatch(
  userId: string,
  jobs: ScrapedJob[],
  evalContext: EvalContext | null,
  config: Config,
  onLog?: PipelineLogFn
): Promise<Partial<PipelineStats>> {
  const log = (msg: string) => {
    defaultLog(msg);
    onLog?.(msg);
  };
  const supabase = await createServiceClient();
  const delay = Number(config.delay_between_fetches_ms) || 1500;
  // Clamp to >=1: a zero/negative concurrency would deadlock the eval semaphore
  // (waiters never released) or spawn zero fetch workers.
  const fetchConcurrency = Math.max(1, Number(config.fetch_concurrency) || 5);
  const evalConcurrency = Math.max(1, Number(config.eval_concurrency) || 12);

  const delta: Pick<
    PipelineStats,
    "jobsFetched" | "jobsEvaluated" | "jobsFailed" | "errors"
  > = { jobsFetched: 0, jobsEvaluated: 0, jobsFailed: 0, errors: [] };

  // Eval runs on its own (wider) pool and overlaps fetching: a job is handed to
  // the eval stage the moment its description lands, so eval no longer waits for
  // every fetch to finish. LinkedIn fetches stay bounded at fetchConcurrency.
  const evalSem = createSemaphore(evalConcurrency);
  const evalTasks: Promise<void>[] = [];

  const scheduleEval = (job: ScrapedJob, description: string) => {
    evalTasks.push(
      (async () => {
        await evalSem.acquire();
        try {
          // No resume → store unevaluated (with description).
          if (!evalContext) {
            await supabase.from("job_evaluations").upsert(
              { ...baseJobRow(userId, job), description, skipped: false },
              { onConflict: "user_id,job_url" }
            );
            return;
          }

          const result = await evaluateJobWithContext(
            evalContext,
            job.company,
            job.position,
            description
          );
          if (result) {
            log(`    ✓ ${job.company}: ${result.fit_category} (${result.total_score})`);
            await supabase.from("job_evaluations").upsert(
              {
                ...baseJobRow(userId, job),
                description,
                fit_category: result.fit_category,
                total_score: result.total_score,
                score_details: result.scores,
                eval_summary: result.summary,
                strengths: result.strengths,
                gaps: result.gaps,
                prompt_version: result.prompt_version,
                skipped: false,
              },
              { onConflict: "user_id,job_url" }
            );
            delta.jobsEvaluated++;
          } else {
            log(`    ✗ ${job.company}: eval returned null`);
            await supabase.from("job_evaluations").upsert(
              {
                ...baseJobRow(userId, job),
                description,
                skipped: true,
                skip_reason: "eval_failed",
              },
              { onConflict: "user_id,job_url" }
            );
            delta.jobsFailed++;
          }
        } catch (err: any) {
          delta.jobsFailed++;
          log(`    ✗ ${job.company}: eval ERROR — ${err.message}`);
          delta.errors.push(`Eval ${job.company}: ${err.message}`);
        } finally {
          evalSem.release();
        }
      })()
    );
  };

  // Fetch stage: bounded pool over the batch. On success, immediately schedule
  // the eval (which runs concurrently on its own pool).
  await mapPool(jobs, fetchConcurrency, async (job) => {
    try {
      const description = await fetchJobDescription(job.jobUrl, 2, delay);
      if (description) {
        delta.jobsFetched++;
        scheduleEval(job, description);
      } else {
        delta.jobsFailed++;
        log(`    ✗ ${job.company}: no description found`);
        await supabase.from("job_evaluations").upsert(
          {
            ...baseJobRow(userId, job),
            skipped: true,
            skip_reason: "Failed to fetch job description",
          },
          { onConflict: "user_id,job_url" }
        );
      }
    } catch (err: any) {
      delta.jobsFailed++;
      log(`    ✗ ${job.company}: fetch ERROR — ${err.message}`);
      delta.errors.push(`Fetch JD ${job.company}: ${err.message}`);
    }
  });

  // Drain any evals still in flight after the last fetch completes.
  await Promise.all(evalTasks);

  return delta;
}

/**
 * Run the full pipeline for one or more searches sequentially, in a single
 * function invocation. Used by the non-Inngest callers (admin rerun, the cron
 * backstop, the on-demand SSE route). The Inngest path instead composes
 * `scrapeAndFilter` + `processJobBatch` as durable steps.
 *
 * Signature preserved: `searchIds` omitted → all active searches; `onLog`
 * streams progress; `runLogId` drives the heartbeat + cancel checks.
 */
export async function runPipeline(
  userId: string,
  searchIds?: string[],
  runLogId?: string,
  onLog?: PipelineLogFn
): Promise<PipelineStats> {
  const log = (msg: string) => {
    defaultLog(msg);
    onLog?.(msg);
  };
  const supabase = await createServiceClient();
  const stats = emptyStats();

  // Heartbeat + cancel check; throws CancelledError if an admin cancelled.
  async function updateRunLog() {
    if (!runLogId) return;
    const { data } = await supabase
      .from("run_logs")
      .update({ stats, last_heartbeat_at: new Date().toISOString() })
      .eq("id", runLogId)
      .select("cancel_requested")
      .single();
    if (data?.cancel_requested) throw new CancelledError();
  }

  log(`Starting pipeline for user ${userId.slice(0, 8)}...`);

  try {
    const config = await getAllConfig();
    const batchSize = Math.max(1, Number(config.scrape_batch_size) || 8);

    // Resolve which searches to run.
    let ids: string[];
    if (searchIds && searchIds.length > 0) {
      ids = searchIds;
    } else {
      const { data } = await supabase
        .from("saved_searches")
        .select("id")
        .eq("user_id", userId)
        .eq("is_active", true);
      ids = (data ?? []).map((r) => r.id);
    }

    if (ids.length === 0) {
      log("No searches to run — exiting");
      stats.phase = "completed";
      await updateRunLog();
      return stats;
    }

    for (const searchId of ids) {
      stats.phase = "scraping";
      await updateRunLog();

      const { evalContext, jobs, stats: sf } = await scrapeAndFilter(
        userId,
        searchId,
        config,
        onLog
      );
      mergeStats(stats, sf);
      await updateRunLog();

      const total = jobs.length;
      for (let i = 0; i < total; i += batchSize) {
        const batch = jobs.slice(i, i + batchSize);
        stats.phase = `evaluating (${Math.min(i + batchSize, total)}/${total})`;
        await updateRunLog(); // heartbeat + cancel between batches
        const batchDelta = await processJobBatch(userId, batch, evalContext, config, onLog);
        mergeStats(stats, batchDelta);
      }
      await updateRunLog();
    }

    stats.phase = "completed";
    await updateRunLog();

    log(
      `Pipeline complete! Found: ${stats.jobsFound}, Evaluated: ${stats.jobsEvaluated}, Failed: ${stats.jobsFailed}`
    );
    if (stats.errors.length > 0) log(`Errors: ${stats.errors.join("; ")}`);
  } catch (err: any) {
    if (err instanceof CancelledError) {
      stats.phase = "cancelled";
      log("Pipeline CANCELLED by admin");
    } else {
      stats.phase = "failed";
      stats.errors.push(err.message);
      log(`Pipeline FAILED: ${err.message}`);
    }
    if (runLogId) {
      try {
        await supabase
          .from("run_logs")
          .update({ stats, last_heartbeat_at: new Date().toISOString() })
          .eq("id", runLogId);
      } catch (_) {
        /* ignore */
      }
    }
  }

  return stats;
}
