import { describe, it, expect, vi, beforeEach } from "vitest";

// Anthropic SDK: capture the messages.create mock via vi.hoisted so it exists
// before the (hoisted) vi.mock factory runs.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: createMock };
  },
}));

// Config is exercised by dedicated tests; here we stub it to fixed values.
vi.mock("@/lib/config", () => ({
  getConfigString: vi.fn(async () => "claude-sonnet-4-20250514"),
  getConfigNumber: vi.fn(async (key: string) => {
    const m: Record<string, number> = {
      min_comp_top_end: 300000,
      score_threshold_strong: 85,
      score_threshold_good: 70,
      score_threshold_borderline: 60,
    };
    return m[key] ?? null;
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));

import { createServiceClient } from "@/lib/supabase/server";
import { evaluateJob } from "./evaluator";

const RATED = [
  {
    company: "Acme",
    position: "Eng",
    total_score: 80,
    fit_category: "GOOD FIT",
    user_rating: 4,
    user_notes: "loved it",
  },
];

const VALID_EVAL = {
  scores: {
    required_skills: 28,
    years_of_experience: 9,
    role_level_alignment: 18,
    industry_domain_match: 25,
    nice_to_have_skills: 4,
    education_certs: 5,
  },
  total_score: 89,
  fit_category: "STRONG FIT",
  strengths: ["a"],
  gaps: ["b"],
  summary: "Great match",
};

/** Table-aware fake client covering the three tables evaluator.ts reads. */
function makeEvalClient(opts: {
  promptContent: string;
  promptId?: string;
  version?: number;
  ratedJobs?: unknown[];
}) {
  const { promptContent, promptId = "p1", version = 3, ratedJobs = [] } = opts;
  return {
    from(table: string) {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        order: () => builder,
        limit: () => builder,
        single: () => {
          if (table === "system_prompts")
            return Promise.resolve({ data: { content: promptContent, id: promptId } });
          if (table === "prompt_versions")
            return Promise.resolve({ data: { version } });
          return Promise.resolve({ data: null });
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (table === "job_evaluations")
            return Promise.resolve({ data: ratedJobs }).then(resolve);
          return Promise.resolve({ data: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

const mockedFactory = vi.mocked(createServiceClient);

beforeEach(() => {
  createMock.mockReset();
  mockedFactory.mockReset();
});

describe("evaluateJob", () => {
  it("builds the prompt, parses Claude's JSON, and stamps the prompt version", async () => {
    mockedFactory.mockResolvedValue(
      makeEvalClient({
        promptContent: "Evaluate. Strong={{strong_threshold}} MinComp={{min_comp_top_end}}",
        version: 3,
        ratedJobs: RATED,
      }) as any
    );
    createMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify(VALID_EVAL) }],
    });

    const result = await evaluateJob(
      "user-1",
      "my resume",
      "Globex",
      "Staff Engineer",
      "job description here"
    );

    expect(result).toEqual({ ...VALID_EVAL, prompt_version: 3 });

    // The system prompt had its threshold tokens substituted and calibration appended.
    const systemPrompt = createMock.mock.calls[0][0].system as string;
    expect(systemPrompt).toContain("Strong=85");
    expect(systemPrompt).toContain("MinComp=300000");
    expect(systemPrompt).toContain("CALIBRATION FROM USER FEEDBACK");
    expect(systemPrompt).toContain("Acme");
  });

  it("returns null when Claude's response has no parseable JSON", async () => {
    mockedFactory.mockResolvedValue(
      makeEvalClient({ promptContent: "Evaluate.", ratedJobs: [] }) as any
    );
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "I could not evaluate this job." }],
    });

    expect(
      await evaluateJob("user-1", "resume", "Co", "Role", "desc")
    ).toBeNull();
  });

  it("returns null when the response contains no text block", async () => {
    mockedFactory.mockResolvedValue(
      makeEvalClient({ promptContent: "Evaluate.", ratedJobs: [] }) as any
    );
    createMock.mockResolvedValue({
      content: [{ type: "tool_use", id: "t1", name: "x", input: {} }],
    });

    expect(
      await evaluateJob("user-1", "resume", "Co", "Role", "desc")
    ).toBeNull();
  });
});
