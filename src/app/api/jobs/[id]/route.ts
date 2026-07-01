import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { apiError } from "@/lib/api-response";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  const { supabase, user } = gate;

  const { data, error } = await supabase
    .from("job_evaluations")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !data) return apiError("Job not found", 404);

  return NextResponse.json(data);
}
