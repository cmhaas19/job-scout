import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSearchResults, parseAgoTime, htmlToMarkdown } from "./parser";

describe("parseAgoTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for empty or unparseable input", () => {
    expect(parseAgoTime("")).toBeNull();
    expect(parseAgoTime("recently")).toBeNull();
  });

  it("subtracts the right interval for each unit", () => {
    expect(parseAgoTime("30 minutes ago")).toBe("2026-06-15T11:30:00.000Z");
    expect(parseAgoTime("3 hours ago")).toBe("2026-06-15T09:00:00.000Z");
    expect(parseAgoTime("2 days ago")).toBe("2026-06-13T12:00:00.000Z");
    expect(parseAgoTime("1 week ago")).toBe("2026-06-08T12:00:00.000Z");
  });
});

describe("htmlToMarkdown", () => {
  it("converts inline emphasis and paragraphs", () => {
    expect(htmlToMarkdown("<p>Hello <strong>world</strong></p>")).toBe(
      "Hello **world**"
    );
  });

  it("converts unordered and ordered lists", () => {
    expect(htmlToMarkdown("<ul><li>a</li><li>b</li></ul>")).toBe("- a\n- b");
    expect(htmlToMarkdown("<ol><li>first</li><li>second</li></ol>")).toBe(
      "1. first\n2. second"
    );
  });

  it("truncates at sidebar markers", () => {
    const md = htmlToMarkdown(
      "<p>Real description.</p><p>More jobs you may like</p>"
    );
    expect(md).toBe("Real description.");
  });
});

describe("parseSearchResults", () => {
  const html = readFileSync(
    join(__dirname, "__fixtures__", "search-results.html"),
    "utf-8"
  );

  it("extracts one card per valid job and skips empty promo cards", () => {
    const jobs = parseSearchResults(html);
    expect(jobs).toHaveLength(2);
  });

  it("normalizes the job URL (strips query params)", () => {
    const [first] = parseSearchResults(html);
    expect(first.jobUrl).toBe(
      "https://www.linkedin.com/jobs/view/senior-engineer-at-acme-4012345678"
    );
  });

  it("pulls title, company, location and salary", () => {
    const [first] = parseSearchResults(html);
    expect(first.position).toBe("Senior Software Engineer");
    expect(first.company).toBe("Acme Corp");
    expect(first.location).toBe("San Francisco, CA");
    expect(first.salary).toBe("$180,000 - $220,000");
  });

  it("defaults salary to 'Not specified' when absent", () => {
    const [, second] = parseSearchResults(html);
    expect(second.salary).toBe("Not specified");
  });

  it("falls back to the datetime attribute when there is no relative ago-time", () => {
    const [, second] = parseSearchResults(html);
    // Second card has no listdate text, so datePosted comes from time[datetime].
    expect(second.datePosted).toBe("2026-06-01");
  });

  it("prefers the company logo delayed-url, then img src", () => {
    const [first, second] = parseSearchResults(html);
    expect(first.companyLogo).toBe("https://media.example.com/acme-logo.png");
    expect(second.companyLogo).toBe("https://media.example.com/globex-logo.png");
  });
});
