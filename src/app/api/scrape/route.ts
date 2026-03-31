import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getConfigNumber } from "@/lib/config";
import { runPipeline } from "@/lib/scraper/pipeline";
import { sendDigestEmail } from "@/lib/email";

export const maxDuration = 300; // 5 minutes for Vercel

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit check
  const maxRefreshes = (await getConfigNumber("max_refreshes_per_hour")) ?? 2;
  const serviceClient = await createServiceClient();

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await serviceClient
    .from("run_logs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("trigger_type", "on_demand")
    .gte("started_at", oneHourAgo);

  if ((count ?? 0) >= maxRefreshes) {
    return NextResponse.json(
      {
        error: `Rate limit exceeded. Maximum ${maxRefreshes} on-demand scrapes per hour. Try again later.`,
      },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const searchId = body.searchId || null;

  // Create run log
  const { data: runLog } = await serviceClient
    .from("run_logs")
    .insert({
      user_id: user.id,
      trigger_type: "on_demand",
      search_id: searchId,
      status: "running",
      started_at: new Date().toISOString(),
      stats: { phase: "starting" },
    })
    .select()
    .single();

  if (!runLog) {
    return NextResponse.json(
      { error: "Failed to create run log" },
      { status: 500 }
    );
  }

  // Stream progress via SSE
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  function sendEvent(type: string, data: any) {
    const payload = JSON.stringify({ type, ...data });
    writer.write(encoder.encode(`data: ${payload}\n\n`));
  }

  // Run pipeline in the background, writing events to the stream
  (async () => {
    try {
      const stats = await runPipeline(
        user.id,
        searchId ? [searchId] : undefined,
        runLog.id,
        (msg: string) => {
          sendEvent("log", { message: msg });
        }
      );

      await serviceClient
        .from("run_logs")
        .update({
          status: stats.phase === "failed" ? "failed" : "completed",
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - new Date(runLog.started_at).getTime(),
          stats,
        })
        .eq("id", runLog.id);

      sendEvent("complete", { stats });

      try {
        await sendDigestEmail(user.id, runLog.started_at, "on_demand");
        sendEvent("digest", { sent: true });
      } catch (_) {
        sendEvent("digest", { sent: false });
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

      sendEvent("error", { message: err.message });
    } finally {
      writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
