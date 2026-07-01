import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-response";
import { STALE_RUN_THRESHOLD_MS } from "@/lib/constants";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireApiAdmin();
  if (gate instanceof Response) return gate;

  const serviceClient = await createServiceClient();

  const { data: run } = await serviceClient
    .from("run_logs")
    .select("id, status, started_at, last_heartbeat_at")
    .eq("id", id)
    .single();

  if (!run) return apiError("Run not found", 404);

  if (run.status !== "running") {
    return apiError(`Run is not running (status: ${run.status})`, 400);
  }

  // Always request cancellation so a still-alive pipeline self-terminates at its
  // next checkpoint.
  const lastBeat = run.last_heartbeat_at ?? run.started_at;
  const isStale = new Date(lastBeat).getTime() < Date.now() - STALE_RUN_THRESHOLD_MS;

  if (isStale) {
    // No recent heartbeat — the function is gone. Clear the orphan immediately.
    await serviceClient
      .from("run_logs")
      .update({
        cancel_requested: true,
        status: "cancelled",
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - new Date(run.started_at).getTime(),
        error: "Cancelled (run was not responding)",
      })
      .eq("id", id);

    return NextResponse.json({ status: "cancelled", cleared: true });
  }

  // Live run — flag it and let the pipeline stop itself.
  await serviceClient
    .from("run_logs")
    .update({ cancel_requested: true })
    .eq("id", id);

  return NextResponse.json({ status: "cancel_requested", cleared: false });
}
