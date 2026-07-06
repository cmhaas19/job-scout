import { NextRequest, NextResponse } from "next/server";
import { requireApiKeyUser } from "@/lib/api-auth";
import { apiError, dbError, serverError } from "@/lib/api-response";
import { parseBody, extensionEvaluateSchema } from "@/lib/validation";
import { fetchEvalIndexByJobId, jobUrlForId } from "@/lib/extension-lookup";
import { fetchJobPage } from "@/lib/scraper/parser";
import { buildEvalContext, evaluateJobWithContext } from "@/lib/evaluator";
import { getConfigNumber } from "@/lib/config";
import { logger } from "@/lib/logger";
import { FIT_CATEGORIES } from "@/lib/constants";
import type { TablesInsert } from "@/lib/database.types";

// Fetch + evaluate + persist a small batch of LinkedIn jobs for the Chrome
// extension. The batch is capped at 3 (schema, matching the extension's
// BATCH_SIZE) and processed sequentially with a delay between LinkedIn
// fetches; worst-case retry backoff on 3 jobs stays under this budget.
export const maxDuration = 120;

type JobResult = {
  jobId: string;
  status: "cached" | "evaluated" | "skipped" | "error";
  total_score?: number | null;
  fit_category?: string | null;
  summary?: string | null;
  skipped?: boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Spend guard: bounds Claude + LinkedIn cost from a leaked or scripted key.
// The schema caps a request at 3 jobs; this caps a user's hour.
const HOURLY_EVAL_CAP = 100;

// Stop starting new jobs when this much of the 120s maxDuration is spent —
// a slow LinkedIn fetch + eval could otherwise blow past the budget and get
// the function killed mid-batch (opaque 504, wasted Claude spend). 60s leaves
// room for one worst-case job (~50s of fetch retry + eval) to finish inside
// the budget.
const DEADLINE_MS = 60_000;

// All upserts use ignoreDuplicates: if a row for this job already exists (a
// scheduled scrape raced us between the cache check and the write), the
// existing row — and its search attribution, archive state, and evaluation —
// wins. This route should only ever CREATE rows, never overwrite.
const UPSERT_OPTS = { onConflict: "user_id,job_url", ignoreDuplicates: true };

/** Light shape guard on LLM output before it reaches the database. */
function isValidEvalResult(result: {
  total_score: number;
  fit_category: string;
}): boolean {
  return (
    typeof result.total_score === "number" &&
    Number.isFinite(result.total_score) &&
    (FIT_CATEGORIES as readonly string[]).includes(result.fit_category)
  );
}

export async function POST(request: NextRequest) {
  const gate = await requireApiKeyUser(request);
  if (gate instanceof Response) return gate;
  // Service-role client (key auth happens before RLS can apply): every query
  // below must filter by user_id explicitly.
  const { supabase, userId } = gate;

  try {
    const parsed = await parseBody(request, extensionEvaluateSchema);
    if ("error" in parsed) return parsed.error;
    // Dedupe defensively — a hostile/buggy client sending the same jobId five
    // times must not multiply LinkedIn fetches and Claude spend.
    const seen = new Set<string>();
    const jobs = parsed.data.jobs.filter((j) =>
      seen.has(j.jobId) ? false : (seen.add(j.jobId), true)
    );

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("resume_text")
      .eq("id", userId)
      .single();

    if (profileError) {
      // A transient DB failure must not masquerade as "no resume uploaded".
      return dbError("extension.evaluate.profile", profileError);
    }

    if (!profile?.resume_text) {
      return apiError(
        "No resume uploaded — upload your resume in Job Scout first",
        400
      );
    }

    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { count: recentCount } = await supabase
      .from("job_evaluations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("search_query", "Chrome Extension")
      .gte("created_at", hourAgo);

    if ((recentCount ?? 0) >= HOURLY_EVAL_CAP) {
      return apiError(
        "Hourly evaluation limit reached — try again in a bit",
        429
      );
    }

    // Race guard (double-click / concurrent tabs): re-check the cache and
    // return existing rows without re-fetching or re-evaluating.
    const byJobId = await fetchEvalIndexByJobId(supabase, userId);

    const evalContext = await buildEvalContext(userId, profile.resume_text);
    const delay = (await getConfigNumber("delay_between_fetches_ms")) ?? 1500;

    const results: JobResult[] = [];
    let firstFetch = true;
    const startedAt = Date.now();

    for (const job of jobs) {
      if (Date.now() - startedAt > DEADLINE_MS) {
        // Out of budget — return what we have; "error" results are retried
        // by the extension on the next run.
        results.push({ jobId: job.jobId, status: "error" });
        continue;
      }

      const cached = byJobId.get(job.jobId);
      if (cached) {
        results.push({
          jobId: job.jobId,
          status: "cached",
          total_score: cached.total_score,
          fit_category: cached.fit_category,
          summary: cached.eval_summary,
          skipped: cached.skipped ?? false,
        });
        continue;
      }

      const jobUrl = jobUrlForId(job.jobId);
      const baseRow: TablesInsert<"job_evaluations"> = {
        user_id: userId,
        job_url: jobUrl,
        position: job.title ?? "Unknown",
        company: job.company ?? "Unknown",
        search_id: null,
        search_query: "Chrome Extension",
      };

      try {
        if (!firstFetch) await sleep(delay);
        firstFetch = false;

        // Single retry only — this route has a hard deadline, and a transient
        // failure is returned as a retryable "error", never persisted.
        const page = await fetchJobPage(jobUrl, 1, delay);

        if (!page) {
          // Fetch failed (429/timeout/network) — do NOT write a skip row.
          // A persisted skip would permanently block this job from both the
          // extension (lookup counts skips as hits) and the scrape pipeline
          // (dedup by job ID) over what was a transient failure.
          results.push({ jobId: job.jobId, status: "error" });
          continue;
        }

        if (!page.description) {
          const { error: skipError } = await supabase
            .from("job_evaluations")
            .upsert(
              {
                ...baseRow,
                position: page.position || baseRow.position,
                company: page.company || baseRow.company,
                location: page.location ?? null,
                salary: page.salary ?? null,
                company_logo: page.companyLogo ?? null,
                skipped: true,
                skip_reason: "no_description",
              },
              UPSERT_OPTS
            );
          if (skipError) {
            logger.error("extension.evaluate", `skip upsert failed for ${job.jobId}`, {
              error: skipError.message,
            });
            // Nothing was persisted — report retryable, not skipped.
            results.push({ jobId: job.jobId, status: "error" });
            continue;
          }
          results.push({ jobId: job.jobId, status: "skipped" });
          continue;
        }

        const row: TablesInsert<"job_evaluations"> = {
          ...baseRow,
          position: page.position || baseRow.position,
          company: page.company || baseRow.company,
          location: page.location ?? null,
          salary: page.salary ?? null,
          ago_time: page.agoTime ?? null,
          date_posted: page.datePosted ?? null,
          company_logo: page.companyLogo ?? null,
          description: page.description,
        };

        const result = await evaluateJobWithContext(
          evalContext,
          row.company ?? "Unknown",
          row.position ?? "Unknown",
          page.description
        );

        if (result && isValidEvalResult(result)) {
          const { error: upsertError } = await supabase
            .from("job_evaluations")
            .upsert(
              {
                ...row,
                fit_category: result.fit_category,
                total_score: result.total_score,
                score_details: result.scores,
                eval_summary: result.summary,
                strengths: result.strengths,
                gaps: result.gaps,
                prompt_version: result.prompt_version,
                skipped: false,
              },
              UPSERT_OPTS
            );
          if (upsertError) {
            logger.error("extension.evaluate", `upsert failed for ${job.jobId}`, {
              error: upsertError.message,
            });
            // The score wasn't persisted — don't tell the client it was.
            results.push({ jobId: job.jobId, status: "error" });
            continue;
          }
          results.push({
            jobId: job.jobId,
            status: "evaluated",
            total_score: result.total_score,
            fit_category: result.fit_category,
            summary: result.summary,
          });
        } else {
          // Eval returned null or malformed output — transient (overload,
          // parse hiccup). Persist nothing so the job stays retryable; a
          // permanent eval_failed row would exclude it from re-evaluation
          // everywhere.
          logger.warn("extension.evaluate", `eval returned no valid result for ${job.jobId}`);
          results.push({ jobId: job.jobId, status: "error" });
        }
      } catch (err) {
        // One 429/timeout shouldn't lose the rest of the batch.
        logger.error("extension.evaluate", `job ${job.jobId} failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
        results.push({ jobId: job.jobId, status: "error" });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    return serverError("extension.evaluate", err);
  }
}
