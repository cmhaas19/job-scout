import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api-response";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

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
