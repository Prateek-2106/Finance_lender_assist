export const RESERVED_SUBDOMAINS = ["www", "api", "app", "admin", "mail", "static"];

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
  if (s.startsWith("xn--")) return false;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s);
}
