import { describe, it, expect } from "vitest";
import { extensionLookupSchema, extensionEvaluateSchema } from "./validation";

const id = (n: number) => String(40000000 + n).padStart(10, "0");

describe("extensionLookupSchema", () => {
  it("accepts 1..50 numeric LinkedIn job ids", () => {
    expect(
      extensionLookupSchema.safeParse({ jobIds: ["40123456"] }).success
    ).toBe(true);
    const fifty = Array.from({ length: 50 }, (_, i) => id(i));
    expect(extensionLookupSchema.safeParse({ jobIds: fifty }).success).toBe(
      true
    );
  });

  it("rejects an empty array and more than 50 ids", () => {
    expect(extensionLookupSchema.safeParse({ jobIds: [] }).success).toBe(false);
    const fiftyOne = Array.from({ length: 51 }, (_, i) => id(i));
    expect(extensionLookupSchema.safeParse({ jobIds: fiftyOne }).success).toBe(
      false
    );
  });

  it("rejects non-numeric, short, and injection-shaped ids", () => {
    for (const bad of [
      "1234567", // 7 digits — too short
      "40123456a",
      "4012345678/../admin",
      "4012345678?x=1",
      "",
      "-4012345678",
    ]) {
      expect(
        extensionLookupSchema.safeParse({ jobIds: [bad] }).success,
        `should reject ${JSON.stringify(bad)}`
      ).toBe(false);
    }
  });
});

describe("extensionEvaluateSchema", () => {
  it("accepts jobs with and without optional title/company", () => {
    const parsed = extensionEvaluateSchema.safeParse({
      jobs: [
        { jobId: "4012345678", title: "Staff PM", company: "Acme" },
        { jobId: "4012345679" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a full page and rejects empty or oversized batches", () => {
    expect(extensionEvaluateSchema.safeParse({ jobs: [] }).success).toBe(false);
    const page = Array.from({ length: 25 }, (_, i) => ({ jobId: id(i) }));
    expect(extensionEvaluateSchema.safeParse({ jobs: page }).success).toBe(true);
    const overfull = Array.from({ length: 26 }, (_, i) => ({ jobId: id(i) }));
    expect(extensionEvaluateSchema.safeParse({ jobs: overfull }).success).toBe(
      false
    );
  });

  it("rejects oversized title/company and invalid job ids", () => {
    expect(
      extensionEvaluateSchema.safeParse({
        jobs: [{ jobId: "4012345678", title: "x".repeat(301) }],
      }).success
    ).toBe(false);
    expect(
      extensionEvaluateSchema.safeParse({
        jobs: [{ jobId: "4012345678", company: "x".repeat(301) }],
      }).success
    ).toBe(false);
    expect(
      extensionEvaluateSchema.safeParse({ jobs: [{ jobId: "not-a-number" }] })
        .success
    ).toBe(false);
  });
});
