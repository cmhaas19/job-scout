import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  if (typeof body.emailDigestEnabled !== "boolean") {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ email_digest_enabled: body.emailDigestEnabled })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ emailDigestEnabled: body.emailDigestEnabled });
}
