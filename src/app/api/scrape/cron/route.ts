import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runPipeline } from "@/lib/scraper/pipeline";

export const maxDuration = 300;

function isAuthorized(request: NextRequest): boolean {
  // Vercel Cron sends the secret as Authorization: Bearer <CRON_SECRET>
  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) return true;

  return false;
}

// Vercel Cron sends GET requests
export async function GET(request: NextRequest) {
  return handleCron(request);
}

// Also support POST for manual triggers
export async function POST(request: NextRequest) {
  return handleCron(request);
}

async function handleCron(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();

  // Find all users with active searches and resume
  const { data: users } = await supabase
    .from("profiles")
    .select("id")
    .not("resume_text", "is", null);

  if (!users || users.length === 0) {
    return NextResponse.json({ message: "No users to process" });
  }

  const results: { userId: string; status: string; stats?: any }[] = [];

  for (const user of users) {
    // Check if user has active searches
    const { count } = await supabase
      .from("saved_searches")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (!count || count === 0) continue;

    // Create run log
    const { data: runLog } = await supabase
      .from("run_logs")
      .insert({
        user_id: user.id,
        trigger_type: "scheduled",
        status: "running",
        started_at: new Date().toISOString(),
        stats: { phase: "starting" },
      })
      .select()
      .single();

    try {
      const stats = await runPipeline(user.id, undefined, runLog?.id);

      await supabase
        .from("run_logs")
        .update({
          status: "completed",
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - new Date(runLog!.started_at).getTime(),
          stats,
        })
        .eq("id", runLog!.id);

      results.push({ userId: user.id, status: "completed", stats });
    } catch (err: any) {
      await supabase
        .from("run_logs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error: err.message,
        })
        .eq("id", runLog!.id);

      results.push({ userId: user.id, status: "failed" });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
