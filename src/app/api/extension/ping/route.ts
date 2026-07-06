import { NextRequest, NextResponse } from "next/server";
import { requireApiKeyUser } from "@/lib/api-auth";

// Connection test for the Chrome extension options page.
export async function GET(request: NextRequest) {
  const gate = await requireApiKeyUser(request);
  if (gate instanceof Response) return gate;

  return NextResponse.json({ ok: true });
}
