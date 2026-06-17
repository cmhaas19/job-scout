import { STALE_RUN_THRESHOLD_MS } from "@/lib/constants";

type ServiceClient = Awaited<
  ReturnType<typeof import("@/lib/supabase/server").createServiceClient>
>;

/**
 * Marks orphaned runs as failed. A run is orphaned when it's still `running`
 * but hasn't written a heartbeat within STALE_RUN_THRESHOLD_MS — almost always
 * because its serverless function exceeded the Vercel time limit and was killed
 * before it could record a final status. Self-heals stuck rows so the UI is
 * accurate and the run can be re-run.
 */
export async function failStaleRuns(supabase: ServiceClient): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUN_THRESHOLD_MS).toISOString();

  const { data } = await supabase
    .from("run_logs")
    .select("id, started_at, last_heartbeat_at")
    .eq("status", "running");

  if (!data || data.length === 0) return 0;

  const stale = data.filter((r: { started_at: string; last_heartbeat_at: string | null }) => {
    const last = r.last_heartbeat_at ?? r.started_at;
    return last < cutoff;
  });

  if (stale.length === 0) return 0;

  const now = new Date().toISOString();
  for (const run of stale as { id: string; started_at: string }[]) {
    await supabase
      .from("run_logs")
      .update({
        status: "failed",
        finished_at: now,
        duration_ms: Date.now() - new Date(run.started_at).getTime(),
        error: "Timed out — no heartbeat (run likely exceeded the function time limit)",
      })
      .eq("id", run.id)
      .eq("status", "running");
  }

  return stale.length;
}
