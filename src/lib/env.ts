import { z } from "zod";

/**
 * Centralized environment-variable validation.
 *
 * Two accessors so we never require server-only secrets where they aren't
 * available (e.g. the Edge middleware runtime, or the browser bundle):
 *
 *   - `publicEnv()`  — the NEXT_PUBLIC_* pair. Safe to reference anywhere;
 *                      these are inlined into the client bundle by Next.
 *   - `serverEnv()`  — server-only secrets. Never call this from client code.
 *
 * Both fail fast with a message that names the offending variable, instead of
 * surfacing a downstream `undefined` (e.g. an auth check silently comparing
 * against `"Bearer undefined"`).
 *
 * References to `process.env.NEXT_PUBLIC_*` are written as static property
 * accesses on purpose so Next can inline them at build time.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  CRON_SECRET: z.string().min(1),
  RESEND_API_KEY: z.string().min(1).optional(),
  // Set by the Vercel↔Inngest integration in production; unset locally where
  // the inngest-cli dev server handles signing.
  INNGEST_EVENT_KEY: z.string().min(1).optional(),
  INNGEST_SIGNING_KEY: z.string().min(1).optional(),
});

type PublicEnv = z.infer<typeof publicSchema>;
type ServerEnv = z.infer<typeof serverSchema>;

function fail(context: string, error: z.ZodError): never {
  const vars = error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(
    `Invalid or missing ${context} environment variable(s): ${vars}. ` +
      `Check your .env.local (see .env.local.example).`
  );
}

let publicCache: PublicEnv | null = null;
export function publicEnv(): PublicEnv {
  if (publicCache) return publicCache;
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!parsed.success) fail("public", parsed.error);
  publicCache = parsed.data;
  return publicCache;
}

let serverCache: ServerEnv | null = null;
export function serverEnv(): ServerEnv {
  if (serverCache) return serverCache;
  const parsed = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
  });
  if (!parsed.success) fail("server", parsed.error);
  serverCache = parsed.data;
  return serverCache;
}
