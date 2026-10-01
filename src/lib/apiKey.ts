import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function generateApiKey(): string {
  return "sk_" + randomBytes(24).toString("base64url");
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function verifyApiKey(key: string, hash: string): boolean {
  const a = Buffer.from(hashApiKey(key), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
