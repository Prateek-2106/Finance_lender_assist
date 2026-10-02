import { MongoServerError, ObjectId, type Db } from "mongodb";
import type { BankTransaction, Estimate, FundingApplication, Invoice, Lead, Tenant } from "../domain";
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

  await Promise.all([
    tenants.createIndex({ subdomain: 1 }, { unique: true }),
    tenants.createIndex(
      { "customDomain.hostname": 1 },
      { unique: true, partialFilterExpression: { "customDomain.hostname": { $exists: true } } },
    ),
    leads.createIndex({ tenantId: 1, createdAt: -1, _id: -1 }),
    estimates.createIndex({ tenantId: 1, _id: 1 }),
    estimates.createIndex({ tenantId: 1, leadId: 1, status: 1 }),
    invoices.createIndex({ tenantId: 1, estimateId: 1 }, { unique: true }),
    invoices.createIndex({ tenantId: 1, number: 1 }, { unique: true }),
    applications.createIndex({ tenantId: 1, _id: 1 }),
    txns.createIndex({ applicationId: 1, fingerprint: 1 }, { unique: true }),
    txns.createIndex({ tenantId: 1, applicationId: 1, date: 1, _id: 1 }),
  ]);

  return {
    tenants: {
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
        const l: Lead = { ...input, id: newId(), createdAt: new Date() };
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
        const e: Estimate = { ...input, id: newId(), createdAt: new Date() };
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
        const i: Invoice = { ...input, id: newId(), createdAt: new Date() };
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
  };
}
