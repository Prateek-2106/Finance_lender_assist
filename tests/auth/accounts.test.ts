import request from "supertest";
import { BASE, fakeMailer, makeApp, signUp } from "../helpers/app";
import { SESSION_COOKIE } from "../../src/auth/session";
import { MAX_BUSINESSES_PER_USER } from "../../src/routes/auth";

const APEX = BASE; // "lvh.me": the platform's own address
const origin = (host: string) => ({ Origin: `https://${host}` });
/** A request from a page on the platform's own address (where the account page lives). */
const fromApex = (cookie: string) => ({ Host: APEX, Cookie: cookie, ...origin(APEX) });

async function setup() {
  const mail = fakeMailer();
  const ctx = makeApp({ mailer: mail.mailer });
  const { app, emailsSettled } = ctx;

  /** Asks for a link and returns the token from the email, like clicking it would. */
  async function requestLink(email: string, next?: string) {
    const before = mail.sent.length;
    const res = await request(app).post("/api/auth/start").set("Host", APEX).send({ email, ...(next ? { next } : {}) });
    expect(res.status).toBe(202);
    await emailsSettled();
    const msg = mail.sent[before]!;
    const link = /https?:\/\/\S+\/auth\/verify#\S+/.exec(msg.text!)![0];
    const params = new URLSearchParams(link.split("#")[1]);
    return { msg, link, token: params.get("token")!, next: params.get("next") };
  }
  /** Completes sign-in and returns the cookie header to send afterwards. */
  async function signIn(email: string) {
    const { token } = await requestLink(email);
    const res = await request(app).post("/api/auth/verify").set("Host", APEX).send({ token });
    expect(res.status).toBe(200);
    const set = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
    const cookie = set.find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
    return { cookie: cookie.split(";")[0]!, setCookie: cookie, body: res.body };
  }
  return { ...ctx, mail, requestLink, signIn };
}

describe("sign in with an email link", () => {
  it("emails a one-time link; the link signs you in with a secure cookie for every business address", async () => {
    const { requestLink, signIn, mail } = await setup();
    const { msg, link, token } = await requestLink("Ann@Example.com");
    expect(msg.to).toBe("ann@example.com");
    expect(msg.subject).toBe("Your Vendor Street sign-in link");
    expect(link.startsWith(`https://${APEX}/auth/verify#token=`)).toBe(true); // token after '#': never sent to a server
    expect(token.length).toBeGreaterThanOrEqual(40);

    const { setCookie, body } = await signIn("ann@example.com");
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Secure/); // publicUrl is https in tests
    expect(setCookie).toMatch(new RegExp(`Domain=\\.${APEX.replace(".", "\\.")}`));
    expect(body.user.email).toBe("ann@example.com");
    expect(body.businesses).toEqual([]);
    expect(mail.sent).toHaveLength(2);
  });

  it("a link works once, and only for 15 minutes", async () => {
    const { app, requestLink } = await setup();
    const { token } = await requestLink("a@x.co");
    expect((await request(app).post("/api/auth/verify").send({ token })).status).toBe(200);
    const again = await request(app).post("/api/auth/verify").send({ token });
    expect(again.status).toBe(401);
    expect(again.body.error).toMatch(/expired or was already used/);

    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    try {
      const { token: late } = await requestLink("a@x.co");
      vi.setSystemTime(Date.now() + 16 * 60_000);
      expect((await request(app).post("/api/auth/verify").send({ token: late })).status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers the same for any address (no way to find out who has an account), and limits links per address", async () => {
    const { app, signIn } = await setup();
    await signIn("known@x.co");
    const known = await request(app).post("/api/auth/start").send({ email: "known@x.co" });
    const unknown = await request(app).post("/api/auth/start").send({ email: "nobody@x.co" });
    expect(known.body).toEqual(unknown.body);
    for (let i = 0; i < 3; i++) await request(app).post("/api/auth/start").send({ email: "known@x.co" });
    const res = await request(app).post("/api/auth/start").send({ email: "known@x.co" });
    expect(res.status).toBe(429);
  });

  it("only sends you back to this platform's own addresses after signing in", async () => {
    const { requestLink } = await setup();
    expect((await requestLink("a@x.co", `https://joes.${APEX}/app`)).next).toBe(`https://joes.${APEX}/app`);
    expect((await requestLink("b@x.co", "https://evil.example/steal")).next).toBeNull();
    expect((await requestLink("c@x.co", `https://${APEX}.evil.example/`)).next).toBeNull();
  });

  it("me and sign out", async () => {
    const { app, signIn } = await setup();
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    const { cookie } = await signIn("a@x.co");
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).body.user.email).toBe("a@x.co");
    const out = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(out.status).toBe(204);
    expect(String(out.headers["set-cookie"])).toMatch(/Max-Age=0/);
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401); // the session is gone server-side too
  });
});

