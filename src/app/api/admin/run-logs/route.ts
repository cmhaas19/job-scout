import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { parsePagination } from "@/lib/validation";
import { failStaleRuns } from "@/lib/scraper/stale-runs";

export async function GET(request: NextRequest) {
  const gate = await requireApiAdmin();
  if (gate instanceof Response) return gate;

  const serviceClient = await createServiceClient();

  // Auto-heal orphaned runs so the list reflects reality.
  await failStaleRuns(serviceClient);

  const { page, limit, offset } = parsePagination(request.nextUrl.searchParams);

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
