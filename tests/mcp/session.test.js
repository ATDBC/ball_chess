import test from "node:test";
import assert from "node:assert/strict";
import { AgentSession } from "../../mcp/session.js";

const STATE = {
  matchId: "m_test", version: 4, status: "playing", yourPlayer: "left", yourTurn: true,
  config: { wallLimit: null }, players: { left: { position: [2, 0], wallsUsed: 0 }, right: { position: [6, 0], wallsUsed: 0 } },
  walls: [], legalActions: [{ type: "move", direction: "up" }]
};

test("pre-bound MCP session joins once without exposing its token", async () => {
  const calls = [];
  const session = new AgentSession({
    baseUrl: "http://local.test", matchId: "m_test", token: "seat_secret",
    fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify(STATE), { status: 200 }); }
  });
  const [one, two] = await Promise.all([session.getState(), session.getState()]);
  assert.equal(calls.filter((call) => call.url.endsWith("/join")).length, 1);
  assert.ok(!JSON.stringify({ one, two }).includes("seat_secret"));
});
test("MCP invitation join generates hidden idempotency and readies", async () => {
  const bodies = [];
  const session = new AgentSession({
    baseUrl: "http://local.test",
    fetchImpl: async (url, options) => {
      bodies.push(options.body && JSON.parse(options.body));
      if (url.endsWith("/redeem")) return new Response(JSON.stringify({ matchId: "m_test", seat: "left", playerToken: "seat_secret", state: { ...STATE, status: "waiting", yourTurn: false } }), { status: 200 });
      return new Response(JSON.stringify(STATE), { status: 200 });
    }
  });
  const result = await session.joinByInvite("01234-56789-ABCDE-FGHJK-MNPQRS", "Agent");
  assert.match(bodies[0].redemptionId, /^[0-9a-f]{32}$/);
  assert.deepEqual(bodies[1], { ready: true });
  assert.ok(!JSON.stringify(result).includes("seat_secret"));
  assert.ok(!JSON.stringify(result).includes("01234"));
});

test("MCP session parses an action id before using the existing HTTP action body", async () => {
  const calls = [];
  const session = new AgentSession({
    baseUrl: "http://local.test", matchId: "m_test", token: "seat_secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, body: options.body && JSON.parse(options.body) });
      return new Response(JSON.stringify(STATE), { status: 200 });
    }
  });
  await session.submitAction(4, "wall:v:3:4");
  const actionCall = calls.find((call) => call.url.endsWith("/actions"));
  assert.deepEqual(actionCall.body, {
    expectedVersion: 4,
    action: { type: "place_wall", orientation: "v", x: 3, y: 4 }
  });
});

test("MCP session exposes the bound match record", async () => {
  const record = {
    schemaVersion: 1, matchId: "m_test", config: STATE.config,
    actions: [{ player: "left", ply: 1, action: { type: "move", direction: "up" }, at: 10 }],
    result: null, createdAt: 0, updatedAt: 10
  };
  const session = new AgentSession({
    baseUrl: "http://local.test", matchId: "m_test", token: "seat_secret",
    fetchImpl: async (url) => new Response(JSON.stringify(url.endsWith("/record") ? record : STATE), { status: 200 })
  });
  const projected = await session.getRecord();
  assert.equal(projected.actions[0].actionId, "move:up");
});
