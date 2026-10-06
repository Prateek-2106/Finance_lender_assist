// Platform addresses, plus names people would trust by mistake. A business on its own domain
// (customDomain) isn't limited by this; these only protect *.vendorstreet.dev.
export const RESERVED_SUBDOMAINS = [
  "www", "api", "app", "admin", "mail", "static", "origin", "email", "smtp", "auth", "account", "accounts", "login", "signin", "signup",
  "support", "help", "status", "docs", "blog", "assets", "cdn", "underwriting", "scoring", "billing", "security", "dev", "staging", "test",
  "vendorstreet", "paypal", "stripe", "chase", "wellsfargo", "bankofamerica", "citi", "citibank", "amex", "americanexpress", "capitalone",
  "irs", "google", "apple", "microsoft", "amazon", "aws", "plaid", "onepark", "oneparkfinancial",
];

export function toSubdomain(businessName: string): string {
  const s = businessName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  if (!s) throw new Error(`Cannot derive a subdomain from "${businessName}"`);
  return s;
}

export function isValidSubdomain(s: string): boolean {
  if (RESERVED_SUBDOMAINS.includes(s)) return false;
  if (s.startsWith("demo-")) return false; // throwaway demo businesses use this prefix
  if (s.startsWith("xn--")) return false;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s);
}
