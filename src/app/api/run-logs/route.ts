import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { dbError } from "@/lib/api-response";

export async function GET() {
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  const { supabase, user } = gate;

  const { data, error } = await supabase
    .from("run_logs")
    .select("*")
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(50);

  if (error) return dbError("runLogs.list", error, "Failed to load run logs");

  return NextResponse.json(data || []);
}
