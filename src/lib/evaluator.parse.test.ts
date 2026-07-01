import { describe, it, expect } from "vitest";
import { parseEvalResponse } from "./evaluator";

const VALID = {
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

describe("parseEvalResponse", () => {
  it("parses a bare JSON object", () => {
    expect(parseEvalResponse(JSON.stringify(VALID))).toEqual(VALID);
  });

  it("parses JSON wrapped in a ```json fence", () => {
    const fenced = "```json\n" + JSON.stringify(VALID) + "\n```";
    expect(parseEvalResponse(fenced)).toEqual(VALID);
  });

  it("extracts JSON embedded in surrounding prose", () => {
    const noisy = `Here is the evaluation:\n${JSON.stringify(VALID)}\nHope that helps!`;
    expect(parseEvalResponse(noisy)).toEqual(VALID);
  });

  it("returns null when there is no JSON object", () => {
    expect(parseEvalResponse("no json here")).toBeNull();
    expect(parseEvalResponse("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseEvalResponse("{ not: valid, json }")).toBeNull();
  });
});
