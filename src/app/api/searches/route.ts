import { NextRequest, NextResponse } from "next/server";
import { getConfigNumber } from "@/lib/config";
import { requireApiUser } from "@/lib/api-auth";
import { apiError, dbError, serverError } from "@/lib/api-response";
import { parseBody, savedSearchSchema } from "@/lib/validation";

export async function GET() {
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  const { supabase, user } = gate;

  const { data, error } = await supabase
    .from("saved_searches")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return dbError("searches.list", error, "Failed to load searches");

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  const { supabase, user } = gate;

  try {
    // Enforce the per-user search limit
    const maxSearches = (await getConfigNumber("max_searches_per_user")) ?? 10;
    const { count } = await supabase
      .from("saved_searches")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);

    if ((count ?? 0) >= maxSearches) {
      return apiError(`Maximum ${maxSearches} searches allowed`, 400);
    }

    const parsed = await parseBody(request, savedSearchSchema);
    if ("error" in parsed) return parsed.error;
    const body = parsed.data;

    const { data, error } = await supabase
      .from("saved_searches")
      .insert({
        user_id: user.id,
        name: body.name,
        keyword: body.keyword,
        location: body.location || null,
        date_since_posted: body.date_since_posted,
        job_type: body.job_type || null,
        remote_filter: body.remote_filter || null,
        experience_level: body.experience_level,
        result_limit: body.result_limit,
        sort_by: body.sort_by,
        is_active: body.is_active,
      })
      .select()
      .single();

    if (error) return dbError("searches.create", error, "Failed to create search");

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return serverError("searches.create", err);
  }
}
