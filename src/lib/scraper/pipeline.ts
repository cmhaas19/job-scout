import { createServiceClient } from "@/lib/supabase/server";
import { buildLinkedInSearchUrl, extractJobId, normalizeJobUrl } from "./url-builder";
import { parseSearchResults, fetchPage, fetchJobDescription, type JobCard } from "./parser";
import { parseTopSalary } from "./salary";
import { evaluateJob } from "@/lib/evaluator";
import { getAllConfig } from "@/lib/config";

interface PipelineStats {
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

/** Thrown when a run is cancelled via the `cancel_requested` flag on its run_logs row. */
export class CancelledError extends Error {
  constructor(message = "Cancelled by admin") {
    super(message);
    this.name = "CancelledError";
  }
}

function defaultLog(msg: string) {
  console.log(`[pipeline] ${msg}`);
}

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
  const stats: PipelineStats = {
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

  // Writes a heartbeat + latest stats on every checkpoint, and aborts the run
  // (via CancelledError) if an admin has set cancel_requested in the meantime.
  async function updateRunLog() {
    if (!runLogId) return;
    const { data } = await supabase
      .from("run_logs")
      .update({ stats, last_heartbeat_at: new Date().toISOString() })
      .eq("id", runLogId)
      .select("cancel_requested")
      .single();
    if (data?.cancel_requested) {
      throw new CancelledError();
    }
  }

  log(`Starting pipeline for user ${userId.slice(0, 8)}...`);

  try {
    // 1. Load resume
    stats.phase = "loading_resume";
    await updateRunLog();

    const { data: profile } = await supabase
      .from("profiles")
      .select("resume_text")
      .eq("id", userId)
      .single();

    const resumeText = profile?.resume_text;
    log(`Resume: ${resumeText ? `${resumeText.length} chars` : "NOT FOUND"}`);

    // 2. Load searches
    stats.phase = "loading_searches";
    await updateRunLog();

    let query = supabase
      .from("saved_searches")
      .select("*")
      .eq("user_id", userId);

    if (searchIds && searchIds.length > 0) {
      query = query.in("id", searchIds);
    } else {
      query = query.eq("is_active", true);
    }

    const { data: searches } = await query;
    if (!searches || searches.length === 0) {
      log("No searches found — exiting");
      stats.phase = "completed";
      return stats;
    }

    log(`Loaded ${searches.length} search(es)`);

    // Load all config in one query
    const config = await getAllConfig();
    const blockedPublishers = Array.isArray(config.blocked_publishers) ? config.blocked_publishers as string[] : [];
    const minCompTopEnd = config.min_comp_top_end != null ? Number(config.min_comp_top_end) : null;
    const delayMs = Number(config.delay_between_fetches_ms) || 1500;
    const evalConcurrency = Number(config.eval_concurrency) || 5;
    const fetchConcurrency = Number(config.fetch_concurrency) || 5;

    log(`Config: blockedPublishers=${blockedPublishers.length}, minComp=$${minCompTopEnd}, delay=${delayMs}ms, evalConcurrency=${evalConcurrency}, fetchConcurrency=${fetchConcurrency}`);

    // 3. Scrape each search
    stats.phase = "scraping";
    await updateRunLog();

    const allJobs: (JobCard & { searchId: string; searchName: string })[] = [];

    // Stable dedup key: the numeric LinkedIn job ID when present, else the
    // normalized URL (covers imported / non-LinkedIn jobs).
    const dedupKey = (url: string) => extractJobId(url) ?? normalizeJobUrl(url);

    // LinkedIn's guest search returns overlapping/rotating pages, so a single
    // all-duplicate page is NOT a reliable end-of-results signal. Tolerate a few
    // consecutive non-productive pages before stopping, bounded by a hard page cap.
    const MAX_EMPTY_OR_DUP_PAGES = 3;
    const MAX_PAGES = 40; // ~1000 results, LinkedIn's practical guest ceiling

    for (const search of searches as SavedSearch[]) {
      stats.searchesRun++;
      let start = 0;
      let page = 0;
      let nonProductivePages = 0;
      const seenKeys = new Set<string>();
      const limit = search.result_limit || 100;

      log(`Scraping "${search.name}" (keyword: "${search.keyword}", limit: ${limit})`);

      while (
        allJobs.filter((j) => j.searchId === search.id).length < limit &&
        page < MAX_PAGES
      ) {
        const url = buildLinkedInSearchUrl({
          keyword: search.keyword,
          location: search.location,
          date_since_posted: search.date_since_posted,
          job_type: search.job_type,
          remote_filter: search.remote_filter,
          experience_level: search.experience_level,
          sort_by: search.sort_by,
          start,
        });

        log(`  Fetching page start=${start} — ${url.slice(0, 120)}...`);

        try {
          const html = await fetchPage(url);
          log(`  Got ${html.length} bytes of HTML`);
          const cards = parseSearchResults(html);
          log(`  Parsed ${cards.length} job cards`);
          page++;

          let newCards = 0;
          for (const card of cards) {
            const key = dedupKey(card.jobUrl);
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              allJobs.push({
                ...card,
                searchId: search.id,
                searchName: search.name,
              });
              newCards++;
            }
          }

          log(`  ${newCards} new unique jobs (${allJobs.filter((j) => j.searchId === search.id).length} total for this search)`);

          if (newCards === 0) {
            nonProductivePages++;
            if (nonProductivePages >= MAX_EMPTY_OR_DUP_PAGES) {
              log(`  ${nonProductivePages} consecutive non-productive pages — stopping pagination`);
              break;
            }
          } else {
            nonProductivePages = 0;
          }

          start += 25;
          await new Promise((r) => setTimeout(r, 1000));
        } catch (err: any) {
          log(`  ERROR: ${err.message}`);
          stats.errors.push(
            `Search "${search.name}" page ${start}: ${err.message}`
          );
          break;
        }
      }
    }

    stats.jobsFound = allJobs.length;
    log(`Total jobs scraped: ${allJobs.length}`);
    await updateRunLog();

    // 4. Deduplicate against existing jobs
    stats.phase = "deduplicating";
    await updateRunLog();

    // Load ALL existing job URLs in 1000-row pages (PostgREST caps a single
    // response at 1000), so dedup stays complete for users with many jobs.
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

    let filteredJobs = allJobs.filter((job) => {
      if (existingKeys.has(dedupKey(job.jobUrl))) {
        stats.jobsSkippedDuplicate++;
        return false;
      }
      return true;
    });

    log(`After dedup: ${filteredJobs.length} new (${stats.jobsSkippedDuplicate} already seen)`);

    // 5. Filter blocked publishers
    stats.phase = "filtering";
    await updateRunLog();

    filteredJobs = filteredJobs.filter((job) => {
      const companyLower = job.company.toLowerCase();
      for (const publisher of blockedPublishers) {
        if (companyLower.includes(publisher.toLowerCase())) {
          stats.jobsSkippedPublisher++;
          log(`  Blocked publisher: "${job.company}" matched "${publisher}"`);
          supabase
            .from("job_evaluations")
            .upsert(
              {
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
                skipped: true,
                skip_reason: `Blocked publisher: ${publisher}`,
              },
              { onConflict: "user_id,job_url" }
            )
            .then(() => {});
          return false;
        }
      }
      return true;
    });

    // 6. Filter by compensation
    filteredJobs = filteredJobs.filter((job) => {
      const topSalary = parseTopSalary(job.salary);
      if (topSalary !== null && minCompTopEnd !== null && topSalary < minCompTopEnd) {
        stats.jobsSkippedComp++;
        log(`  Comp filter: "${job.company}" — ${job.salary} (top: $${topSalary} < $${minCompTopEnd})`);
        supabase
          .from("job_evaluations")
          .upsert(
            {
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
              skipped: true,
              skip_reason: `Compensation below threshold: ${topSalary} < ${minCompTopEnd}`,
            },
            { onConflict: "user_id,job_url" }
          )
          .then(() => {});
        return false;
      }
      return true;
    });

    // 7. Deduplicate location variants
    const seen = new Map<string, boolean>();
    filteredJobs = filteredJobs.filter((job) => {
      const key = `${job.company.toLowerCase()}|${job.position.toLowerCase()}`;
      if (seen.has(key)) {
        stats.jobsSkippedLocationDup++;
        return false;
      }
      seen.set(key, true);
      return true;
    });

    log(`After all filters: ${filteredJobs.length} jobs to process (publisher: -${stats.jobsSkippedPublisher}, comp: -${stats.jobsSkippedComp}, location dup: -${stats.jobsSkippedLocationDup})`);

    stats.jobsFiltered = filteredJobs.length;
    await updateRunLog();

    // 8. Fetch JDs and evaluate
    stats.phase = "fetching_descriptions";
    await updateRunLog();

    log(`Fetching job descriptions for ${filteredJobs.length} jobs (concurrency: ${fetchConcurrency})...`);

    for (let i = 0; i < filteredJobs.length; i += fetchConcurrency) {
      const batch = filteredJobs.slice(i, i + fetchConcurrency);
      const batchNum = Math.floor(i / fetchConcurrency) + 1;
      log(`  Batch ${batchNum}: fetching ${batch.length} descriptions...`);

      const results = await Promise.all(
        batch.map(async (job) => {
          try {
            const description = await fetchJobDescription(job.jobUrl, 2, delayMs);
            return { job, description, error: null as string | null };
          } catch (err: any) {
            return { job, description: null, error: err.message as string };
          }
        })
      );

      for (const { job, description, error } of results) {
        if (error) {
          stats.jobsFailed++;
          log(`    ✗ ${job.company}: ERROR — ${error}`);
          stats.errors.push(`Fetch JD ${job.company}: ${error}`);
          continue;
        }
        if (description) {
          (job as any)._description = description;
          stats.jobsFetched++;
          log(`    ✓ ${job.company}: ${description.length} chars`);
        } else {
          stats.jobsFailed++;
          log(`    ✗ ${job.company}: no description found`);
          await supabase.from("job_evaluations").upsert(
            {
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
              skipped: true,
              skip_reason: "Failed to fetch job description",
            },
            { onConflict: "user_id,job_url" }
          );
        }
      }

      // Throttle between batches (not after the last one) to stay polite to LinkedIn.
      if (i + fetchConcurrency < filteredJobs.length) {
        await new Promise((r) => setTimeout(r, delayMs));
      }

      stats.phase = `fetching_descriptions (${Math.min(i + fetchConcurrency, filteredJobs.length)}/${filteredJobs.length})`;
      await updateRunLog();
    }

    log(`Fetched ${stats.jobsFetched} descriptions (${stats.jobsFailed} failed)`);

    // 9. Evaluate with Claude
    stats.phase = "evaluating";
    await updateRunLog();

    if (resumeText && filteredJobs.length > 0) {
      log(`Evaluating ${filteredJobs.length} jobs with Claude (concurrency: ${evalConcurrency})...`);

      for (let i = 0; i < filteredJobs.length; i += evalConcurrency) {
        const batch = filteredJobs.slice(i, i + evalConcurrency);
        const batchNum = Math.floor(i / evalConcurrency) + 1;
        log(`  Batch ${batchNum}: evaluating ${batch.length} jobs...`);

        const promises = batch.map(async (job) => {
          const description = (job as any)._description;
          if (!description) return;

          try {
            log(`    Evaluating: ${job.company} — ${job.position}`);
            const result = await evaluateJob(
              userId,
              resumeText,
              job.company,
              job.position,
              description
            );

            if (result) {
              log(`    ✓ ${job.company}: ${result.fit_category} (${result.total_score})`);
              await supabase.from("job_evaluations").upsert(
                {
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
                  description,
                  search_query: job.searchName,
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
              stats.jobsEvaluated++;
            } else {
              log(`    ✗ ${job.company}: eval returned null`);
              await supabase.from("job_evaluations").upsert(
                {
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
                  description,
                  search_query: job.searchName,
                  skipped: true,
                  skip_reason: "eval_failed",
                },
                { onConflict: "user_id,job_url" }
              );
              stats.jobsFailed++;
            }
          } catch (err: any) {
            stats.jobsFailed++;
            log(`    ✗ ${job.company}: ERROR — ${err.message}`);
            stats.errors.push(`Eval ${job.company}: ${err.message}`);
          }
        });

        await Promise.all(promises);

        stats.phase = `evaluating (${Math.min(i + evalConcurrency, filteredJobs.length)}/${filteredJobs.length})`;
        await updateRunLog();
      }
    } else if (!resumeText) {
      log("No resume — storing jobs unevaluated");
      for (const job of filteredJobs) {
        const description = (job as any)._description;
        await supabase.from("job_evaluations").upsert(
          {
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
            description: description || null,
            search_query: job.searchName,
            skipped: false,
          },
          { onConflict: "user_id,job_url" }
        );
      }
    }

    stats.phase = "completed";
    await updateRunLog();

    log(`Pipeline complete! Found: ${stats.jobsFound}, Evaluated: ${stats.jobsEvaluated}, Failed: ${stats.jobsFailed}`);
    if (stats.errors.length > 0) {
      log(`Errors: ${stats.errors.join("; ")}`);
    }
  } catch (err: any) {
    if (err instanceof CancelledError) {
      stats.phase = "cancelled";
      log(`Pipeline CANCELLED by admin`);
    } else {
      stats.phase = "failed";
      stats.errors.push(err.message);
      log(`Pipeline FAILED: ${err.message}`);
    }
    // Best-effort final stats write; don't re-check the cancel flag here.
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
