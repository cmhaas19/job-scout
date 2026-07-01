import { z } from "zod";
import { apiError } from "@/lib/api-response";

/**
 * Parse and validate a JSON request body against a schema.
 * Returns the typed data, or a 400 Response the route should return directly:
 *
 *   const parsed = await parseBody(request, savedSearchSchema);
 *   if ("error" in parsed) return parsed.error;
 *   const body = parsed.data;
 *
 * Also catches malformed JSON (which otherwise throws and 500s the route).
 */
export async function parseBody<T>(
  request: Request,
  schema: z.ZodType<T>
): Promise<{ data: T } | { error: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { error: apiError("Invalid JSON body", 400) };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return { error: apiError(msg, 400) };
  }
  return { data: parsed.data };
}

/** Clamp untrusted page/limit query params to sane bounds. */
export function parsePagination(
  searchParams: URLSearchParams,
  { defaultLimit = 50, maxLimit = 100 }: { defaultLimit?: number; maxLimit?: number } = {}
): { page: number; limit: number; offset: number } {
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const rawLimit = parseInt(searchParams.get("limit") || String(defaultLimit), 10) || defaultLimit;
  const limit = Math.min(maxLimit, Math.max(1, rawLimit));
  return { page, limit, offset: (page - 1) * limit };
}

// ── Route body schemas ──────────────────────────────────────────────────────

export const savedSearchSchema = z.object({
  name: z.string().min(1, "name is required"),
  keyword: z.string().min(1, "keyword is required"),
  location: z.string().nullish(),
  date_since_posted: z.string().default("past week"),
  job_type: z.string().nullish(),
  remote_filter: z.string().nullish(),
  experience_level: z.array(z.string()).default([]),
  result_limit: z.number().int().min(1).max(1000).default(100),
  sort_by: z.string().default("relevant"),
  is_active: z.boolean().default(true),
});
export type SavedSearchInput = z.infer<typeof savedSearchSchema>;

export const rateSchema = z.object({
  user_rating: z.number().int().min(1).max(4).nullable(),
  user_notes: z.string().nullish(),
});

// Config values are polymorphic JSON (arrays, numbers, strings). We only
// guarantee the envelope shape here; the admin UI owns per-key semantics.
export const configValueSchema = z.object({ value: z.unknown() });

export const importJobSchema = z.object({
  url: z.string().min(1, "url is required"),
});

export const reEvaluateSchema = z.object({
  jobIds: z.array(z.string()).min(1, "at least one job id is required"),
});

export const updateUserRoleSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  role: z.enum(["member", "admin"]),
});

export const promptUpdateSchema = z.object({
  content: z.string().min(1, "content is required"),
});

export const promptRollbackSchema = z.object({
  versionId: z.string().min(1, "versionId is required"),
});

export const archiveSchema = z.object({
  archived: z.boolean(),
});

export const emailDigestSchema = z.object({
  emailDigestEnabled: z.boolean(),
});
