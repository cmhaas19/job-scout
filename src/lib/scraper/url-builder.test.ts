import { describe, it, expect } from "vitest";
import {
  buildLinkedInSearchUrl,
  normalizeJobUrl,
  extractJobId,
} from "./url-builder";

// Parse the built URL back into params for readable assertions.
function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe("buildLinkedInSearchUrl", () => {
  it("always sets keywords and a default start of 0", () => {
    const p = params(
      buildLinkedInSearchUrl({ keyword: "Engineer", date_since_posted: "past week" })
    );
    expect(p.get("keywords")).toBe("Engineer");
    expect(p.get("start")).toBe("0");
  });

  it("maps date_since_posted to the LinkedIn time-window code", () => {
    const p = params(
      buildLinkedInSearchUrl({ keyword: "x", date_since_posted: "past week" })
    );
    expect(p.get("f_TPR")).toBe("r604800");
  });

  it("omits time filter for an unknown window", () => {
    const p = params(
      buildLinkedInSearchUrl({ keyword: "x", date_since_posted: "yesterday" })
    );
    expect(p.has("f_TPR")).toBe(false);
  });

  it("maps and joins known experience levels, dropping unknown ones", () => {
    const p = params(
      buildLinkedInSearchUrl({
        keyword: "x",
        date_since_posted: "past week",
        experience_level: ["senior", "director", "wizard"],
      })
    );
    expect(p.get("f_E")).toBe("4,5");
  });

  it("maps remote, job_type, sort and location", () => {
    const p = params(
      buildLinkedInSearchUrl({
        keyword: "x",
        date_since_posted: "past week",
        location: "Austin, TX",
        remote_filter: "remote",
        job_type: "full time",
        sort_by: "recent",
      })
    );
    expect(p.get("location")).toBe("Austin, TX");
    expect(p.get("f_WT")).toBe("2");
    expect(p.get("f_JT")).toBe("F");
    expect(p.get("sortBy")).toBe("DD");
  });

  it("respects an explicit start offset for pagination", () => {
    const p = params(
      buildLinkedInSearchUrl({ keyword: "x", date_since_posted: "past week", start: 50 })
    );
    expect(p.get("start")).toBe("50");
  });
});

describe("normalizeJobUrl", () => {
  it("drops query strings and fragments", () => {
    expect(
      normalizeJobUrl("https://www.linkedin.com/jobs/view/123?trk=foo&ref=bar")
    ).toBe("https://www.linkedin.com/jobs/view/123");
  });

  it("falls back to splitting on ? for non-URL input", () => {
    expect(normalizeJobUrl("not a url?x=1")).toBe("not a url");
  });
});

describe("extractJobId", () => {
  it("pulls the trailing 8+ digit id from a LinkedIn slug URL", () => {
    expect(
      extractJobId("https://www.linkedin.com/jobs/view/senior-engineer-at-acme-4012345678")
    ).toBe("4012345678");
  });

  it("tolerates a trailing slash and query string", () => {
    expect(
      extractJobId("https://www.linkedin.com/jobs/view/role-4012345678/?trk=x")
    ).toBe("4012345678");
  });

  it("returns null when there is no long numeric id", () => {
    expect(extractJobId("https://example.com/careers/123")).toBeNull();
    expect(extractJobId("https://example.com/jobs/apply")).toBeNull();
  });
});
