import { describe, it, expect, vi, beforeEach } from "vitest";

// The config module reads from Supabase via createServiceClient. We mock that
// factory and hand back a minimal chainable query-builder stub.
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

import { createServiceClient } from "@/lib/supabase/server";
import {
  getConfig,
  getAllConfig,
  getConfigNumber,
  getConfigString,
  getConfigArray,
} from "./config";

/**
 * Build a fake client whose `.from().select().eq().single()` resolves to
 * `single`, and whose awaited `.from().select("*")` resolves to `list`.
 */
function fakeClient({ single, list }: { single?: unknown; list?: unknown }) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    single: () => Promise.resolve(single ?? { data: null }),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve(list ?? { data: null }).then(resolve),
  };
  return { from: () => builder };
}

const mockedFactory = vi.mocked(createServiceClient);

beforeEach(() => {
  mockedFactory.mockReset();
});

describe("getConfig", () => {
  it("returns the stored value when a row exists", async () => {
    mockedFactory.mockResolvedValue(
      fakeClient({ single: { data: { value: 42 } } }) as any
    );
    expect(await getConfig("min_comp_top_end")).toBe(42);
  });

  it("falls back to the built-in default when no row exists", async () => {
    mockedFactory.mockResolvedValue(fakeClient({ single: { data: null } }) as any);
    expect(await getConfig("eval_model")).toBe("claude-sonnet-4-20250514");
  });

  it("returns null for an unknown key with no default", async () => {
    mockedFactory.mockResolvedValue(fakeClient({ single: { data: null } }) as any);
    expect(await getConfig("totally_unknown_key")).toBeNull();
  });
});

describe("typed getters", () => {
  it("getConfigNumber coerces and guards non-numeric values", async () => {
    mockedFactory.mockResolvedValue(fakeClient({ single: { data: { value: "5" } } }) as any);
    expect(await getConfigNumber("eval_concurrency")).toBe(5);

    mockedFactory.mockResolvedValue(fakeClient({ single: { data: { value: "abc" } } }) as any);
    expect(await getConfigNumber("eval_concurrency")).toBeNull();
  });

  it("getConfigString stringifies non-string values", async () => {
    mockedFactory.mockResolvedValue(fakeClient({ single: { data: { value: 300000 } } }) as any);
    expect(await getConfigString("min_comp_top_end")).toBe("300000");
  });

  it("getConfigArray returns [] for non-array values", async () => {
    mockedFactory.mockResolvedValue(fakeClient({ single: { data: { value: "nope" } } }) as any);
    expect(await getConfigArray("blocked_publishers")).toEqual([]);

    mockedFactory.mockResolvedValue(
      fakeClient({ single: { data: { value: ["Dice", "Lensa"] } } }) as any
    );
    expect(await getConfigArray("blocked_publishers")).toEqual(["Dice", "Lensa"]);
  });
});

describe("getAllConfig", () => {
  it("merges stored rows over the defaults", async () => {
    mockedFactory.mockResolvedValue(
      fakeClient({ list: { data: [{ key: "eval_model", value: "override-model" }] } }) as any
    );
    const all = await getAllConfig();
    expect(all.eval_model).toBe("override-model");
    // untouched default still present
    expect(all.max_searches_per_user).toBe(10);
  });
});
