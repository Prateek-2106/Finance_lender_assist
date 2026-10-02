import request from "supertest";
import { makeApp, signUp, BASE } from "../helpers/app";
import { HostnameSchema, TXT_PREFIX } from "../../src/routes/domains";
import type { DnsResolver } from "../../src/deps";

/** A DNS zone we control: name → TXT records (each record may be split into chunks). */
function fakeDns(zone: Record<string, string[][]> = {}, fail?: string): DnsResolver & { zone: typeof zone } {
  return {
    zone,
    async resolveTxt(name) {
      if (fail) throw Object.assign(new Error(fail), { code: fail });
      if (!zone[name]) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
      return zone[name]!;
    },
    async resolveCname() {
      return [];
    },
  };
}

async function setup(dns = fakeDns()) {
  const ctx = makeApp({ dns });
  const joe = await signUp(ctx.app, { name: "Joe's Plumbing" });
  const ana = await signUp(ctx.app, { name: "Ana's Salon" });
  const as = (w: typeof joe) => ({ Host: w.host, Authorization: `Bearer ${w.apiKey}` });
  return { ...ctx, dns, joe, ana, as };
}

describe("HostnameSchema", () => {
  it.each(["joesplumbing.com", "WWW.JoesPlumbing.com.", "shop.joes-plumbing.co.uk"])("accepts %s", (h) =>
    expect(HostnameSchema.safeParse(h).success).toBe(true),
  );
  it.each(["localhost", "joes plumbing.com", "-joe.com", "joe-.com", "192.168.1.1", "joe.com:8080", "http://joe.com", "joe.123"])("rejects %s", (h) =>
    expect(HostnameSchema.safeParse(h).success).toBe(false),
  );
});

describe("customer-owned domains", () => {
  it("adding a domain returns the DNS records to create", async () => {
    const { app, joe, as } = await setup();
    const res = await request(app).post("/api/domains").set(as(joe)).send({ hostname: "WWW.JoesPlumbing.com" });
    expect(res.status).toBe(201);
    const { domain } = res.body;
    expect(domain).toMatchObject({ hostname: "www.joesplumbing.com", status: "pending" });
    expect(domain.records[0]).toMatchObject({ type: "TXT", name: `${TXT_PREFIX}.www.joesplumbing.com` });
    expect(domain.records[0].value).toMatch(/^mainstreet-verify=[0-9a-f]{32}$/);
    expect(domain.records[1]).toMatchObject({ type: "CNAME", value: `joes-plumbing.${BASE}` });
  });

  it("a pending domain does not serve the site; verifying it does", async () => {
    const { app, joe, as, dns } = await setup();
    const { body } = await request(app).post("/api/domains").set(as(joe)).send({ hostname: "joesplumbing.com" });
    expect((await request(app).get("/api/site").set("Host", "joesplumbing.com")).status).toBe(404);

    // the customer adds the TXT record; providers often split long values into chunks
    const value: string = body.domain.records[0].value;
    dns.zone[`${TXT_PREFIX}.joesplumbing.com`] = [["v=spf1 -all"], [value.slice(0, 20), value.slice(20)]];
    const v = await request(app).post("/api/domains/verify").set(as(joe));
    expect(v.status).toBe(200);
    expect(v.body.domain.status).toBe("verified");

    const site = await request(app).get("/api/site").set("Host", "joesplumbing.com");
    expect(site.body.site.name).toBe("Joe's Plumbing");
  });

  it("verification fails clearly when the record is missing or wrong", async () => {
    const { app, joe, as, dns } = await setup();
    await request(app).post("/api/domains").set(as(joe)).send({ hostname: "joesplumbing.com" });
    const missing = await request(app).post("/api/domains/verify").set(as(joe));
    expect(missing.status).toBe(422);
    expect(missing.body.error).toMatch(/No TXT record found/);

    dns.zone[`${TXT_PREFIX}.joesplumbing.com`] = [["mainstreet-verify=someone-elses-token"]];
    const wrong = await request(app).post("/api/domains/verify").set(as(joe));
    expect(wrong.status).toBe(422);
    expect(wrong.body.found).toEqual(["mainstreet-verify=someone-elses-token"]);
  });

  it("a DNS outage is a 503, not a failed verification", async () => {
    const { app, joe, as } = await setup(fakeDns({}, "ETIMEOUT"));
    await request(app).post("/api/domains").set(as(joe)).send({ hostname: "joesplumbing.com" });
    expect((await request(app).post("/api/domains/verify").set(as(joe))).status).toBe(503);
  });

  it("one domain, one business; the platform's own domain can't be claimed", async () => {
    const { app, joe, ana, as } = await setup();
    await request(app).post("/api/domains").set(as(joe)).send({ hostname: "joesplumbing.com" });
    expect((await request(app).post("/api/domains").set(as(ana)).send({ hostname: "joesplumbing.com" })).status).toBe(409);
    expect((await request(app).post("/api/domains").set(as(ana)).send({ hostname: `evil.${BASE}` })).status).toBe(422);
    expect((await request(app).post("/api/domains").set(as(ana)).send({ hostname: BASE })).status).toBe(422);
  });

  it("removing a domain stops it serving and frees it", async () => {
    const { app, joe, ana, as, dns } = await setup();
    const { body } = await request(app).post("/api/domains").set(as(joe)).send({ hostname: "joesplumbing.com" });
    dns.zone[`${TXT_PREFIX}.joesplumbing.com`] = [[body.domain.records[0].value]];
    await request(app).post("/api/domains/verify").set(as(joe));
    expect((await request(app).delete("/api/domains").set(as(joe))).status).toBe(204);
    expect((await request(app).get("/api/site").set("Host", "joesplumbing.com")).status).toBe(404);
    expect((await request(app).post("/api/domains").set(as(ana)).send({ hostname: "joesplumbing.com" })).status).toBe(201);
  });

  it("is owner-only", async () => {
    const { app, joe } = await setup();
    expect((await request(app).post("/api/domains").set("Host", joe.host).send({ hostname: "x.com" })).status).toBe(401);
  });
});
