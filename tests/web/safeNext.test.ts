import { safeNext } from "../../web/account/Account";

describe("safeNext: where sign-in sends you afterwards", () => {
  const here = new URL("https://vendorstreet.dev/signin");
  it("allows pages on this site and its business subdomains", () => {
    expect(safeNext("/account", here)).toBe("/account");
    expect(safeNext("https://joes-plumbing.vendorstreet.dev/app#/requests", here)).toBe("https://joes-plumbing.vendorstreet.dev/app#/requests");
    expect(safeNext("https://vendorstreet.dev/admin", here)).toBe("https://vendorstreet.dev/admin");
  });
  it("refuses anywhere else", () => {
    for (const bad of ["https://evil.example/", "//evil.example/x", "https://vendorstreet.dev.evil.example/", "javascript:alert(1)", "https://evilvendorstreet.dev/"])
      expect(safeNext(bad, here)).toBe("/account");
    expect(safeNext(null, here)).toBe("/account");
  });
});
