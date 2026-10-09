import { MongoServerError, ObjectId, type Collection, type Db, type Document } from "mongodb";
import type { BankTransaction, Customer, EmailCode, Estimate, Membership, Session, User, FundingApplication, Invoice, Lead, Message, Tenant } from "../domain";
import { ConflictError, NotFoundError } from "../errors";
import type { Repos } from "./types";

type Doc<T extends { id: string }> = Omit<T, "id"> & { _id: string };
const toDoc = <T extends { id: string }>({ id, ...rest }: T): Doc<T> => ({ _id: id, ...rest }) as Doc<T>;
const fromDoc = <T extends { id: string }>(d: Doc<T> | null): T | null => {
  if (!d) return null;
  const { _id, ...rest } = d;
  return { id: _id, ...rest } as unknown as T;
};
const newId = () => new ObjectId().toHexString(); // time-ordered → stable "newest first"

/** { a: 1, b: undefined } → { $set: { a: 1 }, $unset: { b: "" } }: undefined means "remove the field". */
function toUpdate(patch: Record<string, unknown>) {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ""> = {};
  for (const [k, v] of Object.entries(patch)) v === undefined ? ($unset[k] = "") : ($set[k] = v);
  return { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) };
}

async function translateDup<T>(p: Promise<T>, msg: string): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) throw new ConflictError(msg);
    throw e;
  }
}

