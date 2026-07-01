import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { formatDuration, formatShortDate, timeAgo } from "./constants";

describe("formatDuration", () => {
  it("returns the fallback for null/zero", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(null, "n/a")).toBe("n/a");
    expect(formatDuration(0)).toBe("—");
  });

  it("formats sub-second, second and minute ranges", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(65000)).toBe("1.1m");
  });
});

describe("formatShortDate", () => {
  it("returns a dash for null", () => {
    expect(formatShortDate(null)).toBe("—");
  });

  it("returns a formatted date-time string for a valid ISO date", () => {
    const out = formatShortDate("2026-06-15T15:45:00Z");
    expect(out).not.toBe("—");
    // Format is like "Jun 15, 8:45 AM" — always has a comma separating date and time.
    expect(out).toContain(",");
  });
});

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports 'just now' under a minute", () => {
    expect(timeAgo("2026-06-15T11:59:30Z")).toBe("just now");
  });

  it("reports minutes, hours and days", () => {
    expect(timeAgo("2026-06-15T11:45:00Z")).toBe("15m ago");
    expect(timeAgo("2026-06-15T09:00:00Z")).toBe("3h ago");
    expect(timeAgo("2026-06-13T12:00:00Z")).toBe("2d ago");
  });
});
