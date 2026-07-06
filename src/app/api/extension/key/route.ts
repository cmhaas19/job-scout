import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiUser, hashApiKey } from "@/lib/api-auth";
import { dbError, serverError } from "@/lib/api-response";

// Session-authed (cookie) management of the Chrome extension API key. The
// plaintext key is returned exactly once from POST; only its hash is stored.

export async function GET() {
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  const { supabase, user } = gate;

  const { data, error } = await supabase
    .from("profiles")
    .select("api_key_hash, api_key_created_at")
    .eq("id", user.id)
    .single();

  if (error) return dbError("extension.key.get", error);

  return NextResponse.json({
    hasKey: !!data.api_key_hash,
    createdAt: data.api_key_created_at,
  });
}

export async function POST() {
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  const { supabase, user } = gate;

  try {
    const apiKey = `jsk_${randomBytes(32).toString("base64url")}`;

    const { error } = await supabase
      .from("profiles")
      .update({
        api_key_hash: hashApiKey(apiKey),
        api_key_created_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (error) return dbError("extension.key.create", error, "Failed to generate API key");

    return NextResponse.json({ apiKey });
  } catch (err) {
    return serverError("extension.key.create", err);
  }
}

export async function DELETE() {
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;
  const { supabase, user } = gate;

  const { error } = await supabase
    .from("profiles")
    .update({ api_key_hash: null, api_key_created_at: null })
    .eq("id", user.id);

  if (error) return dbError("extension.key.delete", error, "Failed to revoke API key");

  return NextResponse.json({ revoked: true });
}
