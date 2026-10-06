import request from "supertest";
import { BASE, fakeMailer, makeApp, signUp } from "../helpers/app";
import { SESSION_COOKIE } from "../../src/auth/session";
import { MAX_BUSINESSES_PER_USER } from "../../src/routes/auth";
import { hashPassword, passwordProblem, verifyPassword } from "../../src/auth/password";

const APEX = BASE; // "lvh.me": the platform's own address
const PW = "correct horse battery";
const origin = (host: string) => ({ Origin: `https://${host}` });
const fromApex = (cookie: string) => ({ Host: APEX, Cookie: cookie, ...origin(APEX) });

async function setup() {
  const mail = fakeMailer();
  const ctx = makeApp({ mailer: mail.mailer });
  const { app, emailsSettled } = ctx;
  const post = (path: string, body: object) => request(app).post(`/api/auth${path}`).set("Host", APEX).send(body);
  const cookieOf = (res: request.Response) => {
    const c = ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((x) => x.startsWith(`${SESSION_COOKIE}=`));
    return c ? { cookie: c.split(";")[0]!, setCookie: c } : null;
  };
  /** The 6-digit code in the newest email to this address. */
  async function lastCode(email: string) {
    await emailsSettled();
    const m = [...mail.sent].reverse().find((x) => x.to === email);
    return /\b(\d{6})\b/.exec(m?.subject ?? "")?.[1];
  }
  /** Sign up and confirm the email; returns the session cookie. */
  async function register(email: string, password = PW) {
    expect((await post("/signup", { email, password })).status).toBe(202);
    const res = await post("/verify-email", { email, code: await lastCode(email) });
    expect(res.status).toBe(200);
    return cookieOf(res)!;
  }
  return { ...ctx, mail, post, cookieOf, lastCode, register };
}

describe("passwords", () => {
  it("are stored as salted scrypt hashes and checked in constant time", async () => {
    const a = await hashPassword(PW);
    const b = await hashPassword(PW);
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(a).not.toBe(b); // different salt each time
    expect(a).not.toContain(PW);
    expect(await verifyPassword(PW, a)).toBe(true);
    expect(await verifyPassword("correct horse batterY", a)).toBe(false);
    expect(await verifyPassword(PW, "garbage")).toBe(false);
  });

  it("must be long, not common, and not the email name", () => {
    expect(passwordProblem("short", "a@x.co")).toMatch(/at least 10/);
    expect(passwordProblem("password123", "a@x.co")).toMatch(/easy to guess/);
    expect(passwordProblem("aaaaaaaaaaaa", "a@x.co")).toMatch(/easy to guess/);
    expect(passwordProblem("prateek-is-great", "prateek@x.co")).toMatch(/email name/);
    expect(passwordProblem(PW, "a@x.co")).toBeNull();
  });
});

