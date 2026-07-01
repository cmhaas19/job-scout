import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, requireApiAdmin } from "@/lib/api-auth";
import { apiError, dbError, serverError } from "@/lib/api-response";
import { parseBody, promptUpdateSchema } from "@/lib/validation";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  // Prompts are readable by any authenticated user (RLS allows it).
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  const { supabase } = gate;

  const { data: prompt } = await supabase
    .from("system_prompts")
    .select("*")
    .eq("slug", slug)
    .single();

  if (!prompt) return apiError("Prompt not found", 404);

  const { data: versions } = await supabase
    .from("prompt_versions")
    .select("*")
    .eq("prompt_id", prompt.id)
    .order("version", { ascending: false });

  return NextResponse.json({ ...prompt, versions: versions || [] });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const gate = await requireApiAdmin();
  if (gate instanceof Response) return gate;
  const { supabase, user } = gate;

  try {
    const parsed = await parseBody(request, promptUpdateSchema);
    if ("error" in parsed) return parsed.error;
    const { content } = parsed.data;

    const { data: prompt } = await supabase
      .from("system_prompts")
      .select("*")
      .eq("slug", slug)
      .single();

    if (!prompt) return apiError("Prompt not found", 404);

    // Get latest version number
    const { data: latestVersion } = await supabase
      .from("prompt_versions")
      .select("version")
      .eq("prompt_id", prompt.id)
      .order("version", { ascending: false })
      .limit(1)
      .single();

    const nextVersion = (latestVersion?.version || 0) + 1;

    // Save version
    await supabase.from("prompt_versions").insert({
      prompt_id: prompt.id,
      version: nextVersion,
      content,
      created_by: user.id,
    });

    // Update prompt
    const { error } = await supabase
      .from("system_prompts")
      .update({
        content,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      })
      .eq("slug", slug);

    if (error) return dbError("admin.prompts.update", error, "Failed to update prompt");

    return NextResponse.json({ success: true, version: nextVersion });
  } catch (err) {
    return serverError("admin.prompts.update", err);
  }
}
