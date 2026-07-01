import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";
import { getConfigNumber, getConfigString } from "@/lib/config";

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

export async function evaluateJob(
  userId: string,
  resumeText: string,
  company: string,
  position: string,
  jobDescription: string
): Promise<EvalResult | null> {
  const model = await getConfigString("eval_model");
  const systemPrompt = await buildSystemPrompt(userId);
  const promptVersion = await getPromptVersion();

  const client = new Anthropic();

  const userMessage = `CANDIDATE RESUME:
${resumeText}

---

JOB POSTING: ${company} — ${position}

${jobDescription}`;

  const response = await client.messages.create({
    model: model || "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;

  const result = parseEvalResponse(textBlock.text);
  if (!result) return null;

  return { ...result, prompt_version: promptVersion };
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
