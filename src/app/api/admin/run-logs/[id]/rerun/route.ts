import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { runPipeline } from "@/lib/scraper/pipeline";
import { sendDigestEmail } from "@/lib/email";

export const maxDuration = 300;

function statusFromPhase(phase: string): "completed" | "failed" | "cancelled" {
  if (phase === "failed") return "failed";
  if (phase === "cancelled") return "cancelled";
  return "completed";
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const serviceClient = await createServiceClient();

  // Re-run inherits the source run's user + search scope.
  const { data: source } = await serviceClient
    .from("run_logs")
    .select("user_id, search_id")
    .eq("id", id)
    .single();

  if (!source) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const { data: runLog } = await serviceClient
    .from("run_logs")
    .insert({
      user_id: source.user_id,
      trigger_type: "on_demand",
      search_id: source.search_id,
      status: "running",
      started_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
      stats: { phase: "starting" },
    })
    .select()
    .single();

  if (!runLog) {
    return NextResponse.json({ error: "Failed to create run log" }, { status: 500 });
  }

  // Background task (same fire-and-forget pattern as cron); admin action, so the
  // per-user rate limit is intentionally bypassed.
  (async () => {
    try {
      const stats = await runPipeline(
        source.user_id,
        source.search_id ? [source.search_id] : undefined,
        runLog.id
      );
      const finalStatus = statusFromPhase(stats.phase);

      await serviceClient
        .from("run_logs")
        .update({
          status: finalStatus,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - new Date(runLog.started_at).getTime(),
          stats,
        })
        .eq("id", runLog.id);

      if (finalStatus === "completed") {
        try {
          await sendDigestEmail(source.user_id, runLog.started_at, "on_demand");
        } catch (_) {
          /* ignore */
        }
      }
    } catch (err: any) {
      await serviceClient
        .from("run_logs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - new Date(runLog.started_at).getTime(),
          error: err.message,
        })
        .eq("id", runLog.id);
    }
  })();

  return NextResponse.json({ runId: runLog.id, status: "running" });
}
