import { generateApiKey, hashApiKey, verifyApiKey } from "../../src/lib/apiKey";

describe("api keys", () => {
  it("generates unguessable, prefixed, URL-safe keys", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).toMatch(/^sk_[A-Za-z0-9_-]{32,}$/);
    expect(a).not.toBe(b);
  });
  it("hashes deterministically to hex sha256 (never store the raw key)", () => {
    expect(hashApiKey("sk_test")).toBe(hashApiKey("sk_test"));
    expect(hashApiKey("sk_test")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey("sk_test")).not.toContain("sk_test");
  });
  it("verifies a key against its hash", () => {
    const k = generateApiKey();
    const h = hashApiKey(k);
    expect(verifyApiKey(k, h)).toBe(true);
    expect(verifyApiKey(k + "x", h)).toBe(false);
    expect(verifyApiKey(k, "not-a-hash")).toBe(false);
  });
});