describe("sign up, confirm the email, sign in", () => {
  it("creates the account, emails a 6-digit code, and signs in once it's confirmed", async () => {
    const { post, lastCode, cookieOf, mail } = await setup();
    const res = await post("/signup", { email: "Ann@Example.com", password: PW });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ next: "verify", email: "ann@example.com" });
    const code = await lastCode("ann@example.com");
    expect(code).toMatch(/^\d{6}$/);
    expect(mail.sent.at(-1)!.subject).toBe(`${code} is your Vendor Street code`);

    // Not confirmed yet: the right password still doesn't sign in, and a fresh code goes out
    const early = await post("/login", { email: "ann@example.com", password: PW });
    expect(early.status).toBe(403);
    expect(early.body.needsVerification).toBe(true);

    const verified = await post("/verify-email", { email: "ann@example.com", code: await lastCode("ann@example.com") });
    expect(verified.status).toBe(200);
    const { setCookie } = cookieOf(verified)!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/Domain=\.lvh\.me/);

    const login = await post("/login", { email: "ANN@example.com", password: PW });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe("ann@example.com");
    expect(cookieOf(login)).not.toBeNull();
  });

  it("refuses weak passwords up front", async () => {
    const { post } = await setup();
    const res = await post("/signup", { email: "a@x.co", password: "password123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/easy to guess/);
  });

  it("a code works once, and wrong guesses lock it", async () => {
    const { post, lastCode } = await setup();
    await post("/signup", { email: "a@x.co", password: PW });
    const code = (await lastCode("a@x.co"))!;
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await post("/verify-email", { email: "a@x.co", code: wrong })).body.error).toMatch(/isn't right/);
    expect((await post("/verify-email", { email: "a@x.co", code })).status).toBe(200);
    expect((await post("/verify-email", { email: "a@x.co", code })).body.error).toMatch(/expired or was already used/);

    await post("/signup", { email: "b@x.co", password: PW });
    const right = (await lastCode("b@x.co"))!;
    const bad = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await post("/verify-email", { email: "b@x.co", code: bad });
    const locked = await post("/verify-email", { email: "b@x.co", code: right });
    expect(locked.status).toBe(429);
    expect((await post("/resend-code", { email: "b@x.co" })).status).toBe(202); // a new code starts over
    expect((await post("/verify-email", { email: "b@x.co", code: await lastCode("b@x.co") })).status).toBe(200);
  });

  it("codes expire after 15 minutes", async () => {
    const { post, lastCode } = await setup();
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    try {
      await post("/signup", { email: "a@x.co", password: PW });
      const code = await lastCode("a@x.co");
      vi.setSystemTime(Date.now() + 16 * 60_000);
      expect((await post("/verify-email", { email: "a@x.co", code })).body.error).toMatch(/expired/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("wrong email and wrong password look identical, so sign-in can't reveal who has an account", async () => {
    const { post, register } = await setup();
    await register("known@x.co");
    const badPw = await post("/login", { email: "known@x.co", password: "not the password" });
    const noUser = await post("/login", { email: "nobody@x.co", password: "not the password" });
    expect(badPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(badPw.body).toEqual(noUser.body);
  });

  it("signing up again with a confirmed email never changes its password; the owner is told instead", async () => {
    const { post, register, mail, emailsSettled } = await setup();
    await register("ann@x.co");
    const again = await post("/signup", { email: "ann@x.co", password: "attacker password!" });
    expect(again.status).toBe(202); // same answer as a new sign-up
    await emailsSettled();
    expect(mail.sent.at(-1)!.subject).toBe("You already have a Vendor Street account");
    expect((await post("/login", { email: "ann@x.co", password: "attacker password!" })).status).toBe(401);
    expect((await post("/login", { email: "ann@x.co", password: PW })).status).toBe(200);
  });

  it("locks an account for the hour after 10 wrong passwords, even with the right one", async () => {
    const { post, register } = await setup();
    await register("a@x.co");
    for (let i = 0; i < 10; i++) await post("/login", { email: "a@x.co", password: `wrong guess ${i}` });
    const res = await post("/login", { email: "a@x.co", password: PW });
    expect(res.status).toBe(429);
  });

  it("limits how many emails one address can be sent", async () => {
    const { post } = await setup();
    for (let i = 0; i < 5; i++) expect((await post("/forgot", { email: "a@x.co" })).status).toBe(202);
    expect((await post("/forgot", { email: "a@x.co" })).status).toBe(429);
  });
});

describe("forgot password", () => {
  it("a code by email sets a new password and signs out every other device", async () => {
    const { app, post, lastCode, register, cookieOf } = await setup();
    const laptop = await register("a@x.co");
    expect((await request(app).get("/api/auth/me").set("Cookie", laptop.cookie)).status).toBe(200);

    expect((await post("/forgot", { email: "a@x.co" })).status).toBe(202);
    const code = await lastCode("a@x.co");
    const reset = await post("/reset", { email: "a@x.co", code, password: "a brand new passphrase" });
    expect(reset.status).toBe(200);
    expect(cookieOf(reset)).not.toBeNull(); // this browser is signed in
    expect((await request(app).get("/api/auth/me").set("Cookie", laptop.cookie)).status).toBe(401); // the other one isn't
    expect((await post("/login", { email: "a@x.co", password: PW })).status).toBe(401);
    expect((await post("/login", { email: "a@x.co", password: "a brand new passphrase" })).status).toBe(200);
  });

  it("answers the same for unknown emails, and sets a first password on accounts that never had one", async () => {
    const { post, lastCode, repos } = await (async () => {
      const s = await setup();
      return { ...s, repos: s.deps.repos };
    })();
    const known = await post("/forgot", { email: "nobody@x.co" });
    expect(known.status).toBe(202);
    // an account created before passwords existed
    await repos.users.upsertByEmail("old@x.co");
    await post("/forgot", { email: "old@x.co" });
    const res = await post("/reset", { email: "old@x.co", code: await lastCode("old@x.co"), password: "first real password" });
    expect(res.status).toBe(200);
    expect((await post("/login", { email: "old@x.co", password: "first real password" })).status).toBe(200);
  });
});

describe("sessions and businesses", () => {
  it("me and sign out", async () => {
    const { app, register } = await setup();
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    const { cookie } = await register("a@x.co");
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).body.user.email).toBe("a@x.co");
    const out = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(out.status).toBe(204);
    expect(String(out.headers["set-cookie"])).toMatch(/Max-Age=0/);
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("a confirmed account creates a real business and runs it without any API key", async () => {
    const { app, register } = await setup();
    const { cookie } = await register("joe@joesplumbing.test");
    const created = await request(app).post("/api/auth/businesses").set(fromApex(cookie)).send({ name: "Joe's Plumbing", taxRateBps: 875 });
    expect(created.status).toBe(201);
    expect(created.body.business).toMatchObject({ subdomain: "joes-plumbing", role: "owner", dashboardUrl: `https://joes-plumbing.${APEX}/app` });
    const host = `joes-plumbing.${APEX}`;
    const settings = await request(app).get("/api/settings").set({ Host: host, Cookie: cookie });
    expect(settings.body.settings.ownerEmail).toBe("joe@joesplumbing.test");
    expect((await request(app).put("/api/price-list").set({ Host: host, Cookie: cookie, ...origin(host) }).send([{ sku: "SVC", name: "Service call", unitPriceCents: 8900 }])).status).toBe(200);
  });

  it("someone else's business is off limits, and other sites can't act with your cookie", async () => {
    const { app, register } = await setup();
    const joe = await register("joe@x.co");
    const ann = await register("ann@x.co");
    await request(app).post("/api/auth/businesses").set(fromApex(joe.cookie)).send({ name: "Joe Co" });
    const host = `joe-co.${APEX}`;
    const denied = await request(app).get("/api/leads").set({ Host: host, Cookie: ann.cookie });
    expect(denied.status).toBe(403);
    expect((await request(app).put("/api/price-list").set({ Host: host, Cookie: joe.cookie, ...origin(`evil.${APEX}`) }).send([])).status).toBe(403);
    expect((await request(app).put("/api/price-list").set({ Host: host, Cookie: joe.cookie }).send([])).status).toBe(403);
    expect((await request(app).put("/api/price-list").set({ Host: host, Cookie: joe.cookie, ...origin(host) }).send([])).status).toBe(200);
  });

  it("API keys keep working, and a wrong key is refused even with a valid cookie", async () => {
    const { app, register } = await setup();
    const joe = await register("joe@x.co");
    const created = await request(app).post("/api/auth/businesses").set(fromApex(joe.cookie)).send({ name: "Joe Co" });
    const host = `joe-co.${APEX}`;
    expect((await request(app).get("/api/leads").set({ Host: host, Authorization: `Bearer ${created.body.apiKey}` })).status).toBe(200);
    expect((await request(app).get("/api/leads").set({ Host: host, Cookie: joe.cookie, Authorization: "Bearer sk_wrong_key_000000000000" })).status).toBe(403);
  });

  it("refuses reserved or taken addresses, other origins, and more than the allowed number", async () => {
    const { app, register } = await setup();
    const { cookie } = await register("a@x.co");
    const create = (body: object, o = origin(APEX)) => request(app).post("/api/auth/businesses").set({ Host: APEX, Cookie: cookie, ...o }).send(body);
    expect((await create({ name: "Chase" })).status).toBe(400);
    expect((await create({ name: "Anything", subdomain: "demo-abc123" })).status).toBe(400);
    expect((await create({ name: "Fine Name" }, origin("evil.example"))).status).toBe(403);
    const other = await register("b@x.co");
    await request(app).post("/api/auth/businesses").set(fromApex(other.cookie)).send({ name: "Taken Name" });
    const taken = await create({ name: "Taken Name" });
    expect(taken.status).toBe(409);
    for (let i = 0; i < MAX_BUSINESSES_PER_USER; i++) expect((await create({ name: `Shop ${i}` })).status).toBe(201);
    expect((await create({ name: "One Too Many" })).status).toBe(400);
  });

  it("the admin route still creates businesses for tests and the admin", async () => {
    const { app } = await setup();
    await signUp(app, { name: "Legacy Biz" });
  });
});
