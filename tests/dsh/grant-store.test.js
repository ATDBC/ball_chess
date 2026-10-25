import test from "node:test";
import assert from "node:assert/strict";
import { BallChessGrantStore, credentialKeyForAgent, inheritedSession } from "../../dsh/grant-store.js";

class MemoryCredentials {
  records = new Map();
  async readRecord(key) { return this.records.get(key); }
  async modifyRecord(key, mutate) {
    const next = await mutate(this.records.get(key));
    if (next !== undefined) this.records.set(key, next);
    return this.records.get(key);
  }
  async deleteRecord(key) { this.records.delete(key); }
}

test("credential key is stable, scoped, and does not reveal the session id", () => {
  const key = credentialKeyForAgent("session/user-visible-id");
  assert.match(key, /^ball-chess\/s-[0-9a-f]{64}$/);
  assert.ok(!key.includes("user-visible-id"));
  assert.equal(key, credentialKeyForAgent("session/user-visible-id"));
  assert.notEqual(key, credentialKeyForAgent("another"));
});

test("redeeming state reuses an id and is atomically replaced by bound state", async () => {
  const credentials = new MemoryCredentials();
  const store = new BallChessGrantStore(credentials);
  const first = await store.beginRedemption("agent-1", { baseUrl: "http://127.0.0.1:7100", inviteCode: "CODE", redemptionId: "a".repeat(32) });
  const retry = await store.beginRedemption("agent-1", { baseUrl: "http://127.0.0.1:7100", inviteCode: "CODE", redemptionId: "b".repeat(32) });
  assert.equal(first.redemptionId, "a".repeat(32));
  assert.equal(retry.redemptionId, first.redemptionId);
  await store.completeRedemption("agent-1", first.redemptionId, { baseUrl: first.baseUrl, matchId: "m_one", seat: "left", playerToken: "secret" });
  assert.deepEqual(await store.read("agent-1"), { version: 1, state: "bound", baseUrl: first.baseUrl, matchId: "m_one", seat: "left", playerToken: "secret" });
  assert.ok(!JSON.stringify(await store.read("agent-1")).includes("CODE"));
  await store.delete("agent-1");
  assert.equal(await store.read("agent-1"), null);
});

test("finishing atomically replaces the player token with a terminal receipt", async () => {
  const credentials = new MemoryCredentials();
  const store = new BallChessGrantStore(credentials);
  const pending = await store.beginRedemption("agent-1", {
    baseUrl: "http://127.0.0.1:7100",
    inviteCode: "CODE",
    redemptionId: "a".repeat(32)
  });
  await store.completeRedemption("agent-1", pending.redemptionId, {
    baseUrl: pending.baseUrl,
    matchId: "m_done",
    seat: "left",
    playerToken: "seat_secret"
  });
  const receipt = {
    kind: "finished",
    state: {
      matchId: "m_done",
      version: 9,
      status: "finished",
      yourPlayer: "left",
      yourTurn: false,
      result: { kind: "win", winner: "left", reason: "reached_goal" }
    }
  };
  await store.finish("agent-1", "m_done", receipt);
  const saved = await store.read("agent-1");
  assert.deepEqual(saved, { version: 1, state: "finished", matchId: "m_done", seat: "left", receipt });
  assert.equal(JSON.stringify(saved).includes("seat_secret"), false);

  const next = await store.beginRedemption("agent-1", {
    baseUrl: "http://127.0.0.1:7100",
    inviteCode: "NEXT",
    redemptionId: "b".repeat(32)
  });
  assert.equal(next.state, "redeeming");
  assert.equal(next.inviteCode, "NEXT");
});

test("malformed records fail loud and inherited sessions are identifiable", async () => {
  const credentials = new MemoryCredentials();
  const store = new BallChessGrantStore(credentials);
  credentials.records.set(credentialKeyForAgent("agent-1"), { kind: "grant", payload: { version: 1, state: "bound" } });
  await assert.rejects(store.read("agent-1"), /invalid Ball Chess grant/);
  assert.equal(inheritedSession({ isSeeded: true }), true);
  assert.equal(inheritedSession({ origin: "subagent" }), true);
  assert.equal(inheritedSession({ parentSession: "parent" }), true);
  assert.equal(inheritedSession({}), false);
});
