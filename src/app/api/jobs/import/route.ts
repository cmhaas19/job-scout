import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { normalizeJobUrl } from "@/lib/scraper/url-builder";
import { fetchJobPage } from "@/lib/scraper/parser";
import { evaluateJob } from "@/lib/evaluator";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const rawUrl = body.url;

  if (!rawUrl || typeof rawUrl !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  // Validate it looks like a LinkedIn job URL
  const normalized = normalizeJobUrl(rawUrl);
  if (!normalized.includes("linkedin.com/jobs/")) {
    return NextResponse.json(
      { error: "Please enter a valid LinkedIn job URL" },
      { status: 400 }
    );
  }

  const serviceClient = await createServiceClient();

  // Check if job already exists for this user
  const { data: existing } = await serviceClient
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
    return NextResponse.json(
      { error: "Could not fetch job details from LinkedIn. The page may be unavailable or the URL may be incorrect." },
      { status: 422 }
    );
  }

  // Load user's resume
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("resume_text")
    .eq("id", user.id)
    .single();

  if (!profile?.resume_text) {
    return NextResponse.json(
      { error: "Please upload your resume before importing jobs" },
      { status: 400 }
    );
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

  const { data: inserted, error } = await serviceClient
    .from("job_evaluations")
    .upsert(record, { onConflict: "user_id,job_url" })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ jobId: inserted.id, existing: false });
}
