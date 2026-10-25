import test from "node:test";
import assert from "node:assert/strict";
import { projectState } from "../../agent/projection.js";
import { createGame } from "../../core/state.js";
import { BallChessGrantStore, credentialKeyForAgent, decodeGrant, inheritedSession } from "../../dsh/grant-store.js";

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

test("rejecting a redemption releases only the matching pending attempt", async () => {
  const credentials = new MemoryCredentials();
  const store = new BallChessGrantStore(credentials);
  const first = await store.beginRedemption("agent-1", {
    baseUrl: "http://127.0.0.1:7100",
    inviteCode: "EXPIRED",
    redemptionId: "a".repeat(32)
  });

  await store.rejectRedemption("agent-1", first.redemptionId);
  assert.deepEqual(await store.read("agent-1"), { version: 1, state: "unbound" });

  const next = await store.beginRedemption("agent-1", {
    baseUrl: first.baseUrl,
    inviteCode: "FRESH",
    redemptionId: "b".repeat(32)
  });
  await store.rejectRedemption("agent-1", first.redemptionId);
  assert.deepEqual(await store.read("agent-1"), next);
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
  const receipt = terminalReceipt();
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

function terminalReceipt() {
  return {
    kind: "finished",
    state: projectState({
      ...createGame({ wallLimit: 4, maxPlies: 80, turnTimeoutMs: 30_000, firstPlayer: "right" }),
      matchId: "m_done",
      version: 9,
      status: "finished",
      turnDeadlineAt: null,
      seats: {
        left: { phase: "ready", profile: { displayName: "Left", clientType: "dsh" }, invitation: null },
        right: { phase: "ready", profile: { displayName: "Right", clientType: "web" }, invitation: null }
      },
      yourPlayer: "left",
      yourTurn: false,
      legalActions: [],
      walls: [{ orientation: "h", x: 0, y: 1, player: "left" }],
      plies: 1,
      lastAction: { player: "left", ply: 1, action: { type: "move", direction: "up" } },
      result: { kind: "win", winner: "left", reason: "reached_goal" }
    })
  };
}

test("finished records reject forged seats, outcomes, versions, and extra fields", () => {
  const record = {
    kind: "grant",
    payload: { version: 1, state: "finished", matchId: "m_done", seat: "left", receipt: terminalReceipt() }
  };
  assert.equal(decodeGrant(record).receipt.state.yourPlayer, "left");

  const legacyWall = structuredClone(record);
  delete legacyWall.payload.receipt.state.walls[0].player;
  assert.equal(decodeGrant(legacyWall).receipt.state.walls[0].player, undefined);

  const forgedWallPlayer = structuredClone(record);
  forgedWallPlayer.payload.receipt.state.walls[0].player = "spectator";
  assert.throws(() => decodeGrant(forgedWallPlayer), /invalid Ball Chess grant/);

  const extraWallField = structuredClone(record);
  extraWallField.payload.receipt.state.walls[0].untrusted = true;
  assert.throws(() => decodeGrant(extraWallField), /invalid Ball Chess grant/);

  const forgedSeat = structuredClone(record);
  forgedSeat.payload.receipt.state.yourPlayer = "right";
  assert.throws(() => decodeGrant(forgedSeat), /invalid Ball Chess grant/);

  const forgedResult = structuredClone(record);
  forgedResult.payload.receipt.state.result = { bogus: true };
  assert.throws(() => decodeGrant(forgedResult), /invalid Ball Chess grant/);

  const negativeVersion = structuredClone(record);
  negativeVersion.payload.receipt.state.version = -1;
  assert.throws(() => decodeGrant(negativeVersion), /invalid Ball Chess grant/);

  const extraField = structuredClone(record);
  extraField.payload.receipt.state.untrusted = true;
  assert.throws(() => decodeGrant(extraField), /invalid Ball Chess grant/);
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
