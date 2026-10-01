// Sanity check: the provided in-memory reference passes the contract.
import { createMemoryRepos } from "../../src/repos/memory";
import { repoContract } from "./contract";

repoContract("memory (reference)", async () => createMemoryRepos());
