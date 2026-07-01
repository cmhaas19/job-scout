/**
 * Minimal structured logger. Emits one JSON line per event so Vercel's log
 * drain (and local `next dev`) can index by level/scope instead of parsing
 * ad-hoc `[scope] message` strings. Dependency-free on purpose.
 */
type Level = "debug" | "info" | "warn" | "error";

type Meta = Record<string, unknown>;

function emit(level: Level, scope: string, msg: string, meta?: Meta): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    scope,
    msg,
    ...meta,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (scope: string, msg: string, meta?: Meta) => emit("debug", scope, msg, meta),
  info: (scope: string, msg: string, meta?: Meta) => emit("info", scope, msg, meta),
  warn: (scope: string, msg: string, meta?: Meta) => emit("warn", scope, msg, meta),
  error: (scope: string, msg: string, meta?: Meta) => emit("error", scope, msg, meta),
};
