import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";
import { getConfigNumber, getConfigString } from "@/lib/config";
import { logger } from "@/lib/logger";

// One shared client. maxRetries covers Anthropic 429/500/529 overloads with
// SDK-native exponential backoff, so a transient overload doesn't fail a job.
// A per-request timeout bounds a single call so a stuck/overloaded request
// can't stall a whole batch step toward the serverless time limit.
const anthropic = new Anthropic({ maxRetries: 4, timeout: 60_000 });

/**
 * Everything an evaluation needs that is constant across all jobs in a run:
 * the fully-interpolated system prompt (incl. calibration), the model, and the
 * prompt version. Build once with `buildEvalContext` and reuse per job to avoid
 * re-querying Supabase (system_prompts, prompt_versions, rated jobs, config)
 * on every single job.
 */
export interface EvalContext {
  systemPrompt: string;
  model: string;
  promptVersion: number;
  resumeText: string;
}

export interface EvalResult {
  scores: {
    required_skills: number;
    years_of_experience: number;
    role_level_alignment: number;
    industry_domain_match: number;
    nice_to_have_skills: number;
    education_certs: number;
  };
  total_score: number;
  fit_category: string;
  strengths: string[];
  gaps: string[];
  summary: string;
  prompt_version: number;
}

interface RatedJob {
  company: string;
  position: string;
  total_score: number | null;
  fit_category: string | null;
  user_rating: number;
  user_notes: string | null;
}

const STAR_LABELS: Record<number, string> = {
  4: "Excellent",
  3: "Good",
  2: "Poor",
  1: "Bad",
};

async function getPromptVersion(): Promise<number> {
  const supabase = await createServiceClient();

  const { data: prompt } = await supabase
    .from("system_prompts")
    .select("id")
    .eq("slug", "evaluator")
    .single();

  if (!prompt) return 0;

  const { data: latest } = await supabase
    .from("prompt_versions")
    .select("version")
    .eq("prompt_id", prompt.id)
    .order("version", { ascending: false })
    .limit(1)
    .single();

  return latest?.version ?? 0;
}

async function buildSystemPrompt(userId: string): Promise<string> {
  const supabase = await createServiceClient();

  const { data: promptData } = await supabase
    .from("system_prompts")
    .select("content")
    .eq("slug", "evaluator")
    .single();

  if (!promptData) throw new Error("Evaluator prompt not found");

  let prompt = promptData.content;

  const minComp = await getConfigNumber("min_comp_top_end");
  const strong = (await getConfigNumber("score_threshold_strong")) ?? 85;
  const good = (await getConfigNumber("score_threshold_good")) ?? 70;
  const borderline = (await getConfigNumber("score_threshold_borderline")) ?? 60;

  prompt = prompt
    .replace(/\{\{min_comp_top_end\}\}/g, String(minComp ?? "N/A"))
    .replace(/\{\{strong_threshold\}\}/g, String(strong))
    .replace(/\{\{good_threshold\}\}/g, String(good))
    .replace(/\{\{borderline_threshold\}\}/g, String(borderline))
    .replace(/\{\{strong_threshold_minus_1\}\}/g, String(strong - 1))
    .replace(/\{\{good_threshold_minus_1\}\}/g, String(good - 1));

  const { data: ratedJobs } = await supabase
    .from("job_evaluations")
    .select(
      "company, position, total_score, fit_category, user_rating, user_notes"
    )
    .eq("user_id", userId)
    .not("user_rating", "is", null)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (ratedJobs && ratedJobs.length > 0) {
    // The `.not(user_rating, is, null)` filter guarantees user_rating is present.
    const calibrationEntries = (ratedJobs as RatedJob[])
      .map((job) => {
        const starLabel = STAR_LABELS[job.user_rating] || "Unknown";
        return `- ${job.company} — ${job.position}
  AI Score: ${job.total_score}% (${job.fit_category})
  User Rating: ${job.user_rating}/4 (${starLabel})
  User Notes: ${job.user_notes || "None"}`;
      })
      .join("\n\n");

    prompt += `

CALIBRATION FROM USER FEEDBACK:
The user has rated previous evaluations. Use these to calibrate your scoring.
Pay close attention to cases where the user's rating diverges from the AI score — this indicates the rubric alone doesn't capture the user's preferences.

${calibrationEntries}

KEY PATTERNS TO LEARN:
- Jobs rated 4 stars are what the user considers ideal — weight similar characteristics higher.
- Jobs rated 1-2 stars despite high AI scores reveal blind spots in the rubric — avoid those patterns.
- User notes explain WHY a rating was given — internalize these preferences.`;
  }

  return prompt;
}

/**
 * Build the per-run evaluation context once (system prompt + model + version).
 * Reuse the result across every job in the run via `evaluateJobWithContext`.
 */
export async function buildEvalContext(
  userId: string,
  resumeText: string
): Promise<EvalContext> {
  const [model, systemPrompt, promptVersion] = await Promise.all([
    getConfigString("eval_model"),
    buildSystemPrompt(userId),
    getPromptVersion(),
  ]);
  return {
    model: model || "claude-sonnet-4-20250514",
    systemPrompt,
    promptVersion,
    resumeText,
  };
}

/**
 * Evaluate one job using a prebuilt context. The system prompt and resume are
 * constant across the run, so both carry `cache_control` — Anthropic prompt
 * caching means only the (varying) job posting is re-processed after the first
 * call, cutting latency and input-token cost.
 */
export async function evaluateJobWithContext(
  ctx: EvalContext,
  company: string,
  position: string,
  jobDescription: string
): Promise<EvalResult | null> {
  const response = await anthropic.messages.create({
    model: ctx.model,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: ctx.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `CANDIDATE RESUME:\n${ctx.resumeText}`,
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: `---\n\nJOB POSTING: ${company} — ${position}\n\n${jobDescription}`,
          },
        ],
      },
    ],
  });

  const cacheRead = response.usage?.cache_read_input_tokens ?? 0;
  if (cacheRead > 0) {
    logger.info("evaluator", "prompt cache hit", { company, cacheRead });
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;

  const result = parseEvalResponse(textBlock.text);
  if (!result) return null;

  return { ...result, prompt_version: ctx.promptVersion };
}

/**
 * Evaluate a single job, building the context inline. Kept for callers that
 * evaluate one job in isolation (e.g. re-evaluation of a single record); the
 * batch pipeline uses `buildEvalContext` + `evaluateJobWithContext` instead.
 */
export async function evaluateJob(
  userId: string,
  resumeText: string,
  company: string,
  position: string,
  jobDescription: string
): Promise<EvalResult | null> {
  const ctx = await buildEvalContext(userId, resumeText);
  return evaluateJobWithContext(ctx, company, position, jobDescription);
}

export function parseEvalResponse(text: string): Omit<EvalResult, "prompt_version"> | null {
  let cleaned = text.trim();

  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
  }

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1) return null;

  const jsonStr = cleaned.substring(firstBrace, lastBrace + 1);

  try {
    const parsed = JSON.parse(jsonStr);
    return parsed;
  } catch {
    return null;
  }
}
