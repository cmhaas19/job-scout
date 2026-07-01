import { createServiceClient } from "@/lib/supabase/server";
import type { PipelineStats } from "./pipeline";

export type RunStatus = "completed" | "failed" | "cancelled";
export type ScrapeTrigger = "scheduled" | "on_demand";

export function statusFromPhase(phase: string): RunStatus {
  if (phase === "failed") return "failed";
  if (phase === "cancelled") return "cancelled";
  return "completed";
}

/** Create the `run_logs` row for a search run. Returns id + start timestamp. */
export async function createRunLog(
  userId: string,
  searchId: string,
  trigger: ScrapeTrigger
): Promise<{ runLogId: string; startedAt: string }> {
  const supabase = await createServiceClient();
  const startedAt = new Date().toISOString();
  const { data: runLog } = await supabase
    .from("run_logs")
    .insert({
      user_id: userId,
      search_id: searchId,
      trigger_type: trigger,
      status: "running",
      started_at: startedAt,
      last_heartbeat_at: startedAt,
      stats: { phase: "starting" },
    })
    .select("id")
    .single();

  if (!runLog) {
    throw new Error(`Failed to create run_logs row for search ${searchId}`);
  }
  return { runLogId: runLog.id, startedAt };
}

/**
 * Write a heartbeat + current stats to the run_logs row and report whether an
 * admin has requested cancellation. Called between batches by the Inngest
 * orchestrator so Run Logs shows live progress and cancels take effect.
 */
export async function writeRunLogProgress(
  runLogId: string,
  stats: PipelineStats
): Promise<{ cancelled: boolean }> {
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("run_logs")
    .update({ stats, last_heartbeat_at: new Date().toISOString() })
    .eq("id", runLogId)
    .select("cancel_requested")
    .single();
  return { cancelled: Boolean(data?.cancel_requested) };
}

/** Write the terminal status + final stats to the run_logs row. */
export async function finalizeRunLog(
  runLogId: string,
  startedAt: string,
  stats: PipelineStats,
  status: RunStatus,
  error?: string
): Promise<void> {
  const supabase = await createServiceClient();
  await supabase
    .from("run_logs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - new Date(startedAt).getTime(),
      stats,
      ...(error ? { error } : {}),
    })
    .eq("id", runLogId);
}
