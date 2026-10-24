import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { MatchStore } from "../../server/store.js";

async function tempStore(t) {
  await mkdir(path.join(process.cwd(), ".tmp"), { recursive: true });
  const directory = await mkdtemp(path.join(process.cwd(), ".tmp", "store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new MatchStore({ directory });
}

test("records round trip with tokens confined to storage", async (t) => {
  const store = await tempStore(t);
  await store.save({ schemaVersion: 1, id: "m_test", playerTokens: { left: "secret" }, actions: [] });
  const loaded = await store.loadAll();
  assert.equal(loaded.records[0].playerTokens.left, "secret");
  assert.equal(loaded.failures.length, 0);
});

test("one corrupt record does not block valid records", async (t) => {
  const store = await tempStore(t);
  await store.save({ schemaVersion: 1, id: "m_valid", actions: [] });
  await writeFile(path.join(store.directory, "broken.json"), "{bad", "utf8");
  const loaded = await store.loadAll();
  assert.equal(loaded.records.length, 1);
  assert.equal(loaded.failures[0].matchId, "broken");
});
