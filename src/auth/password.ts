// Passwords: salted scrypt (memory-hard, built into Node). Stored as
// "scrypt$N$r$p$salt$hash" so the cost can be raised later without breaking old hashes.
import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))));

const COST = { N: 16_384, r: 8, p: 1 }; // ~16 MB and tens of ms per guess: cheap for one login, costly for millions
const KEY_LEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LEN, { ...COST, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Same work as a real check, for logins to unknown emails: response time doesn't reveal who has an account. */
const DUMMY = hashPassword("not-a-real-password-just-for-timing");
export async function burnPasswordCheck(password: string) {
  await verifyPassword(password, await DUMMY);
}

/** 6 digits, uniformly random. */
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

// Length matters most (NIST SP 800-63B); refuse the passwords every attacker tries first.
const COMMON = new Set([
  "password", "password1", "password12", "password123", "password1234", "12345678", "123456789", "1234567890", "qwertyuiop",
  "iloveyou12", "letmein123", "welcome123", "admin12345", "abc1234567", "1q2w3e4r5t", "qwerty1234", "passw0rd12", "vendorstreet",
]);
export const PASSWORD_MIN = 10;
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (password.length > 200) return "That's too long (200 characters at most)";
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return "That password is too easy to guess";
  if (lower.includes(email.split("@")[0]!.toLowerCase()) && email.split("@")[0]!.length >= 4) return "Don't use your email name in your password";
  return null;
}
