import { createServiceClient } from "@/lib/supabase/server";

const DEFAULTS: Record<string, unknown> = {
  blocked_publishers: ["Jobgether", "Ladders", "Dice", "RemoteHunter", "Lensa", "TopTal"],
  min_comp_top_end: 300000,
  score_threshold_strong: 85,
  score_threshold_good: 70,
  score_threshold_borderline: 60,
  eval_model: "claude-sonnet-4-20250514",
  // Claude evaluations run on their own pool and overlap description fetching,
  // so this can be well above fetch_concurrency (Anthropic handles it fine).
  eval_concurrency: 12,
  // Concurrent LinkedIn description fetches. Kept modest — this is the main
  // rate-limit/ban lever, so raise it cautiously.
  fetch_concurrency: 5,
  delay_between_fetches_ms: 1500,
  // Jobs processed per Inngest step. Each batch is a separate invocation with a
  // fresh function-timeout budget; keep it small enough that one batch's
  // fetch+eval can't approach the 300s cap, but large enough to keep the eval
  // pool saturated and minimize step-transition overhead.
  scrape_batch_size: 12,
  max_searches_per_user: 10,
  max_refreshes_per_hour: 2,
  max_results_per_search: 100,
  email_from_address: "digest@oakworks.ai",
};

export async function getConfig(key: string): Promise<unknown> {
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("system_config")
    .select("value")
    .eq("key", key)
    .single();

  if (data) return data.value;
  return DEFAULTS[key] ?? null;
}

export async function getAllConfig(): Promise<Record<string, unknown>> {
  const supabase = await createServiceClient();
  const { data } = await supabase.from("system_config").select("*");

  const config: Record<string, unknown> = { ...DEFAULTS };
  if (data) {
    for (const row of data) {
      config[row.key] = row.value;
    }
  }
  return config;
}

export async function getConfigNumber(key: string): Promise<number | null> {
  const val = await getConfig(key);
  if (val === null || val === undefined) return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

export async function getConfigString(key: string): Promise<string> {
  const val = await getConfig(key);
  return typeof val === "string" ? val : String(val);
}

export async function getConfigArray(key: string): Promise<string[]> {
  const val = await getConfig(key);
  return Array.isArray(val) ? val : [];
}
