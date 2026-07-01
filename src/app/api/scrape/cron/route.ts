import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { runPipeline } from "@/lib/scraper/pipeline";
import { failStaleRuns } from "@/lib/scraper/stale-runs";
import { sendDigestEmail } from "@/lib/email";
import { serverEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

export const maxDuration = 300;

function statusFromPhase(phase: string): "completed" | "failed" | "cancelled" {
  if (phase === "failed") return "failed";
  if (phase === "cancelled") return "cancelled";
  return "completed";
}

/** Constant-time string comparison that never throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function isAuthorized(request: NextRequest): boolean {
  // Vercel Cron sends the secret as Authorization: Bearer <CRON_SECRET>.
  // serverEnv() guarantees CRON_SECRET is a non-empty string, so a missing
  // secret can never collapse into an accidental "Bearer undefined" match.
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;
  return safeEqual(authHeader, `Bearer ${serverEnv().CRON_SECRET}`);
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

  // Sweep any runs orphaned by a previously killed function.
  await failStaleRuns(supabase);

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
        last_heartbeat_at: new Date().toISOString(),
        stats: { phase: "starting" },
      })
      .select()
      .single();

    try {
      const stats = await runPipeline(user.id, undefined, runLog?.id);
      const finalStatus = statusFromPhase(stats.phase);

      await supabase
        .from("run_logs")
        .update({
          status: finalStatus,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - new Date(runLog!.started_at).getTime(),
          stats,
        })
        .eq("id", runLog!.id);

      if (finalStatus === "completed") {
        try {
          await sendDigestEmail(user.id, runLog!.started_at, "scheduled");
        } catch (emailErr: any) {
          logger.error("cron", "digest email failed", { userId: user.id, error: emailErr?.message });
        }
      }

      results.push({ userId: user.id, status: finalStatus, stats });
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
