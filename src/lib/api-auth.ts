import { createHash } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api-response";
import { logger } from "@/lib/logger";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type SupabaseServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

export interface UserContext {
  supabase: SupabaseServerClient;
  user: User;
}

export interface AdminContext extends UserContext {
  profile: { role: string };
}

/**
 * Guard for API route handlers. Returns the authenticated context, or a 401
 * NextResponse the caller should return directly:
 *
 *   const gate = await requireApiUser();
 *   if (gate instanceof NextResponse) return gate;
 *   const { supabase, user } = gate;
 *
 * This replaces the auth boilerplate copy-pasted across every route. Note the
 * `src/lib/auth.ts` helpers redirect() and are for page components, not routes.
 */
export async function requireApiUser(): Promise<UserContext | Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return apiError("Unauthorized", 401);
  return { supabase, user };
}

/** As requireApiUser, but also requires the profile role to be `admin` (403 otherwise). */
export async function requireApiAdmin(): Promise<AdminContext | Response> {
  const gate = await requireApiUser();
  if (gate instanceof Response) return gate;

  const { supabase, user } = gate;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") return apiError("Forbidden", 403);
  return { supabase, user, profile };
}

export interface ApiKeyContext {
  supabase: SupabaseServiceClient;
  userId: string;
}

/** Keys look like `jsk_` + 32 random bytes base64url-encoded (43 chars). */
export const API_KEY_PATTERN = /^jsk_[A-Za-z0-9_-]{40,}$/;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Guard for extension API routes authenticated with a personal API key
 * (`Authorization: Bearer jsk_...`) instead of a cookie session. The key's
 * SHA-256 is looked up on profiles.api_key_hash — an indexed equality match on
 * hash output, so no timingSafeEqual is needed.
 *
 * The returned client is the SERVICE ROLE client (RLS cannot apply before the
 * key identifies the user), so every downstream query MUST filter by
 * `.eq("user_id", userId)` explicitly — RLS will not save you here.
 */
export async function requireApiKeyUser(
  request: Request
): Promise<ApiKeyContext | Response> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return apiError("Unauthorized", 401);

  const key = auth.slice("Bearer ".length);
  if (!API_KEY_PATTERN.test(key)) return apiError("Unauthorized", 401);

  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("api_key_hash", hashApiKey(key))
    .maybeSingle();

  if (error) {
    // A DB outage is not an auth verdict — returning 401 here would make the
    // extension tell users their key is invalid and send them off to
    // regenerate a working key.
    logger.error("api-auth.key", "api key lookup failed", { error: error.message });
    return apiError("Job Scout is temporarily unavailable — try again shortly", 503);
  }

  if (!data) return apiError("Unauthorized", 401);
  return { supabase, userId: data.id };
}
