import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { apiError, dbError, serverError } from "@/lib/api-response";
import { parseBody, importJobSchema } from "@/lib/validation";
import type { TablesInsert } from "@/lib/database.types";
import { normalizeJobUrl } from "@/lib/scraper/url-builder";
import { fetchJobPage } from "@/lib/scraper/parser";
import { evaluateJob } from "@/lib/evaluator";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  // RLS-scoped client: job_evaluations has own-row insert/update/select
  // policies, so we let the database enforce ownership instead of the service
  // role + a manual user_id filter.
  const { supabase, user } = gate;

  try {
    const parsed = await parseBody(request, importJobSchema);
    if ("error" in parsed) return parsed.error;

    // Validate it looks like a LinkedIn job URL
    const normalized = normalizeJobUrl(parsed.data.url);
    if (!normalized.includes("linkedin.com/jobs/")) {
      return apiError("Please enter a valid LinkedIn job URL", 400);
    }

    // Check if job already exists for this user
    const { data: existing } = await supabase
      .from("job_evaluations")
      .select("id")
      .eq("user_id", user.id)
      .eq("job_url", normalized)
      .single();

    if (existing) {
      return NextResponse.json({ jobId: existing.id, existing: true });
    }

    // Fetch the job page
    const pageData = await fetchJobPage(normalized);
    if (!pageData || !pageData.position) {
      return apiError(
        "Could not fetch job details from LinkedIn. The page may be unavailable or the URL may be incorrect.",
        422
      );
    }

    // Load user's resume
    const { data: profile } = await supabase
      .from("profiles")
      .select("resume_text")
      .eq("id", user.id)
      .single();

    if (!profile?.resume_text) {
      return apiError("Please upload your resume before importing jobs", 400);
    }

    // Evaluate
    let evalResult = null;
    if (pageData.description) {
      evalResult = await evaluateJob(
        user.id,
        profile.resume_text,
        pageData.company,
        pageData.position,
        pageData.description
      );
    }

    // Save to database
    const record: Record<string, unknown> = {
      user_id: user.id,
      job_url: normalized,
      position: pageData.position,
      company: pageData.company,
      location: pageData.location || null,
      salary: pageData.salary,
      ago_time: pageData.agoTime || null,
      date_posted: pageData.datePosted || null,
      company_logo: pageData.companyLogo,
      description: pageData.description || null,
      search_query: "Manual Import",
      skipped: false,
      archived: false,
    };

    if (evalResult) {
      record.fit_category = evalResult.fit_category;
      record.total_score = evalResult.total_score;
      record.score_details = evalResult.scores;
      record.eval_summary = evalResult.summary;
      record.strengths = evalResult.strengths;
      record.gaps = evalResult.gaps;
      record.prompt_version = evalResult.prompt_version;
    }

    const { data: inserted, error } = await supabase
      .from("job_evaluations")
      .upsert(record as TablesInsert<"job_evaluations">, { onConflict: "user_id,job_url" })
      .select("id")
      .single();

    if (error) return dbError("jobs.import", error, "Failed to save imported job");

    return NextResponse.json({ jobId: inserted.id, existing: false });
  } catch (err) {
    return serverError("jobs.import", err);
  }
}
