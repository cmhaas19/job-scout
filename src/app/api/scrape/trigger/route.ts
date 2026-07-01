import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireApiUser } from "@/lib/api-auth";
import { apiError, serverError } from "@/lib/api-response";
import { getConfigNumber } from "@/lib/config";
import { failStaleRuns } from "@/lib/scraper/stale-runs";
import { inngest } from "@/lib/inngest/client";

/**
 * Manual scrape trigger (Run All / per-search play button).
 *
 * Unlike the old inline SSE path, this just enqueues an Inngest
 * `scrape/user.requested` event and returns immediately. Inngest then fans out
 * one invocation per search (each with its own timeout budget) and sends the
 * digest — the same path the daily cron uses. Progress is tracked via Run Logs.
 *
 * Body: `{ searchId?: string }` — a single search, or omit to run all active.
 */
export async function POST(request: NextRequest) {
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  const { user } = gate;

  try {
    const body = await request.json().catch(() => ({}));
    const searchId: string | null = body?.searchId ?? null;

    const supabase = await createServiceClient();

    // Sweep any runs orphaned by a previously killed function.
    await failStaleRuns(supabase);

    // Rate limit: enforce a cooldown between manual triggers so a "Run All"
    // batch (now N per-search runs) counts as one action. Cooldown derives from
    // max_refreshes_per_hour, e.g. 2/hr → one manual run every 30 min.
    const maxRefreshes = (await getConfigNumber("max_refreshes_per_hour")) ?? 2;
    const cooldownMs = Math.floor(3_600_000 / Math.max(1, maxRefreshes));
    const { data: recent } = await supabase
      .from("run_logs")
      .select("started_at")
      .eq("user_id", user.id)
      .eq("trigger_type", "on_demand")
      .order("started_at", { ascending: false })
      .limit(1);
    const last = recent?.[0]?.started_at;
    if (last) {
      const elapsed = Date.now() - new Date(last).getTime();
      if (elapsed < cooldownMs) {
        const waitMin = Math.ceil((cooldownMs - elapsed) / 60_000);
        return apiError(
          `Rate limit exceeded. Please wait ${waitMin} more minute(s) before another manual run.`,
          429
        );
      }
    }

    // Resolve the searches to run — validates ownership and gives us a count.
    let searchIds: string[];
    if (searchId) {
      const { data: search } = await supabase
        .from("saved_searches")
        .select("id")
        .eq("id", searchId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!search) return apiError("Search not found", 404);
      searchIds = [searchId];
    } else {
      const { data } = await supabase
        .from("saved_searches")
        .select("id")
        .eq("user_id", user.id)
        .eq("is_active", true);
      searchIds = (data ?? []).map((s) => s.id);
      if (searchIds.length === 0) {
        return apiError("No active searches to run", 400);
      }
    }

    await inngest.send({
      name: "scrape/user.requested",
      data: { userId: user.id, searchIds, trigger: "on_demand" },
    });

    return NextResponse.json({ queued: true, count: searchIds.length });
  } catch (err) {
    return serverError("scrape.trigger", err);
  }
}
