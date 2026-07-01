import { describe, it, expect } from "vitest";
import { parseTopSalary, normalizeDollarAmount } from "./salary";

describe("parseTopSalary", () => {
  it("returns null for empty / missing / placeholder input", () => {
    expect(parseTopSalary(null)).toBeNull();
    expect(parseTopSalary(undefined)).toBeNull();
    expect(parseTopSalary("")).toBeNull();
    expect(parseTopSalary("Not specified")).toBeNull();
    expect(parseTopSalary("Competitive salary")).toBeNull();
  });

  it("returns the top of a dollar range", () => {
    expect(parseTopSalary("$180,000 - $220,000")).toBe(220000);
  });

  it("handles en-dash and em-dash ranges", () => {
    expect(parseTopSalary("$100,000–$150,000")).toBe(150000);
    expect(parseTopSalary("$100,000—$150,000")).toBe(150000);
  });

  it("expands k-suffixed amounts", () => {
    expect(parseTopSalary("$100K - $150K")).toBe(150000);
    expect(parseTopSalary("$150k")).toBe(150000);
  });

  it("parses a standalone amount above the 50k floor", () => {
    expect(parseTopSalary("$120,000")).toBe(120000);
  });

  it("ignores standalone amounts below the 50k floor (hourly/fees noise)", () => {
    expect(parseTopSalary("$60/hr")).toBeNull();
    expect(parseTopSalary("$30,000")).toBeNull();
  });

  it("takes the maximum across multiple ranges", () => {
    expect(parseTopSalary("$90,000 - $110,000 or $130,000 - $160,000")).toBe(160000);
  });
});

describe("normalizeDollarAmount", () => {
  it("strips formatting and returns the numeric value", () => {
    expect(normalizeDollarAmount("$1,234.56")).toBeCloseTo(1234.56);
    expect(normalizeDollarAmount("$220,000")).toBe(220000);
  });

  it("applies the 1000x multiplier for k", () => {
    expect(normalizeDollarAmount("$150K")).toBe(150000);
    expect(normalizeDollarAmount("$150k")).toBe(150000);
  });

  it("returns null when there is no parseable number", () => {
    expect(normalizeDollarAmount("$abc")).toBeNull();
    expect(normalizeDollarAmount("")).toBeNull();
  });
});
