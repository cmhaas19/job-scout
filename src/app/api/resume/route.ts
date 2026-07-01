import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { dbError, serverError } from "@/lib/api-response";
import { parseBody, emailDigestSchema } from "@/lib/validation";

export async function GET() {
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  const { supabase, user } = gate;

  const { data: profile } = await supabase
    .from("profiles")
    .select("resume_text, resume_uploaded_at, email_digest_enabled")
    .eq("id", user.id)
    .single();

  return NextResponse.json({
    resumeText: profile?.resume_text || null,
    uploadedAt: profile?.resume_uploaded_at || null,
    emailDigestEnabled: profile?.email_digest_enabled ?? true,
  });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  const { supabase, user } = gate;

  try {
    const parsed = await parseBody(request, emailDigestSchema);
    if ("error" in parsed) return parsed.error;

    const { error } = await supabase
      .from("profiles")
      .update({ email_digest_enabled: parsed.data.emailDigestEnabled })
      .eq("id", user.id);

    if (error) return dbError("resume.patch", error, "Failed to update settings");

    return NextResponse.json({ emailDigestEnabled: parsed.data.emailDigestEnabled });
  } catch (err) {
    return serverError("resume.patch", err);
  }
}
