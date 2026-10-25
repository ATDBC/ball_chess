import test from "node:test";
import assert from "node:assert/strict";
import { BallChessAgentClient } from "../../agent/client.js";

function response(body, ok = true, status = 200) {
  return { ok, status, json: async () => structuredClone(body) };
}

const waiting = {
  matchId: "m_one", version: 1, status: "waiting", yourPlayer: "left", yourTurn: false,
  seats: { left: { phase: "claimed" }, right: { phase: "open" } },
  players: { left: { position: [2, 0], wallsUsed: 0 }, right: { position: [6, 0], wallsUsed: 0 } },
  walls: [], legalActions: [], config: { wallLimit: null }
};

test("invite binding is serialized, readies once, and hides credentials", async () => {
  const calls = [];
  let release;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/api/invitations/redeem")) {
      await new Promise((resolve) => { release = resolve; });
      return response({ matchId: "m_one", seat: "left", playerToken: "seat_secret", state: waiting });
    }
    if (url.endsWith("/ready")) return response({ ...waiting, version: 2, seats: { ...waiting.seats, left: { phase: "ready" } } });
    throw new Error(`unexpected ${url}`);
  };
  const client = new BallChessAgentClient({ baseUrl: "http://local.test", fetchImpl });
  const first = client.bindByInvite({ code: "01234-56789-ABCDE-FGHJK-MNPQRS", redemptionId: "a".repeat(32), name: "A", ready: true });
  const second = client.bindByInvite({ code: "01234-56789-ABCDE-FGHJK-MNPQRS", redemptionId: "a".repeat(32), name: "A", ready: true });
  await Promise.resolve();
  assert.equal(calls.length, 1);
  release();
  const [one, two] = await Promise.all([first, second]);
  assert.deepEqual(one, two);
  assert.equal(calls.filter((call) => call.url.endsWith("/ready")).length, 1);
  assert.ok(!JSON.stringify(one).includes("seat_secret"));
  assert.ok(!JSON.stringify(one).includes("01234"));
});
test("bound client authenticates state and action without returning token", async () => {
  const calls = [];
  const playing = { ...waiting, version: 3, status: "playing", yourTurn: true, legalActions: [{ type: "move", direction: "up" }] };
  const client = new BallChessAgentClient({
    baseUrl: "http://local.test",
    binding: { matchId: "m_one", seat: "left", playerToken: "seat_secret" },
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response(playing); }
  });
  const state = await client.getState();
  const action = await client.submitAction(3, { type: "move", direction: "up" });
  assert.equal(calls[0].options.headers.authorization, "Bearer seat_secret");
  assert.equal(action.ok, true);
  assert.ok(!JSON.stringify({ state, action }).includes("seat_secret"));
});
test("HTTP errors keep stable recovery fields without request secrets", async () => {
  const client = new BallChessAgentClient({
    baseUrl: "http://local.test",
    binding: { matchId: "m_one", seat: "left", playerToken: "seat_secret" },
    fetchImpl: async () => response({ error: { code: "STALE_STATE", message: "old", details: { currentVersion: 9 } }, state: { ...waiting, version: 9 } }, false, 409)
  });
  const result = await client.submitAction(3, { type: "move", direction: "up" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "STALE_STATE");
  assert.equal(result.state.version, 9);
  assert.ok(!JSON.stringify(result).includes("seat_secret"));
});

test("bound client projects the complete public match record", async () => {
  const urls = [];
  const client = new BallChessAgentClient({
    baseUrl: "http://local.test",
    binding: { matchId: "m_one", seat: "left", playerToken: "seat_secret" },
    fetchImpl: async (url) => {
      urls.push(url);
      return response({
        schemaVersion: 1,
        matchId: "m_one",
        config: { wallLimit: null, maxPlies: 300, turnTimeoutMs: null, firstPlayer: "left" },
        actions: [
          { player: "left", ply: 1, action: { type: "move", direction: "up" }, at: 100 },
          { player: "right", ply: 2, action: { type: "place_wall", orientation: "v", x: 3, y: 4 }, at: 200 }
        ],
        result: null,
        createdAt: 10,
        updatedAt: 200
      });
    }
  });
  const record = await client.getRecord();
  assert.equal(urls[0], "http://local.test/api/matches/m_one/record");
  assert.deepEqual(record.actions.map((entry) => entry.actionId), ["move:up", "wall:v:3:4"]);
  assert.ok(!JSON.stringify(record).includes("seat_secret"));
});
