import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import { extractJobId } from "@/lib/scraper/url-builder";

export type EvalRow = Pick<
  Tables<"job_evaluations">,
  "id" | "job_url" | "total_score" | "fit_category" | "eval_summary" | "skipped"
>;

/**
 * Index job_evaluations rows by LinkedIn job ID. Stored job_url values carry
 * title slugs (`/jobs/view/<slug>-<id>`) while the extension only has bare
 * numeric IDs, so matching must key on the extracted ID — the same keying the
 * scrape pipeline uses for dedup — not URL string equality. Non-LinkedIn rows
 * (no extractable ID) are skipped.
 */
export function buildJobIdIndex<T extends { job_url: string }>(
  rows: T[]
): Map<string, T> {
  const index = new Map<string, T>();
  for (const row of rows) {
    const id = extractJobId(row.job_url);
    if (id) index.set(id, row);
  }
  return index;
}

/**
 * Load ALL of the user's evaluations indexed by LinkedIn job ID. Pages at
 * 1000 rows like the pipeline dedup does — PostgREST silently caps unranged
 * selects at 1000, which would make jobs beyond the cap look unevaluated.
 */
export async function fetchEvalIndexByJobId(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<Map<string, EvalRow>> {
  const rows: EvalRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("job_evaluations")
      .select("id, job_url, total_score, fit_category, eval_summary, skipped")
      .eq("user_id", userId)
      // Unordered .range() pagination has no stability guarantee — rows could
      // be skipped or duplicated across page boundaries under concurrent writes.
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`job_evaluations page fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return buildJobIdIndex(rows);
}

/** Canonical slug-free job URL for a LinkedIn job ID. */
export function jobUrlForId(jobId: string): string {
  return `https://www.linkedin.com/jobs/view/${jobId}`;
}
