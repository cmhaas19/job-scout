import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { dbError, serverError } from "@/lib/api-response";
import { parseBody, archiveSchema } from "@/lib/validation";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  const { supabase, user } = gate;

  try {
    const parsed = await parseBody(request, archiveSchema);
    if ("error" in parsed) return parsed.error;

    const { data, error } = await supabase
      .from("job_evaluations")
      .update({
        archived: parsed.data.archived,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) return dbError("jobs.archive", error, "Failed to update job");

    return NextResponse.json(data);
  } catch (err) {
    return serverError("jobs.archive", err);
  }
}
