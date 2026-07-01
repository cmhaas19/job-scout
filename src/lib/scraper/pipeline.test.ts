import { describe, it, expect, vi } from "vitest";

// pipeline.ts → evaluator.ts constructs `new Anthropic()` at module load, and
// pipeline pulls in the Supabase server client. Stub both so importing the pure
// helpers under test doesn't require real credentials.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: vi.fn() };
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));

import { emptyStats, mergeStats, mapPool, createSemaphore } from "./pipeline";

describe("emptyStats", () => {
  it("returns a fully zeroed stats object", () => {
    const s = emptyStats();
    expect(s.phase).toBe("starting");
    expect(s.errors).toEqual([]);
    for (const key of [
      "searchesRun",
      "jobsFound",
      "jobsFiltered",
      "jobsSkippedDuplicate",
      "jobsSkippedPublisher",
      "jobsSkippedComp",
      "jobsSkippedLocationDup",
      "jobsFetched",
      "jobsEvaluated",
      "jobsFailed",
    ]) {
      expect(s[key]).toBe(0);
    }
  });

  it("returns a fresh object each call (no shared arrays)", () => {
    const a = emptyStats();
    const b = emptyStats();
    (a.errors as string[]).push("x");
    expect(b.errors).toEqual([]);
  });
});

describe("mergeStats", () => {
  it("adds numeric fields and concatenates errors across deltas", () => {
    const into = emptyStats();
    mergeStats(into, { jobsFound: 5, jobsEvaluated: 2, errors: ["a"] });
    mergeStats(into, { jobsFound: 3, jobsFailed: 1, errors: ["b", "c"] });
    expect(into.jobsFound).toBe(8);
    expect(into.jobsEvaluated).toBe(2);
    expect(into.jobsFailed).toBe(1);
    expect(into.errors).toEqual(["a", "b", "c"]);
  });

  it("ignores a missing errors key and leaves phase untouched", () => {
    const into = emptyStats();
    into.phase = "evaluating";
    mergeStats(into, { searchesRun: 1 });
    expect(into.searchesRun).toBe(1);
    expect(into.errors).toEqual([]);
    expect(into.phase).toBe("evaluating");
  });

  it("skips non-number values for numeric keys", () => {
    const into = emptyStats();
    // @ts-expect-error — deliberately pass a bad type to prove it's ignored
    mergeStats(into, { jobsFound: "10" });
    expect(into.jobsFound).toBe(0);
  });
});

describe("mapPool", () => {
  it("never exceeds the concurrency limit and runs every item exactly once", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const limit = 3;
    let active = 0;
    let maxActive = 0;
    const done: number[] = [];
    await mapPool(items, limit, async (i) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      done.push(i);
      active--;
    });
    expect(maxActive).toBeLessThanOrEqual(limit);
    expect(done.slice().sort((a, b) => a - b)).toEqual(items);
  });

  it("handles an empty list and a limit larger than the item count", async () => {
    const empty: number[] = [];
    await expect(mapPool(empty, 5, async () => {})).resolves.toBeUndefined();

    const items = [1, 2];
    let active = 0;
    let maxActive = 0;
    await mapPool(items, 10, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
    });
    expect(maxActive).toBeLessThanOrEqual(items.length);
  });
});

describe("createSemaphore", () => {
  it("blocks acquisitions past max until a release frees a slot", async () => {
    const sem = createSemaphore(2);
    await sem.acquire();
    await sem.acquire();

    let thirdAcquired = false;
    const pending = sem.acquire().then(() => {
      thirdAcquired = true;
    });

    // Give microtasks a chance — the third acquire must still be blocked.
    await Promise.resolve();
    await Promise.resolve();
    expect(thirdAcquired).toBe(false);

    sem.release();
    await pending;
    expect(thirdAcquired).toBe(true);
  });
});
