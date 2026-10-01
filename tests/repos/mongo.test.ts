// The MongoDB repositories must pass the same contract as the in-memory reference.
// Needs a running Mongo:  docker compose up -d   then set MONGO_URL (CI sets it for you).
import { MongoClient } from "mongodb";
import { createMongoRepos } from "../../src/repos/mongo";
import { repoContract } from "./contract";

const url = process.env.MONGO_URL;
if (!url) console.warn("[repos] MONGO_URL not set: skipping MongoDB contract tests");

describe.skipIf(!url)("mongodb", () => {
  let client: MongoClient;
  const dbs: string[] = [];
  beforeAll(async () => {
    client = await MongoClient.connect(url!);
  });
  afterAll(async () => {
    await Promise.all(dbs.map((d) => client.db(d).dropDatabase()));
    await client?.close();
  });
  // Fresh database per test so tests can't leak into each other.
  repoContract("mongodb", async () => {
    const name = `mainstreet_test_${process.pid}_${dbs.length}`;
    dbs.push(name);
    return createMongoRepos(client.db(name));
  });
});
