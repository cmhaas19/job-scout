import { NextRequest, NextResponse } from "next/server";
import { requireApiKeyUser } from "@/lib/api-auth";
import { serverError } from "@/lib/api-response";
import { parseBody, extensionLookupSchema } from "@/lib/validation";
import { fetchEvalIndexByJobId } from "@/lib/extension-lookup";

// Returns the user's cached evaluations for a list of LinkedIn job IDs, plus
// which IDs have no row yet. Skipped/unevaluated rows still count as hits so
// the extension never re-submits known-bad jobs.

export async function POST(request: NextRequest) {
  const gate = await requireApiKeyUser(request);
  if (gate instanceof Response) return gate;
  // Service-role client (key auth happens before RLS can apply): every query
  // below must filter by user_id explicitly.
  const { supabase, userId } = gate;

  try {
    const parsed = await parseBody(request, extensionLookupSchema);
    if ("error" in parsed) return parsed.error;
    const { jobIds } = parsed.data;

    const byJobId = await fetchEvalIndexByJobId(supabase, userId);

    const results = [];
    const missing = [];
    for (const jobId of jobIds) {
      const row = byJobId.get(jobId);
      if (!row) {
        missing.push(jobId);
        continue;
      }
      results.push({
        jobId,
        total_score: row.total_score,
        fit_category: row.fit_category,
        summary: row.eval_summary,
        skipped: row.skipped,
      });
    }

    return NextResponse.json({ results, missing });
  } catch (err) {
    return serverError("extension.lookup", err);
  }
}
