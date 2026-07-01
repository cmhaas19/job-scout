import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { dbError } from "@/lib/api-response";

export async function GET() {
  const gate = await requireApiAdmin();
  if (gate instanceof Response) return gate;
  const { supabase } = gate;

  const { data, error } = await supabase
    .from("system_config")
    .select("*")
    .order("key");

  if (error) return dbError("admin.config.list", error, "Failed to load config");

  return NextResponse.json(data || []);
}
