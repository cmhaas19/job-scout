import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { failStaleRuns } from "./stale-runs";

/**
 * Fake Supabase client for run_logs. The initial select returns `runningRows`;
 * each `.update().eq().eq()` chain records its payload in `updates`.
 */
function fakeClient(runningRows: any[]) {
  const updates: any[] = [];
  const client: any = {
    updates,
    from() {
      let op: "select" | "update" = "select";
      let payload: unknown;
      const builder: any = {
        select() {
          op = "select";
          return builder;
        },
        update(p: unknown) {
          op = "update";
          payload = p;
          return builder;
        },
        eq() {
          return builder;
        },
        then(resolve: (v: unknown) => unknown) {
          if (op === "update") {
            updates.push(payload);
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          return Promise.resolve({ data: runningRows }).then(resolve);
        },
      };
      return builder;
    },
  };
  return client;
}

describe("failStaleRuns", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // STALE_RUN_THRESHOLD_MS is 3 minutes; cutoff = 12:00 - 3m = 11:57.
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 and writes nothing when there are no running rows", async () => {
    const client = fakeClient([]);
    expect(await failStaleRuns(client)).toBe(0);
    expect(client.updates).toHaveLength(0);
  });

  it("fails only rows past the heartbeat cutoff (and uses started_at as fallback)", async () => {
    const client = fakeClient([
      // stale: heartbeat 5 min ago
      { id: "stale-1", started_at: "2026-06-15T11:50:00Z", last_heartbeat_at: "2026-06-15T11:55:00Z" },
      // fresh: heartbeat 1 min ago
      { id: "fresh-1", started_at: "2026-06-15T11:30:00Z", last_heartbeat_at: "2026-06-15T11:59:00Z" },
      // stale via fallback: no heartbeat, started 10 min ago
      { id: "stale-2", started_at: "2026-06-15T11:50:00Z", last_heartbeat_at: null },
    ]);

    const count = await failStaleRuns(client);

    expect(count).toBe(2);
    expect(client.updates).toHaveLength(2);
    for (const u of client.updates) {
      expect(u.status).toBe("failed");
      expect(u.error).toMatch(/heartbeat/i);
    }
  });

  it("returns 0 when every running row is fresh", async () => {
    const client = fakeClient([
      { id: "fresh", started_at: "2026-06-15T11:58:00Z", last_heartbeat_at: "2026-06-15T11:59:30Z" },
    ]);
    expect(await failStaleRuns(client)).toBe(0);
    expect(client.updates).toHaveLength(0);
  });
});
