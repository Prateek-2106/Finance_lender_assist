import {
  normalizePhone,
  TenantCreateSchema,
  LeadCreateSchema,
  LineItemSchema,
  parseOrThrow,
} from "../../src/schemas";
import { ValidationError } from "../../src/errors";

describe("normalizePhone (US default, E.164 output)", () => {
  it.each([
    ["716-555-0123", "+17165550123"],
    ["(716) 555 0123", "+17165550123"],
    ["1 716 555 0123", "+17165550123"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("%s → %s", (raw, out) => expect(normalizePhone(raw)).toBe(out));

  it.each(["555-0123", "12345678901234", "+12", "call me"])("rejects %s", (raw) =>
    expect(normalizePhone(raw)).toBeNull(),
  );
});

describe("TenantCreateSchema", () => {
  it("derives the subdomain from the name when omitted and applies defaults", () => {
    const t = TenantCreateSchema.parse({ name: "  Joe's Plumbing " });
    expect(t).toEqual({ name: "Joe's Plumbing", subdomain: "joes-plumbing", taxRateBps: 0, priceList: [] });
  });
  it("keeps an explicit subdomain (lowercased)", () => {
    expect(TenantCreateSchema.parse({ name: "Joe", subdomain: "JoeRocks" }).subdomain).toBe("joerocks");
  });
  it("rejects reserved / invalid subdomains", () => {
    expect(TenantCreateSchema.safeParse({ name: "Joe", subdomain: "admin" }).success).toBe(false);
    expect(TenantCreateSchema.safeParse({ name: "Joe", subdomain: "-bad" }).success).toBe(false);
  });
  it("rejects names with no usable characters (without throwing)", () => {
    expect(TenantCreateSchema.safeParse({ name: "!!!!" }).success).toBe(false);
  });
  it("validates tax rate bounds (0–2000 bps) and integer-ness", () => {
    expect(TenantCreateSchema.safeParse({ name: "Joe", taxRateBps: 2500 }).success).toBe(false);
    expect(TenantCreateSchema.safeParse({ name: "Joe", taxRateBps: 8.25 }).success).toBe(false);
  });
  it("validates the price list and rejects duplicate SKUs", () => {
    const item = { sku: "A", name: "Thing", unitPriceCents: 100 };
    expect(TenantCreateSchema.safeParse({ name: "Joe", priceList: [item] }).success).toBe(true);
    expect(TenantCreateSchema.safeParse({ name: "Joe", priceList: [item, item] }).success).toBe(false);
    expect(
      TenantCreateSchema.safeParse({ name: "Joe", priceList: [{ ...item, unitPriceCents: 1.5 }] }).success,
    ).toBe(false);
  });
});

describe("LeadCreateSchema", () => {
  it("normalizes phone and email, trims strings", () => {
    const l = LeadCreateSchema.parse({
      name: " Ann ",
      phone: "716.555.0123",
      email: " ANN@Example.COM ",
      message: " Leaky faucet ",
    });
    expect(l).toEqual({ name: "Ann", phone: "+17165550123", email: "ann@example.com", message: "Leaky faucet" });
  });
  it("treats empty strings from HTML forms as missing", () => {
    const l = LeadCreateSchema.parse({ name: "Ann", phone: "", email: "a@b.co", message: "hi" });
    expect(l.phone).toBeUndefined();
  });
  it("requires at least one contact method", () => {
    expect(LeadCreateSchema.safeParse({ name: "Ann", message: "hi" }).success).toBe(false);
  });
  it("rejects bad phone or email", () => {
    expect(LeadCreateSchema.safeParse({ name: "Ann", phone: "123", message: "hi" }).success).toBe(false);
    expect(LeadCreateSchema.safeParse({ name: "Ann", email: "nope", message: "hi" }).success).toBe(false);
  });
  it("ignores unknown fields like a client-supplied tenantId", () => {
    const l = LeadCreateSchema.parse({ name: "Ann", email: "a@b.co", message: "hi", tenantId: "evil" });
    expect(l).not.toHaveProperty("tenantId");
  });
});

describe("LineItemSchema", () => {
  it("allows fractional quantity but integer cents", () => {
    expect(LineItemSchema.safeParse({ description: "Labor", quantity: 1.5, unitPriceCents: 9500 }).success).toBe(true);
    expect(LineItemSchema.safeParse({ description: "Labor", quantity: 1, unitPriceCents: 95.5 }).success).toBe(false);
    expect(LineItemSchema.safeParse({ description: "Labor", quantity: 0, unitPriceCents: 1 }).success).toBe(false);
  });
});

describe("parseOrThrow", () => {
  it("returns parsed data on success", () => {
    expect(parseOrThrow(LineItemSchema, { description: "x", quantity: 1, unitPriceCents: 1 }).quantity).toBe(1);
  });
  it("throws a ValidationError with readable issues (path + message)", () => {
    try {
      parseOrThrow(LeadCreateSchema, { name: "", message: "hi", email: "a@b.co" });
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const issues = (e as ValidationError).issues as { path: string; message: string }[];
      expect(issues.some((i) => i.path === "name")).toBe(true);
    }
  });
});
