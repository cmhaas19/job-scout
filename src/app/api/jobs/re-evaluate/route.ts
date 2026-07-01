import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireApiUser } from "@/lib/api-auth";
import { apiError } from "@/lib/api-response";
import { parseBody, reEvaluateSchema } from "@/lib/validation";
import { evaluateJob } from "@/lib/evaluator";
import { getConfigNumber } from "@/lib/config";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  const { user } = gate;

  const parsed = await parseBody(request, reEvaluateSchema);
  if ("error" in parsed) return parsed.error;
  const { jobIds } = parsed.data;

  // Service client: the evaluation loop below runs in a detached background
  // task after the SSE response starts, so it can't rely on the request-scoped
  // cookie session. Ownership is enforced by the explicit user_id filters.
  const serviceClient = await createServiceClient();

  // Get user's resume
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("resume_text")
    .eq("id", user.id)
    .single();

  if (!profile?.resume_text) {
    return apiError("No resume uploaded. Upload a resume before re-evaluating.", 400);
  }
  // Capture as non-null so the background closure below keeps the narrowed type.
  const resumeText = profile.resume_text;

  // Get the jobs (scoped to this user)
  const { data: jobs } = await serviceClient
    .from("job_evaluations")
    .select("id, company, position, description")
    .eq("user_id", user.id)
    .in("id", jobIds);

  if (!jobs || jobs.length === 0) {
    return apiError("No matching jobs found", 404);
  }

  // Stream progress via SSE
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  function sendEvent(type: string, data: any) {
    const payload = JSON.stringify({ type, ...data });
    writer.write(encoder.encode(`data: ${payload}\n\n`));
  }

  (async () => {
    let evaluated = 0;
    let failed = 0;
    const concurrency = (await getConfigNumber("eval_concurrency")) ?? 5;

    // Split out jobs without descriptions
    const evalJobs = jobs.filter((job) => {
      if (!job.description) {
        sendEvent("log", { message: `  Skipping ${job.company} — ${job.position} (no description)` });
        failed++;
        return false;
      }
      return true;
    });

    sendEvent("log", { message: `Re-evaluating ${evalJobs.length} job(s) with concurrency ${concurrency}...` });

    for (let i = 0; i < evalJobs.length; i += concurrency) {
      const batch = evalJobs.slice(i, i + concurrency);
      const batchNum = Math.floor(i / concurrency) + 1;
      sendEvent("log", { message: `Batch ${batchNum}: evaluating ${batch.length} jobs...` });

      const results = await Promise.all(
        batch.map(async (job) => {
          try {
            const result = await evaluateJob(
              user.id,
              resumeText,
              job.company,
              job.position,
              job.description! // evalJobs filtered out null descriptions above
            );

            if (result) {
              await serviceClient
                .from("job_evaluations")
                .update({
                  fit_category: result.fit_category,
                  total_score: result.total_score,
                  score_details: result.scores,
                  eval_summary: result.summary,
                  strengths: result.strengths,
                  gaps: result.gaps,
                  prompt_version: result.prompt_version,
                  skipped: false,
                  skip_reason: null,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", job.id);

              sendEvent("log", {
                message: `  ✓ ${job.company}: ${result.fit_category} (${result.total_score}) — prompt v${result.prompt_version}`,
              });
              return true;
            } else {
              sendEvent("log", { message: `  ✗ ${job.company}: evaluation returned null` });
              return false;
            }
          } catch (err: any) {
            sendEvent("log", { message: `  ✗ ${job.company}: ${err.message}` });
            return false;
          }
        })
      );

      for (const ok of results) {
        if (ok) evaluated++;
        else failed++;
      }
    }

    sendEvent("log", {
      message: `Re-evaluation complete! ${evaluated} succeeded, ${failed} failed.`,
    });
    sendEvent("complete", { evaluated, failed });
    writer.close();
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
