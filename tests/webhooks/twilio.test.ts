import request from "supertest";
import { computeTwilioSignature, verifyTwilioSignature, twimlMessage, escapeXml } from "../../src/webhooks/twilio";
import { makeApp, signUp } from "../helpers/app";

describe("computeTwilioSignature", () => {
  it("matches Twilio's documented example", () => {
    // https://www.twilio.com/docs/usage/webhooks/webhooks-security
    const params = {
      CallSid: "CA1234567890ABCDE",
      Caller: "+12349013030",
      Digits: "1234",
      From: "+12349013030",
      To: "+18005551212",
    };
    expect(computeTwilioSignature("12345", "https://mycompany.com/myapp.php?foo=1&bar=2", params)).toBe(
      "0/KCTR6DLpKmkAf8muzZqo1nDgQ=",
    );
  });
  it("is independent of the order params arrive in", () => {
    const a = computeTwilioSignature("t", "https://x", { B: "2", A: "1" });
    const b = computeTwilioSignature("t", "https://x", { A: "1", B: "2" });
    expect(a).toBe(b);
  });
});

describe("verifyTwilioSignature", () => {
  const url = "https://hooks.example.com/webhooks/sms/abc";
  const params = { From: "+17165550123", Body: "hi" };
  const sig = computeTwilioSignature("tok", url, params);
  it("accepts a valid signature", () => expect(verifyTwilioSignature("tok", url, params, sig)).toBe(true));
  it("rejects tampering, wrong token, wrong url, and missing signature", () => {
    expect(verifyTwilioSignature("tok", url, { ...params, Body: "hacked" }, sig)).toBe(false);
    expect(verifyTwilioSignature("other", url, params, sig)).toBe(false);
    expect(verifyTwilioSignature("tok", url + "x", params, sig)).toBe(false);
    expect(verifyTwilioSignature("tok", url, params, undefined)).toBe(false);
    expect(verifyTwilioSignature("tok", url, params, "short")).toBe(false);
  });
  it("fails closed when no auth token is configured", () => {
    expect(verifyTwilioSignature("", url, params, computeTwilioSignature("", url, params))).toBe(false);
  });
});

describe("TwiML", () => {
  it("escapes XML special characters", () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;");
  });
  it("wraps a reply in a Response/Message document", () => {
    expect(twimlMessage("Hi & bye")).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Hi &amp; bye</Message></Response>',
    );
  });
});

describe("POST /webhooks/sms/:tenantId", () => {
  async function setup() {
    const ctx = makeApp();
    const joe = await signUp(ctx.app, { name: "Joe's Plumbing" });
    const path = `/webhooks/sms/${joe.tenant.id}`;
    const send = (params: Record<string, string>, sig?: string) =>
      request(ctx.app)
        .post(path)
        .type("form")
        .set("X-Twilio-Signature", sig ?? computeTwilioSignature("test-token", `https://hooks.example.com${path}`, params))
        .send(params);
    return { ...ctx, joe, send, path };
  }
  const sms = { From: "+17165550123", To: "+18005551212", Body: "  Need a quote for a leaky water heater ", MessageSid: "SM1" };

  it("turns a signed SMS into a lead and replies with TwiML", async () => {
    const { send, deps, joe } = await setup();
    const res = await send(sms);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/xml/);
    expect(res.text).toContain("<Response><Message>");
    expect(res.text).toContain("Joe&apos;s Plumbing");
    const [lead] = await deps.repos.leads.listByTenant(joe.tenant.id);
    expect(lead).toMatchObject({ phone: "+17165550123", message: "Need a quote for a leaky water heater", source: "sms" });
  });
  it("rejects unsigned / forged requests with 403 and creates nothing", async () => {
    const { send, deps, joe } = await setup();
    expect((await send(sms, "forged")).status).toBe(403);
    expect(await deps.repos.leads.listByTenant(joe.tenant.id)).toHaveLength(0);
  });
  it("404s for an unknown tenant (after verifying the signature)", async () => {
    const { app } = await setup();
    const path = "/webhooks/sms/nope";
    const res = await request(app)
      .post(path)
      .type("form")
      .set("X-Twilio-Signature", computeTwilioSignature("test-token", `https://hooks.example.com${path}`, sms))
      .send(sms);
    expect(res.status).toBe(404);
  });
  it("400s for an empty body", async () => {
    const { send } = await setup();
    expect((await send({ ...sms, Body: "   " })).status).toBe(400);
  });
});
