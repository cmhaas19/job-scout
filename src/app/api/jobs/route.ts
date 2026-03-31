import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = request.nextUrl;
  const company = url.searchParams.get("company");
  const location = url.searchParams.get("location");
  const searchQuery = url.searchParams.get("searchQuery");
  const promptVersion = url.searchParams.get("promptVersion");
  const fitCategory = url.searchParams.get("fitCategory");
  const postedWithin = url.searchParams.get("postedWithin");
  const skipped = url.searchParams.get("skipped");
  const showArchived = url.searchParams.get("showArchived");
  const sortBy = url.searchParams.get("sortBy") || "total_score";
  const sortOrder = url.searchParams.get("sortOrder") || "desc";
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const offset = (page - 1) * limit;

  let query = supabase
    .from("job_evaluations")
    .select("id, position, company, location, salary, fit_category, total_score, ago_time, date_posted, user_rating, search_query, job_url, company_logo, skipped, archived, created_at, prompt_version", { count: "exact" })
    .eq("user_id", user.id);

  // Default: hide skipped
  if (skipped === "true") {
    query = query.eq("skipped", true);
  } else {
    query = query.eq("skipped", false);
  }

  // Default: hide archived unless explicitly requested
  if (showArchived !== "true") {
    query = query.eq("archived", false);
  }

  if (company) {
    query = query.eq("company", company);
  }

  if (location) {
    query = query.eq("location", location);
  }

  if (searchQuery) {
    query = query.eq("search_query", searchQuery);
  }

  if (fitCategory) {
    query = query.eq("fit_category", fitCategory);
  }

  if (promptVersion) {
    query = query.eq("prompt_version", parseInt(promptVersion));
  }

  if (postedWithin) {
    const now = new Date();
    let cutoff: Date | null = null;

    switch (postedWithin) {
      case "1d":
        cutoff = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
        break;
      case "3d":
        cutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        break;
      case "1w":
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
    }

    if (cutoff) {
      query = query.gte("date_posted", cutoff.toISOString());
    }
  }

  // Sort
  const ascending = sortOrder === "asc";
  query = query.order(sortBy, { ascending, nullsFirst: false });

  // Paginate
  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    jobs: data || [],
    total: count || 0,
    page,
    totalPages: Math.ceil((count || 0) / limit),
  });
}