describe("businesses for a signed-in account", () => {
  it("a verified account creates a real business and runs it without any API key", async () => {
    const { app, signIn } = await setup();
    const { cookie } = await signIn("joe@joesplumbing.test");
    const created = await request(app).post("/api/auth/businesses").set(fromApex(cookie)).send({ name: "Joe's Plumbing", taxRateBps: 875 });
    expect(created.status).toBe(201);
    expect(created.body.business).toMatchObject({ subdomain: "joes-plumbing", role: "owner", dashboardUrl: `https://joes-plumbing.${APEX}/app` });
    expect(created.body.apiKey).toMatch(/^sk_/);

    const host = `joes-plumbing.${APEX}`;
    const settings = await request(app).get("/api/settings").set({ Host: host, Cookie: cookie });
    expect(settings.status).toBe(200);
    expect(settings.body.settings.ownerEmail).toBe("joe@joesplumbing.test"); // emails go to the account's address by default
    const priced = await request(app).put("/api/price-list").set({ Host: host, Cookie: cookie, ...origin(host) }).send([{ sku: "SVC", name: "Service call", unitPriceCents: 8900 }]);
    expect(priced.status).toBe(200);

    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(me.body.businesses.map((b: { name: string }) => b.name)).toEqual(["Joe's Plumbing"]);
  });

  it("a signed-in person can't open someone else's business, and other sites can't act with their cookie", async () => {
    const { app, signIn } = await setup();
    const joe = await signIn("joe@x.co");
    const ann = await signIn("ann@x.co");
    await request(app).post("/api/auth/businesses").set(fromApex(joe.cookie)).send({ name: "Joe Co" });
    const host = `joe-co.${APEX}`;
    const denied = await request(app).get("/api/leads").set({ Host: host, Cookie: ann.cookie });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatch(/doesn't have access/);

    // Joe's own cookie, but the request comes from a page on another business's subdomain
    const forged = await request(app).put("/api/price-list").set({ Host: host, Cookie: joe.cookie, ...origin(`evil.${APEX}`) }).send([]);
    expect(forged.status).toBe(403);
    const noOrigin = await request(app).put("/api/price-list").set({ Host: host, Cookie: joe.cookie }).send([]);
    expect(noOrigin.status).toBe(403);
    const fromBusinessPage = await request(app).put("/api/price-list").set({ Host: host, Cookie: joe.cookie, ...origin(host) }).send([]);
    expect(fromBusinessPage.status).toBe(200);
  });

  it("API keys keep working, and a wrong key is still refused even with a valid cookie", async () => {
    const { app, signIn } = await setup();
    const joe = await signIn("joe@x.co");
    const created = await request(app).post("/api/auth/businesses").set(fromApex(joe.cookie)).send({ name: "Joe Co" });
    const host = `joe-co.${APEX}`;
    expect((await request(app).get("/api/leads").set({ Host: host, Authorization: `Bearer ${created.body.apiKey}` })).status).toBe(200);
    expect((await request(app).get("/api/leads").set({ Host: host, Cookie: joe.cookie, Authorization: "Bearer sk_wrong_key_000000000000" })).status).toBe(403);
  });

  it("refuses reserved or taken addresses, other origins, and more than the allowed number", async () => {
    const { app, signIn } = await setup();
    const { cookie } = await signIn("a@x.co");
    const post = (body: object, o = origin(APEX)) => request(app).post("/api/auth/businesses").set({ Host: APEX, Cookie: cookie, ...o }).send(body);
    expect((await post({ name: "Chase" })).status).toBe(400); // reserved: looks like a bank
    expect((await post({ name: "Anything", subdomain: "demo-abc123" })).status).toBe(400);
    expect((await post({ name: "Anything", subdomain: "support" })).status).toBe(400);
    expect((await post({ name: "Fine Name" }, origin("evil.example"))).status).toBe(403);
    const other = await signIn("b@x.co");
    await request(app).post("/api/auth/businesses").set(fromApex(other.cookie)).send({ name: "Taken Name" });
    const taken = await post({ name: "Taken Name" });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toMatch(/taken/);
    for (let i = 0; i < MAX_BUSINESSES_PER_USER; i++) expect((await post({ name: `Shop ${i}` })).status).toBe(201);
    expect((await post({ name: "One Too Many" })).status).toBe(400);
  });

  it("signing in without an account creates one; there's no separate sign-up", async () => {
    const { signIn } = await setup();
    expect((await signIn("new@x.co")).body.newUser).toBe(true);
    expect((await signIn("new@x.co")).body.newUser).toBe(false);
  });

  it("the old admin route and signUp helper still create businesses for tests and the admin", async () => {
    const { app } = await setup();
    await signUp(app, { name: "Legacy Biz" });
  });
});
