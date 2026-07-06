import { describe, it, expect, vi } from "vitest";
import {
  buildJobIdIndex,
  fetchEvalIndexByJobId,
  jobUrlForId,
} from "./extension-lookup";
import { extractJobId } from "./scraper/url-builder";

describe("buildJobIdIndex", () => {
  it("matches slugged pipeline URLs by job ID", () => {
    const rows = [
      {
        id: "row-1",
        job_url:
          "https://www.linkedin.com/jobs/view/senior-engineer-at-acme-4012345678",
      },
    ];
    const index = buildJobIdIndex(rows);
    expect(index.get("4012345678")?.id).toBe("row-1");
  });

  it("matches slug-free canonical URLs", () => {
    const rows = [
      { id: "row-1", job_url: "https://www.linkedin.com/jobs/view/4012345678" },
    ];
    expect(buildJobIdIndex(rows).get("4012345678")?.id).toBe("row-1");
  });

  it("matches URLs with trailing slash or query params", () => {
    const rows = [
      {
        id: "row-1",
        job_url: "https://www.linkedin.com/jobs/view/4012345678/",
      },
      {
        id: "row-2",
        job_url:
          "https://www.linkedin.com/jobs/view/pm-at-globex-4099999999?refId=abc",
      },
    ];
    const index = buildJobIdIndex(rows);
    expect(index.get("4012345678")?.id).toBe("row-1");
    expect(index.get("4099999999")?.id).toBe("row-2");
  });

  it("excludes non-LinkedIn / imported URLs without a numeric ID", () => {
    const rows = [
      { id: "row-1", job_url: "https://jobs.example.com/opening/staff-pm" },
      { id: "row-2", job_url: "https://www.linkedin.com/jobs/view/4012345678" },
    ];
    const index = buildJobIdIndex(rows);
    expect(index.size).toBe(1);
    expect(index.get("4012345678")?.id).toBe("row-2");
  });
});

describe("jobUrlForId", () => {
  it("round-trips through extractJobId", () => {
    const id = "4436434370";
    expect(extractJobId(jobUrlForId(id))).toBe(id);
  });
});

describe("fetchEvalIndexByJobId", () => {
  // Minimal stub of the .from().select().eq().range() chain: `pages` is the
  // sequence of { data, error } results returned by successive range() calls.
  function stubSupabase(pages: Array<{ data?: unknown[]; error?: { message: string } }>) {
    let call = 0;
    const ranges: Array<[number, number]> = [];
    const eqArgs: Array<[string, string]> = [];
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((col: string, val: string) => {
        eqArgs.push([col, val]);
        return chain;
      }),
      order: vi.fn(() => chain),
      range: vi.fn((from: number, to: number) => {
        ranges.push([from, to]);
        const page = pages[call++] ?? { data: [] };
        return Promise.resolve({ data: page.data ?? null, error: page.error ?? null });
      }),
    };
    const supabase = { from: vi.fn(() => chain) };
    return { supabase: supabase as never, ranges, eqArgs };
  }

  const row = (id: string) => ({
    id: `row-${id}`,
    job_url: `https://www.linkedin.com/jobs/view/${id}`,
    total_score: 80,
    fit_category: "GOOD FIT",
    eval_summary: "s",
    skipped: false,
  });

  it("returns an index keyed by extracted job ID, filtered by user_id", async () => {
    const { supabase, eqArgs } = stubSupabase([
      { data: [row("4012345678"), row("4099999999")] },
    ]);
    const index = await fetchEvalIndexByJobId(supabase, "user-1");
    expect(index.size).toBe(2);
    expect(index.get("4012345678")?.id).toBe("row-4012345678");
    expect(eqArgs).toContainEqual(["user_id", "user-1"]);
  });

  it("pages past the 1000-row PostgREST cap and stops on a short page", async () => {
    const full = Array.from({ length: 1000 }, (_, i) =>
      row(String(4000000000 + i))
    );
    const { supabase, ranges } = stubSupabase([
      { data: full },
      { data: [row("4500000000")] },
    ]);
    const index = await fetchEvalIndexByJobId(supabase, "user-1");
    expect(index.size).toBe(1001);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(index.get("4500000000")).toBeDefined();
  });

  it("returns an empty map when the user has no evaluations", async () => {
    const { supabase, ranges } = stubSupabase([{ data: [] }]);
    const index = await fetchEvalIndexByJobId(supabase, "user-1");
    expect(index.size).toBe(0);
    expect(ranges).toHaveLength(1); // no second page requested
  });

  it("throws on a database error instead of returning a partial index", async () => {
    const { supabase } = stubSupabase([{ error: { message: "boom" } }]);
    await expect(fetchEvalIndexByJobId(supabase, "user-1")).rejects.toThrow(
      /job_evaluations page fetch: boom/
    );
  });
});
