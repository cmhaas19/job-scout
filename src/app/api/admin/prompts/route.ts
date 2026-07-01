import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { dbError } from "@/lib/api-response";

export async function GET() {
  const gate = await requireApiAdmin();
  if (gate instanceof Response) return gate;
  const { supabase } = gate;

  const { data, error } = await supabase.from("system_prompts").select("*");

  if (error) return dbError("admin.prompts.list", error, "Failed to load prompts");

  return NextResponse.json(data || []);
}
