import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { dbError, serverError } from "@/lib/api-response";
import { parseBody, configValueSchema } from "@/lib/validation";
import { logger } from "@/lib/logger";
import type { Json } from "@/lib/database.types";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const gate = await requireApiAdmin();
  if (gate instanceof Response) return gate;
  const { supabase, user } = gate;

  try {
    const parsed = await parseBody(request, configValueSchema);
    if ("error" in parsed) return parsed.error;
    // Config values are arbitrary JSON; the column type is Json.
    const value = parsed.data.value as Json;

    // Get old value for audit
    const { data: existing } = await supabase
      .from("system_config")
      .select("value")
      .eq("key", key)
      .single();

    const { error } = await supabase
      .from("system_config")
      .update({
        value,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      })
      .eq("key", key);

    if (error) return dbError("admin.config.update", error, "Failed to update config");

    const { error: auditError } = await supabase.from("config_audit_log").insert({
      config_key: key,
      old_value: existing?.value ?? null,
      new_value: value,
      changed_by: user.id,
    });

    // Audit failure shouldn't fail the request, but must not be silent.
    if (auditError) {
      logger.warn("admin.config.update", "audit log insert failed", {
        key,
        error: auditError.message,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return serverError("admin.config.update", err);
  }
}
