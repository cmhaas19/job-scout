import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { apiError, dbError, serverError } from "@/lib/api-response";
import { parseBody, promptRollbackSchema } from "@/lib/validation";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const gate = await requireApiAdmin();
  if (gate instanceof Response) return gate;
  const { supabase, user } = gate;

  try {
    const parsed = await parseBody(request, promptRollbackSchema);
    if ("error" in parsed) return parsed.error;
    const { versionId } = parsed.data;

    const { data: version } = await supabase
      .from("prompt_versions")
      .select("*")
      .eq("id", versionId)
      .single();

    if (!version) return apiError("Version not found", 404);

    // Update the prompt content to the rolled-back version
    const { error } = await supabase
      .from("system_prompts")
      .update({
        content: version.content,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      })
      .eq("slug", slug);

    if (error) return dbError("admin.prompts.rollback", error, "Failed to roll back prompt");

    // Create a new version entry for the rollback
    const { data: latestVersion } = await supabase
      .from("prompt_versions")
      .select("version")
      .eq("prompt_id", version.prompt_id)
      .order("version", { ascending: false })
      .limit(1)
      .single();

    await supabase.from("prompt_versions").insert({
      prompt_id: version.prompt_id,
      version: (latestVersion?.version || 0) + 1,
      content: version.content,
      created_by: user.id,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return serverError("admin.prompts.rollback", err);
  }
}
