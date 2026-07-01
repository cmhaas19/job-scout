import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { apiError, dbError, serverError } from "@/lib/api-response";

// Resumes are plain text (.md/.txt). Cap the upload so a huge file can't be
// read into memory or stored on the profile row.
const MAX_RESUME_BYTES = 512 * 1024; // 512 KB

export async function POST(request: NextRequest) {
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  const { supabase, user } = gate;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return apiError("No file provided", 400);
    }

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !["md", "txt"].includes(ext)) {
      return apiError("Only .md and .txt files are accepted", 400);
    }

    if (file.size > MAX_RESUME_BYTES) {
      return apiError("Resume is too large (max 512 KB)", 413);
    }

    const text = await file.text();
    const filePath = `${user.id}/resume.${ext}`;

    // Upload to storage (upsert)
    const { error: uploadError } = await supabase.storage
      .from("resumes")
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      return dbError("resume.upload.storage", uploadError, "Failed to upload file");
    }

    // Update profile with resume text
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        resume_text: text,
        resume_uploaded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (updateError) {
      return dbError("resume.upload.profile", updateError, "Failed to update profile");
    }

    return NextResponse.json({ success: true, resumeText: text });
  } catch (err) {
    return serverError("resume.upload", err);
  }
}
