import { describe, it, expect, vi } from "vitest";
import { randomBytes, createHash } from "node:crypto";
import { hashApiKey, API_KEY_PATTERN, requireApiKeyUser } from "./api-auth";
import { createServiceClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
}));

describe("hashApiKey", () => {
  it("returns the SHA-256 hex digest (matches node:crypto directly)", () => {
    const key = "jsk_abc123";
    expect(hashApiKey(key)).toBe(
      createHash("sha256").update(key).digest("hex")
    );
  });

  it("is deterministic and hex-shaped", () => {
    const key = `jsk_${randomBytes(32).toString("base64url")}`;
    const a = hashApiKey(key);
    expect(hashApiKey(key)).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different hashes for different keys", () => {
    expect(hashApiKey("jsk_key-one")).not.toBe(hashApiKey("jsk_key-two"));
  });
});

describe("API_KEY_PATTERN", () => {
  it("accepts keys in the generated format (jsk_ + 32 random bytes base64url)", () => {
    for (let i = 0; i < 5; i++) {
      const key = `jsk_${randomBytes(32).toString("base64url")}`;
      expect(key).toMatch(API_KEY_PATTERN);
    }
  });

  it("rejects keys without the jsk_ prefix", () => {
    expect(`abc_${randomBytes(32).toString("base64url")}`).not.toMatch(
      API_KEY_PATTERN
    );
    expect(randomBytes(32).toString("base64url")).not.toMatch(API_KEY_PATTERN);
  });

  it("rejects suffixes shorter than 40 chars", () => {
    expect("jsk_").not.toMatch(API_KEY_PATTERN);
    expect(`jsk_${"a".repeat(39)}`).not.toMatch(API_KEY_PATTERN);
    expect(`jsk_${"a".repeat(40)}`).toMatch(API_KEY_PATTERN);
  });

  it("rejects non-base64url characters (standard base64, whitespace, injection)", () => {
    const pad = "a".repeat(40);
    expect(`jsk_${pad}+`).not.toMatch(API_KEY_PATTERN);
    expect(`jsk_${pad}/`).not.toMatch(API_KEY_PATTERN);
    expect(`jsk_${pad}=`).not.toMatch(API_KEY_PATTERN);
    expect(`jsk_${pad} `).not.toMatch(API_KEY_PATTERN);
    expect(`jsk_${pad}' OR 1=1`).not.toMatch(API_KEY_PATTERN);
  });
});

// These branches all reject BEFORE any Supabase call, so they run without a
// client.
describe("requireApiKeyUser (pre-database rejects)", () => {
  const req = (headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/extension/ping", { headers });

  it("returns 401 when the Authorization header is missing", async () => {
    const result = await requireApiKeyUser(req());
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("returns 401 for a non-Bearer authorization scheme", async () => {
    const result = await requireApiKeyUser(
      req({ authorization: "Basic dXNlcjpwYXNz" })
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("returns 401 for a Bearer token that fails API_KEY_PATTERN", async () => {
    const result = await requireApiKeyUser(
      req({ authorization: "Bearer not-a-jobscout-key" })
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
});

// The hash-lookup branches, with the Supabase service client stubbed. These
// are the revocation enforcement point: a well-formed key whose hash matches
// no profile MUST 401.
describe("requireApiKeyUser (hash lookup)", () => {
  const key = `jsk_${"a".repeat(43)}`;
  const req = () =>
    new Request("http://localhost/api/extension/ping", {
      headers: { authorization: `Bearer ${key}` },
    });

  function stubProfiles(
    row: { id: string } | null,
    error: { message: string } | null = null
  ) {
    const eq = vi.fn(() => ({
      maybeSingle: () => Promise.resolve({ data: row, error }),
    }));
    vi.mocked(createServiceClient).mockResolvedValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })),
    } as never);
    return { eq };
  }

  it("returns 401 when a well-formed key's hash matches no profile (revoked/forged)", async () => {
    stubProfiles(null);
    const result = await requireApiKeyUser(req());
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("returns the matched userId and looks up by the SHA-256 of the key", async () => {
    const { eq } = stubProfiles({ id: "user-1" });
    const result = await requireApiKeyUser(req());
    expect(result).toMatchObject({ userId: "user-1" });
    expect(eq).toHaveBeenCalledWith("api_key_hash", hashApiKey(key));
  });

  it("returns 503 (not 401) when the lookup itself errors — an outage is not an auth verdict", async () => {
    stubProfiles(null, { message: "connection reset" });
    const result = await requireApiKeyUser(req());
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(503);
  });
});
