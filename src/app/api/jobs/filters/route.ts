import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch distinct values for filter dropdowns
  const [companiesRes, locationsRes, searchesRes, versionsRes] = await Promise.all([
    supabase
      .from("job_evaluations")
      .select("company")
      .eq("user_id", user.id)
      .eq("skipped", false)
      .eq("archived", false)
      .order("company"),
    supabase
      .from("job_evaluations")
      .select("location")
      .eq("user_id", user.id)
      .eq("skipped", false)
      .eq("archived", false)
      .not("location", "is", null)
      .order("location"),
    supabase
      .from("job_evaluations")
      .select("search_query")
      .eq("user_id", user.id)
      .eq("skipped", false)
      .eq("archived", false)
      .not("search_query", "is", null)
      .order("search_query"),
    supabase
      .from("job_evaluations")
      .select("prompt_version")
      .eq("user_id", user.id)
      .eq("skipped", false)
      .eq("archived", false)
      .not("prompt_version", "is", null)
      .order("prompt_version"),
  ]);

  const unique = (arr: any[], key: string): string[] => {
    const set = new Set<string>();
    for (const item of arr || []) {
      if (item[key]) set.add(String(item[key]));
    }
    return Array.from(set).sort();
  };

  return NextResponse.json({
    companies: unique(companiesRes.data || [], "company"),
    locations: unique(locationsRes.data || [], "location"),
    searches: unique(searchesRes.data || [], "search_query"),
    promptVersions: unique(versionsRes.data || [], "prompt_version"),
  });
}
