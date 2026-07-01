import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

/** Standard JSON error response. */
export function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Log an unexpected server-side error in full, but return a generic 500 to the
 * client so raw Supabase/driver messages never leak. Use in a route's catch.
 */
export function serverError(scope: string, err: unknown) {
  logger.error(scope, "unhandled route error", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return apiError("Internal server error", 500);
}

/**
 * Log a (non-thrown) database/query error and return a generic client message.
 * Keeps raw Postgrest/driver detail out of the HTTP response.
 */
export function dbError(
  scope: string,
  error: { message: string } | null,
  clientMessage = "Request failed",
  status = 500
) {
  logger.error(scope, "database error", { error: error?.message });
  return apiError(clientMessage, status);
}
