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

function validRecord(id = "m_valid") {
  return {
    schemaVersion: 1,
    id,
    adminToken: "admin",
    playerTokens: { left: "secret", right: "right" },
    createdAt: 1,
    updatedAt: 1,
    joined: { left: false, right: false },
    profiles: { left: null, right: null },
    status: "waiting",
    version: 0,
    turnDeadlineAt: null,
    config: {
      width: 9,
      height: 13,
      wallLimit: null,
      maxPlies: 300,
      turnTimeoutMs: null,
      firstPlayer: "left"
    },
    actions: [],
    result: null
  };
}

function validV2Record(id = "m_v2") {
  return {
    schemaVersion: 2,
    id,
    adminToken: "admin",
    playerTokens: { left: "secret", right: "right" },
    createdAt: 1,
    updatedAt: 1,
    startedAt: null,
    seats: {
      left: { phase: "open", profile: null },
      right: { phase: "open", profile: null }
    },
    invitations: { left: null, right: null },
    version: 0,
    turnDeadlineAt: null,
    config: {
      width: 9,
      height: 13,
      wallLimit: null,
      maxPlies: 300,
      turnTimeoutMs: null,
      firstPlayer: "left"
    },
    actions: [],
    result: null
  };
}

test("records round trip with tokens confined to storage", async (t) => {
  const store = await tempStore(t);
  await store.save(validRecord("m_test"));
  const loaded = await store.loadAll();
  assert.equal(loaded.records[0].playerTokens.left, "secret");
  assert.equal(loaded.failures.length, 0);
});

test("v2 records round trip and reject invalid seat phases", async (t) => {
  const store = await tempStore(t);
  await store.save(validV2Record());
  await store.save({
    ...validV2Record("m_bad_v2"),
    seats: {
      left: { phase: "watching", profile: null },
      right: { phase: "open", profile: null }
    }
  });

  const loaded = await store.loadAll();
  assert.deepEqual(loaded.records.map((record) => record.id), ["m_v2"]);
  assert.equal(loaded.failures[0].matchId, "m_bad_v2");
  assert.match(loaded.failures[0].message, /seats\.left\.phase/);
});

test("one corrupt record does not block valid records", async (t) => {
  const store = await tempStore(t);
  await store.save(validRecord("m_valid"));
  await writeFile(path.join(store.directory, "broken.json"), "{bad", "utf8");
  const loaded = await store.loadAll();
  assert.equal(loaded.records.length, 1);
  assert.equal(loaded.failures[0].matchId, "broken");
});

test("structurally invalid v1 records are isolated by file", async (t) => {
  const store = await tempStore(t);
  await store.save(validRecord());
  await writeFile(
    path.join(store.directory, "m_bad.json"),
    `${JSON.stringify({ ...validRecord("m_bad"), joined: { left: "yes", right: false } })}\n`,
    "utf8"
  );

  const loaded = await store.loadAll();
  assert.deepEqual(loaded.records.map((record) => record.id), ["m_valid"]);
  assert.equal(loaded.failures[0].matchId, "m_bad");
  assert.match(loaded.failures[0].message, /joined\.left/);
});
