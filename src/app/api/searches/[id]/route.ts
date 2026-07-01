import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { dbError, serverError } from "@/lib/api-response";
import { parseBody, savedSearchSchema } from "@/lib/validation";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  const { supabase, user } = gate;

  try {
    const parsed = await parseBody(request, savedSearchSchema);
    if ("error" in parsed) return parsed.error;
    const body = parsed.data;

    const { data, error } = await supabase
      .from("saved_searches")
      .update({
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
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) return dbError("searches.update", error, "Failed to update search");

    return NextResponse.json(data);
  } catch (err) {
    return serverError("searches.update", err);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  const { supabase, user } = gate;

  const { error } = await supabase
    .from("saved_searches")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return dbError("searches.delete", error, "Failed to delete search");

  return NextResponse.json({ success: true });
}
