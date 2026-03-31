import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [lastRunRes, weekJobsRes, topJobsRes] = await Promise.all([
    supabase
      .from("run_logs")
      .select("*")
      .eq("user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("job_evaluations")
      .select("fit_category")
      .eq("user_id", user.id)
      .eq("skipped", false)
      .eq("archived", false)
      .gte("created_at", oneWeekAgo),
    supabase
      .from("job_evaluations")
      .select("id, position, company, location, total_score, fit_category, date_posted, company_logo, search_query, prompt_version")
      .eq("user_id", user.id)
      .eq("skipped", false)
      .eq("archived", false)
      .eq("fit_category", "STRONG FIT")
      .gte("created_at", thirtyDaysAgo)
      .order("date_posted", { ascending: false })
      .limit(10),
  ]);

  const lastRun = lastRunRes.data;
  const weekJobs = weekJobsRes.data;
  const topJobs = topJobsRes.data;

  const fitCounts: Record<string, number> = {
    "STRONG FIT": 0,
    "GOOD FIT": 0,
    BORDERLINE: 0,
    "WEAK FIT": 0,
    unevaluated: 0,
  };

  for (const job of weekJobs || []) {
    if (job.fit_category && fitCounts[job.fit_category] !== undefined) {
      fitCounts[job.fit_category]++;
    } else {
      fitCounts.unevaluated++;
    }
  }

  const weekTotal = (weekJobs || []).length;

  return NextResponse.json({
    lastRun,
    weekTotal,
    fitCounts,
    topJobs: topJobs || [],
  });
}
