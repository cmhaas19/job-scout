import { describe, it, expect, vi } from "vitest";

// run.ts → pipeline.ts → evaluator.ts constructs `new Anthropic()` at module
// load; stub the SDK and the Supabase server client so importing the pure
// `statusFromPhase` mapping doesn't require real credentials.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: vi.fn() };
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));

import { statusFromPhase } from "./run";

describe("statusFromPhase", () => {
  it("maps the terminal phases to their run status", () => {
    expect(statusFromPhase("failed")).toBe("failed");
    expect(statusFromPhase("cancelled")).toBe("cancelled");
    expect(statusFromPhase("completed")).toBe("completed");
  });

  it("treats any non-terminal phase as completed", () => {
    expect(statusFromPhase("evaluating (batch 2/3)")).toBe("completed");
    expect(statusFromPhase("scraping")).toBe("completed");
    expect(statusFromPhase("")).toBe("completed");
  });
});
