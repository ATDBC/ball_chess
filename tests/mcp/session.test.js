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

