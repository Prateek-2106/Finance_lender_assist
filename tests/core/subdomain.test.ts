import { toSubdomain, isValidSubdomain } from "../../src/lib/subdomain";

describe("toSubdomain", () => {
  it.each([
    ["Joe's Plumbing", "joes-plumbing"],
    ["  Bright   Smile Dental ", "bright-smile-dental"],
    ["Café Olé", "cafe-ole"],
    ["Smith & Sons HVAC", "smith-and-sons-hvac"],
    ["A+ Auto Repair!!!", "a-auto-repair"],
    ["24/7 Locksmith", "24-7-locksmith"],
  ])("%s → %s", (input, expected) => {
    expect(toSubdomain(input)).toBe(expected);
  });

  it("caps at 63 chars (DNS label limit) and never ends with a dash", () => {
    const s = toSubdomain("a".repeat(62) + " b");
    expect(s.length).toBeLessThanOrEqual(63);
    expect(s.endsWith("-")).toBe(false);
  });

  it("throws when nothing usable is left", () => {
    expect(() => toSubdomain("!!!")).toThrow();
    expect(() => toSubdomain("")).toThrow();
  });
});

describe("isValidSubdomain", () => {
  it("accepts normal labels", () => {
    expect(isValidSubdomain("joes-plumbing")).toBe(true);
    expect(isValidSubdomain("a")).toBe(true);
    expect(isValidSubdomain("247")).toBe(true);
  });
  it("rejects bad shapes", () => {
    for (const bad of ["-joe", "joe-", "Joe", "joe_plumb", "joe.plumb", "", "a".repeat(64)])
      expect(isValidSubdomain(bad), bad).toBe(false);
  });
  it("rejects reserved names and punycode prefixes", () => {
    for (const bad of ["www", "api", "app", "admin", "mail", "static", "xn--caf-dma"])
      expect(isValidSubdomain(bad), bad).toBe(false);
  });
});
