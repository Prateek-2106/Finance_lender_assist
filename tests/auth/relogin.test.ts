// Signing out and back in, the way people actually do it on the live site (rate limits on).
import request from "supertest";
import { BASE, fakeMailer, makeApp } from "../helpers/app";
import { SESSION_COOKIE } from "../../src/auth/session";

const PW = "correct horse battery";

async function setup() {
  const mail = fakeMailer();
  // The live site's limits (src/server.ts defaults)
  const config = { ...makeApp().deps.config, rateLimits: { leadsPerHour: 30, demosPerHour: 5, signInsPerHour: 30 } };
  const ctx = makeApp({ mailer: mail.mailer, config });
  const post = (path: string, body: object, cookie?: string) =>
    request(ctx.app).post(`/api/auth${path}`).set({ Host: BASE, ...(cookie ? { Cookie: cookie } : {}) }).send(body);
  const code = async (email: string) => {
    await ctx.emailsSettled();
    return /\b(\d{6})\b/.exec([...mail.sent].reverse().find((m) => m.to === email)?.subject ?? "")?.[1];
  };
  const cookie = (res: request.Response) => ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.split(";")[0];
  return { ...ctx, mail, post, code, cookie };
}

describe("signing back in", () => {
  it("a person can sign up, confirm, and sign out and in many times without hitting a limit", async () => {
    const { post, code, cookie, app } = await setup();
    await post("/signup", { email: "ann@example.com", password: PW });
    let c = cookie(await post("/verify-email", { email: "ann@example.com", code: await code("ann@example.com") }))!;
    for (let i = 0; i < 12; i++) {
      expect((await post("/logout", {}, c)).status).toBe(204);
      if (i % 3 === 0) expect((await post("/login", { email: "ann@example.com", password: "wrong password here" })).status).toBe(401);
      const res = await post("/login", { email: "ann@example.com", password: PW });
      expect(res.status).toBe(200);
      c = cookie(res)!;
      expect((await request(app).get("/api/auth/me").set({ Host: BASE, Cookie: c })).status).toBe(200);
    }
  });

  it("an unconfirmed account with the right password is told so, even after several codes this hour", async () => {
    const { post, mail, emailsSettled } = await setup();
    await post("/signup", { email: "bo@example.com", password: PW });
    for (let i = 0; i < 6; i++) {
      const res = await post("/login", { email: "bo@example.com", password: PW });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ needsVerification: true });
      expect(res.body.error).toMatch(/Your password is right/);
    }
    await emailsSettled();
    // 1 at sign-up + 4 more, then the hourly cap: the answer stays 403 "use the latest code", never a 429
    expect(mail.sent.filter((m) => m.to === "bo@example.com")).toHaveLength(5);
    const last = await post("/login", { email: "bo@example.com", password: PW });
    expect(last.body).toMatchObject({ codeSent: false });
    expect(last.body.error).toMatch(/latest code/);
  });

  it("the wrong password for an unconfirmed account doesn't reveal that it's unconfirmed", async () => {
    const { post } = await setup();
    await post("/signup", { email: "cy@example.com", password: PW });
    const res = await post("/login", { email: "cy@example.com", password: "not the password" });
    expect(res.status).toBe(401);
    expect(res.body.needsVerification).toBeUndefined();
  });

  it("a flood from one address is still stopped", async () => {
    const { post } = await setup();
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await post("/login", { email: `x${i}@example.com`, password: "whatever it is" })).status;
    expect(last).toBe(429);
  });
});