export async function createMongoRepos(db: Db): Promise<Repos> {
  const tenants = db.collection<Doc<Tenant>>("tenants");
  const leads = db.collection<Doc<Lead>>("leads");
  const estimates = db.collection<Doc<Estimate>>("estimates");
  const invoices = db.collection<Doc<Invoice>>("invoices");
  const counters = db.collection<{ _id: string; seq: number }>("counters");
  const applications = db.collection<Doc<FundingApplication>>("applications");
  const txns = db.collection<Doc<BankTransaction>>("transactions");
  const customers = db.collection<Doc<Customer>>("customers");
  const messages = db.collection<Doc<Message>>("messages");
  const users = db.collection<Doc<User>>("users");
  const memberships = db.collection<Membership & { _id: string }>("memberships");
  const emailCodes = db.collection<EmailCode & { _id: string }>("email_codes");
  const sessions = db.collection<Omit<Session, "idHash"> & { _id: string }>("sessions");

  await Promise.all([
    tenants.createIndex({ subdomain: 1 }, { unique: true }),
    tenants.createIndex(
      { "customDomain.hostname": 1 },
      { unique: true, partialFilterExpression: { "customDomain.hostname": { $exists: true } } },
    ),
    leads.createIndex({ tenantId: 1, createdAt: -1, _id: -1 }),
    users.createIndex({ email: 1 }, { unique: true }),
    memberships.createIndex({ userId: 1 }),
    // Expired sign-in links and sessions delete themselves (Mongo checks about once a minute;
    // reads also check expiresAt, so nothing expired is ever accepted in between).
    emailCodes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    sessions.createIndex({ userId: 1 }),
    tenants.createIndex({ "demo.expiresAt": 1 }, { partialFilterExpression: { "demo.expiresAt": { $exists: true } } }),
    estimates.createIndex({ tenantId: 1, _id: 1 }),
    estimates.createIndex({ tenantId: 1, leadId: 1, status: 1 }),
    invoices.createIndex({ tenantId: 1, estimateId: 1 }, { unique: true }),
    invoices.createIndex({ tenantId: 1, number: 1 }, { unique: true }),
    applications.createIndex({ tenantId: 1, _id: 1 }),
    txns.createIndex({ applicationId: 1, fingerprint: 1 }, { unique: true }),
    txns.createIndex({ tenantId: 1, applicationId: 1, date: 1, _id: 1 }),
    applications.createIndex({ "decision.outcome": 1, _id: 1 }),
    invoices.createIndex({ tenantId: 1, _id: -1 }),
    customers.createIndex({ tenantId: 1, email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } }),
    customers.createIndex({ tenantId: 1, phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: "string" } } }),
    customers.createIndex({ tenantId: 1, lastSeenAt: -1 }),
    messages.createIndex({ tenantId: 1, _id: -1 }),
    // The admin page's per-day counts
    leads.createIndex({ createdAt: 1 }),
    messages.createIndex({ createdAt: 1, status: 1 }),
  ]);

  /** { "2026-10-06": 3, ... } for the documents matching `match`, by UTC day of createdAt. */
  async function perDay(coll: Pick<Collection<Document>, "aggregate">, match: Document) {
    const rows = (await coll
      .aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } }, n: { $sum: 1 } } }])
      .toArray()) as { _id: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r._id, r.n]));
  }

  return {
    tenants: {
      async listExpiredDemos(now, opts = {}) {
        const docs = await tenants.find({ "demo.expiresAt": { $lt: now } }).sort({ "demo.expiresAt": 1 }).limit(opts.limit ?? 100).toArray();
        return docs.map((d) => fromDoc(d)!);
      },
      async create(input) {
        const t: Tenant = { ...input, id: newId(), createdAt: new Date() };
        await translateDup(tenants.insertOne(toDoc(t)), "Subdomain or hostname is taken");
        return t;
      },
      async findById(id) {
        return fromDoc(await tenants.findOne({ _id: id }));
      },
      async findBySubdomain(subdomain) {
        return fromDoc(await tenants.findOne({ subdomain }));
      },
      async findByCustomDomain(hostname) {
        return fromDoc(await tenants.findOne({ "customDomain.hostname": hostname }));
      },
      async update(id, patch) {
        const d = await translateDup(
          tenants.findOneAndUpdate({ _id: id }, toUpdate(patch), { returnDocument: "after" }),
          "Subdomain or hostname is taken",
        );
        if (!d) throw new NotFoundError("Tenant not found");
        return fromDoc(d)!;
      },
    },
    leads: {
      async create(input) {
        const l: Lead = { ...input, id: newId(), createdAt: input.createdAt ?? new Date() };
        await leads.insertOne(toDoc(l));
        return l;
      },
      async findById(tenantId, id) {
        return fromDoc(await leads.findOne({ _id: id, tenantId }));
      },
      async listByTenant(tenantId, opts = {}) {
        const docs = await leads
          .find({ tenantId })
          .sort({ createdAt: -1, _id: -1 })
          .limit(opts.limit ?? 50)
          .toArray();
        return docs.map((d) => fromDoc(d)!);
      },
    },
    estimates: {
      async create(input) {
        const e: Estimate = { ...input, id: newId(), createdAt: input.createdAt ?? new Date() };
        await estimates.insertOne(toDoc(e));
        return e;
      },
      async findById(tenantId, id) {
        return fromDoc(await estimates.findOne({ _id: id, tenantId }));
      },
      async listByTenant(tenantId, opts = {}) {
        const docs = await estimates.find({ tenantId }).sort({ _id: -1 }).limit(opts.limit ?? 50).toArray();
        return docs.map((d) => fromDoc(d)!);
      },
      async findOpenByLead(tenantId, leadId) {
        const d = await estimates.find({ tenantId, leadId, status: { $in: ["needs_review", "draft"] } }).sort({ _id: -1 }).limit(1).next();
        return fromDoc(d);
      },
      async update(tenantId, id, patch) {
        const d = await estimates.findOneAndUpdate({ _id: id, tenantId }, { $set: patch }, { returnDocument: "after" });
        if (!d) throw new NotFoundError("Estimate not found");
        return fromDoc(d)!;
      },
    },
    invoices: {
      async create(input) {
        const i: Invoice = { ...input, id: newId(), createdAt: input.createdAt ?? new Date() };
        await translateDup(invoices.insertOne(toDoc(i)), "Invoice already exists for this estimate");
        return i;
      },
      async findById(tenantId, id) {
        return fromDoc(await invoices.findOne({ _id: id, tenantId }));
      },
      async findByEstimate(tenantId, estimateId) {
        return fromDoc(await invoices.findOne({ tenantId, estimateId }));
      },
      async update(tenantId, id, patch) {
        const d = await invoices.findOneAndUpdate({ _id: id, tenantId }, { $set: patch }, { returnDocument: "after" });
        if (!d) throw new NotFoundError("Invoice not found");
        return fromDoc(d)!;
      },
      async listByTenant(tenantId, opts = {}) {
        const docs = await invoices.find({ tenantId }).sort({ _id: -1 }).limit(opts.limit ?? 50).toArray();
        return docs.map((d) => fromDoc(d)!);
      },
      async nextNumber(tenantId) {
        const c = await counters.findOneAndUpdate(
          { _id: `invoice:${tenantId}` },
          { $inc: { seq: 1 } },
          { upsert: true, returnDocument: "after" },
        );
        return `INV-${String(c!.seq).padStart(4, "0")}`;
      },
    },
    applications: {
      async create(input) {
        const a: FundingApplication = { ...input, id: newId(), createdAt: new Date() };
        await applications.insertOne(toDoc(a));
        return a;
      },
      async findById(tenantId, id) {
        return fromDoc(await applications.findOne({ _id: id, tenantId }));
      },
      async listByTenant(tenantId, opts = {}) {
        const docs = await applications.find({ tenantId }).sort({ _id: -1 }).limit(opts.limit ?? 50).toArray();
        return docs.map((d) => fromDoc(d)!);
      },
      async listByOutcome(outcome, opts = {}) {
        const docs = await applications
          .find({ "decision.outcome": outcome })
          .sort({ _id: outcome === "pending_review" ? 1 : -1 })
          .limit(opts.limit ?? 50)
          .toArray();
        return docs.map((d) => fromDoc(d)!);
      },
      async findByIdAnyTenant(id) {
        return fromDoc(await applications.findOne({ _id: id }));
      },
      async update(tenantId, id, patch) {
        const d = await applications.findOneAndUpdate({ _id: id, tenantId }, { $set: patch }, { returnDocument: "after" });
        if (!d) throw new NotFoundError("Application not found");
        return fromDoc(d)!;
      },
    },
    transactions: {
      async insertMany(lines) {
        if (lines.length === 0) return { inserted: 0, duplicates: 0 };
        const now = new Date();
        // Upsert keyed on (applicationId, fingerprint): existing lines are left untouched.
        const r = await txns.bulkWrite(
          lines.map((l) => ({
            updateOne: {
              filter: { applicationId: l.applicationId, fingerprint: l.fingerprint },
              update: { $setOnInsert: { _id: newId(), ...l, createdAt: now } },
              upsert: true,
            },
          })),
          { ordered: false },
        );
        return { inserted: r.upsertedCount, duplicates: lines.length - r.upsertedCount };
      },
      async listByApplication(tenantId, applicationId, opts = {}) {
        const q: Record<string, unknown> = { tenantId, applicationId };
        if (opts.category) q.category = opts.category;
        const docs = await txns.find(q).sort({ date: 1, _id: 1 }).toArray();
        return docs.map((d) => fromDoc(d)!);
      },
    },
    customers: {
      async upsertByContact(tenantId, c) {
        const or = [...(c.email ? [{ email: c.email }] : []), ...(c.phone ? [{ phone: c.phone }] : [])];
        const now = new Date();
        if (or.length) {
          const d = await customers.findOneAndUpdate(
            { tenantId, $or: or },
            { $set: { ...(c.name ? { name: c.name } : {}), ...(c.email ? { email: c.email } : {}), ...(c.phone ? { phone: c.phone } : {}), lastSeenAt: now }, $inc: { leadCount: 1 } },
            { returnDocument: "after" },
          );
          if (d) return fromDoc(d)!;
        }
        const created: Customer = { id: newId(), tenantId, ...c, name: c.name ?? c.phone ?? c.email ?? "Customer", leadCount: 1, createdAt: now, lastSeenAt: now };
        try {
          await customers.insertOne(toDoc(created));
          return created;
        } catch (e) {
          // a concurrent request created them first: count this visit on that record
          if (e instanceof MongoServerError && e.code === 11000) return this.upsertByContact(tenantId, c);
          throw e;
        }
      },
      async findById(tenantId, id) {
        return fromDoc(await customers.findOne({ _id: id, tenantId }));
      },
      async listByTenant(tenantId, opts = {}) {
        const docs = await customers.find({ tenantId }).sort({ lastSeenAt: -1 }).limit(opts.limit ?? 50).toArray();
        return docs.map((d) => fromDoc(d)!);
      },
    },
    messages: {
      async create(input) {
        const msg: Message = { ...input, id: newId(), createdAt: new Date() };
        await messages.insertOne(toDoc(msg));
        return msg;
      },
      async setStatus(id, status, extra = {}) {
        await messages.updateOne({ _id: id }, { $set: { status, ...extra } });
      },
      async findById(tenantId, id) {
        return fromDoc(await messages.findOne({ _id: id, tenantId }));
      },
      async listByTenant(tenantId, opts = {}) {
        const docs = await messages.find({ tenantId }).sort({ _id: -1 }).limit(opts.limit ?? 50).toArray();
        return docs.map((d) => fromDoc(d)!);
      },
    },
    users: {
      async upsertByEmail(raw) {
        const email = raw.trim().toLowerCase();
        const upsert = () =>
          users.findOneAndUpdate(
            { email },
            { $setOnInsert: { _id: newId(), email, createdAt: new Date() } },
            { upsert: true, returnDocument: "after", includeResultMetadata: true },
          );
        try {
          const r = await upsert();
          return { user: fromDoc(r.value)!, created: !r.lastErrorObject?.updatedExisting };
        } catch (e) {
          // two first-time sign-ins at once: the unique index lets one win; the other just reads it
          if (e instanceof MongoServerError && e.code === 11000) return { user: fromDoc(await users.findOne({ email }))!, created: false };
          throw e;
        }
      },
      async findById(id) {
        return fromDoc(await users.findOne({ _id: id }));
      },
      async findByEmail(raw) {
        return fromDoc(await users.findOne({ email: raw.trim().toLowerCase() }));
      },
      async update(id, patch) {
        const d = await users.findOneAndUpdate({ _id: id }, toUpdate(patch), { returnDocument: "after" });
        if (!d) throw new NotFoundError("User not found");
        return fromDoc(d)!;
      },
    },
    memberships: {
      async add(input) {
        const _id = `${input.userId}:${input.tenantId}`;
        await memberships.updateOne({ _id }, { $setOnInsert: { ...input, createdAt: new Date() } }, { upsert: true });
        const { _id: _omit, ...m } = (await memberships.findOne({ _id }))!;
        return m;
      },
      async find(userId, tenantId) {
        const d = await memberships.findOne({ _id: `${userId}:${tenantId}` });
        if (!d) return null;
        const { _id: _omit, ...m } = d;
        return m;
      },
      async listByUser(userId) {
        return (await memberships.find({ userId }).sort({ createdAt: 1 }).toArray()).map(({ _id: _omit, ...m }) => m);
      },
    },
    emailCodes: {
      async issue(input) {
        const _id = `${input.purpose}:${input.email}`;
        await emailCodes.replaceOne({ _id }, { ...input, attempts: 0, createdAt: new Date() }, { upsert: true });
      },
      async attempt(email, purpose, codeHash, now, max) {
        const _id = `${purpose}:${email}`;
        // Count the guess first, and only while under the limit: parallel guesses can't sneak past it.
        const c = await emailCodes.findOneAndUpdate(
          { _id, usedAt: { $exists: false }, expiresAt: { $gt: now }, attempts: { $lt: max } },
          { $inc: { attempts: 1 } },
          { returnDocument: "after" },
        );
        if (!c) {
          const d = await emailCodes.findOne({ _id });
          return !d || d.usedAt || d.expiresAt <= now ? "expired" : "locked";
        }
        if (c.codeHash !== codeHash) return "wrong";
        const used = await emailCodes.updateOne({ _id, usedAt: { $exists: false } }, { $set: { usedAt: now } });
        return used.modifiedCount === 1 ? "ok" : "expired";
      },
    },
    sessions: {
      async create({ idHash, ...rest }) {
        const s = { ...rest, createdAt: new Date() };
        await sessions.insertOne({ _id: idHash, ...s });
        return { idHash, ...s };
      },
      async find(idHash, now) {
        const d = await sessions.findOne({ _id: idHash, expiresAt: { $gt: now } });
        if (!d) return null;
        const { _id, ...rest } = d;
        return { idHash: _id, ...rest };
      },
      async delete(idHash) {
        await sessions.deleteOne({ _id: idHash });
      },
      async deleteByUser(userId, except) {
        await sessions.deleteMany({ userId, ...(except ? { _id: { $ne: except } } : {}) });
      },
    },
    async ping() {
      await db.command({ ping: 1 });
    },
    stats: {
      async overview(since) {
        const demoIds = (await tenants.find({ "demo.expiresAt": { $exists: true } }, { projection: { _id: 1 } }).toArray()).map((t) => t._id);
        const after = { createdAt: { $gte: since } };
        const [total, confirmed, real, signups, businesses, newLeads, emailsSent, emailsFailed] = await Promise.all([
          users.countDocuments(),
          users.countDocuments({ emailVerifiedAt: { $exists: true } }),
          tenants.countDocuments({ "demo.expiresAt": { $exists: false } }),
          perDay(users, after),
          perDay(tenants, { ...after, "demo.expiresAt": { $exists: false } }),
          perDay(leads, { ...after, tenantId: { $nin: demoIds } }),
          perDay(messages, { ...after, status: "sent" }),
          perDay(messages, { ...after, status: "failed" }),
        ]);
        return {
          users: { total, confirmed },
          businesses: { real, demosLive: demoIds.length },
          daily: { signups, businesses, leads: newLeads, emailsSent, emailsFailed },
        };
      },
    },
    async purgeTenant(tenantId) {
      // Children first, the tenant last: an interrupted purge leaves a tenant to retry, never orphans.
      await Promise.all([leads, estimates, invoices, applications, txns, customers, messages].map((c) => (c as typeof leads).deleteMany({ tenantId })));
      await counters.deleteOne({ _id: `invoice:${tenantId}` });
      await memberships.deleteMany({ tenantId });
      await tenants.deleteOne({ _id: tenantId });
    },
    usage: {
      async increment(key, by = 1) {
        const c = await counters.findOneAndUpdate({ _id: `usage:${key}` }, { $inc: { seq: by } }, { upsert: true, returnDocument: "after" });
        return c!.seq;
      },
      async peek(key) {
        return (await counters.findOne({ _id: `usage:${key}` }))?.seq ?? 0;
      },
    },
  };
}
