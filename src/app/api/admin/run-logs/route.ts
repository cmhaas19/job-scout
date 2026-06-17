import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { failStaleRuns } from "@/lib/scraper/stale-runs";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const serviceClient = await createServiceClient();

  // Auto-heal orphaned runs so the list reflects reality.
  await failStaleRuns(serviceClient);

  const page = parseInt(request.nextUrl.searchParams.get("page") || "1");
  const limit = 50;
  const offset = (page - 1) * limit;

  const { data, count } = await serviceClient
    .from("run_logs")
    .select("*, profiles!inner(email)", { count: "exact" })
    .order("started_at", { ascending: false })
    .range(offset, offset + limit - 1);

  return NextResponse.json({
    logs: data || [],
    total: count || 0,
    page,
    totalPages: Math.ceil((count || 0) / limit),
  });
}
