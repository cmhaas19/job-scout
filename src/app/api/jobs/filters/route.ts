import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { dbError } from "@/lib/api-response";

export async function GET() {
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  const { supabase } = gate;

  // Distinct values come from a Postgres function so dropdowns stay correct
  // regardless of row count (a plain .select() caps at 1000 rows and truncated
  // the newest prompt versions). RLS + auth.uid() scope it to the caller.
  const { data, error } = await supabase.rpc("get_job_filter_options");
  if (error) return dbError("jobs.filters", error, "Failed to load filters");

  return NextResponse.json(
    data ?? { companies: [], locations: [], searches: [], promptVersions: [] }
  );
}
