import { z } from "zod";
import { toSubdomain, isValidSubdomain } from "./lib/subdomain";
import { ValidationError } from "./errors";

export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export const PriceItemSchema = z.object({
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  unitPriceCents: z.number().int().nonnegative(),
  unit: z.string().trim().max(20).optional(),
  fractional: z.boolean().optional(),
});

export const LineItemSchema = z.object({
  sku: z.string().trim().max(40).optional(),
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive().max(10_000),
  unitPriceCents: z.number().int().nonnegative(),
  fractional: z.boolean().optional(),
});

export const TenantCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    subdomain: z.string().trim().toLowerCase().optional(),
    taxRateBps: z.number().int().min(0).max(2000).default(0),
    priceList: z.array(PriceItemSchema).max(500).default([]),
  })
  .transform((t, ctx) => {
    let subdomain = t.subdomain;
    if (!subdomain) {
      try {
        subdomain = toSubdomain(t.name);
      } catch {
        ctx.addIssue({ code: "custom", path: ["name"], message: "Name has no usable characters" });
        return z.NEVER;
      }
    }
    if (!isValidSubdomain(subdomain)) {
      ctx.addIssue({ code: "custom", path: ["subdomain"], message: "Invalid or reserved subdomain" });
      return z.NEVER;
    }
    const skus = t.priceList.map((p) => p.sku);
    if (new Set(skus).size !== skus.length) {
      ctx.addIssue({ code: "custom", path: ["priceList"], message: "Duplicate SKU" });
      return z.NEVER;
    }
    return { ...t, subdomain };
  });
export type TenantCreate = z.output<typeof TenantCreateSchema>;

export const LeadCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    phone: z
      .string()
      .optional()
      .transform((p, ctx) => {
        if (p === undefined || p.trim() === "") return undefined;
        const n = normalizePhone(p);
        if (!n) {
          ctx.addIssue({ code: "custom", message: "Invalid phone number" });
          return z.NEVER;
        }
        return n;
      }),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .optional()
      .transform((e) => (e === "" ? undefined : e))
      .pipe(z.email().optional()),
    message: z.string().trim().min(1).max(2000),
  })
  .refine((l) => l.phone || l.email, { message: "Provide a phone or an email", path: ["phone"] });
export type LeadCreate = z.output<typeof LeadCreateSchema>;

export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ValidationError(
      "Validation failed",
      r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return r.data;
}

export const EstimateCreateSchema = z.object({
  leadId: z.string().min(1).optional(),
  lineItems: z.array(LineItemSchema).max(100),
  notes: z.string().trim().max(2000).optional(),
});

export const EstimatePatchSchema = z.object({
  lineItems: z.array(LineItemSchema).max(100),
});

export const EstimateTransitionSchema = z.object({
  to: z.enum(["draft", "sent", "accepted", "declined", "invoiced", "needs_review"]),
});

export const ApplicationCreateSchema = z.object({
  industry: z.string().trim().min(2).max(80),
  monthsInBusiness: z.number().int().min(0).max(1200),
  statedMonthlyRevenueCents: z.number().int().nonnegative(),
  amountRequestedCents: z.number().int().positive().max(500_000_00),
  useOfFunds: z.string().trim().min(2).max(500),
});

export const PriceListSchema = z
  .array(PriceItemSchema)
  .max(500)
  .refine((xs) => new Set(xs.map((x) => x.sku.toUpperCase())).size === xs.length, { message: "Duplicate SKU" });
