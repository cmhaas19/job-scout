import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { dbError, serverError } from "@/lib/api-response";
import { parseBody, updateUserRoleSchema } from "@/lib/validation";

export async function GET() {
  const gate = await requireApiAdmin();
  if (gate instanceof Response) return gate;

  // Cross-user read: list every profile. Legitimate admin operation.
  const serviceClient = await createServiceClient();
  const { data, error } = await serviceClient
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return dbError("admin.users.list", error, "Failed to load users");

  return NextResponse.json(data || []);
}

export async function PATCH(request: NextRequest) {
  const gate = await requireApiAdmin();
  if (gate instanceof Response) return gate;

  try {
    const parsed = await parseBody(request, updateUserRoleSchema);
    if ("error" in parsed) return parsed.error;
    const { userId, role } = parsed.data;

    const serviceClient = await createServiceClient();
    const { error } = await serviceClient
      .from("profiles")
      .update({ role })
      .eq("id", userId);

    if (error) return dbError("admin.users.updateRole", error, "Failed to update role");

    return NextResponse.json({ success: true });
  } catch (err) {
    return serverError("admin.users.updateRole", err);
  }
}
