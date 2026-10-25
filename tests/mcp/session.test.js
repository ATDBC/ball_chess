import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../../core/state.js";
import { listLegalActions } from "../../core/legal.js";
import { AgentSession } from "../../mcp/session.js";

const PLAYER_STATE = {
  matchId: "m_test",
  version: 2,
  status: "playing",
  config: { width: 9, height: 13, wallLimit: null, maxPlies: 300, turnTimeoutMs: null, firstPlayer: "left" },
  players: {
    left: { color: "red", position: [2, 0], wallsUsed: 0 },
    right: { color: "blue", position: [6, 0], wallsUsed: 0 }
  },
  walls: [],
  currentPlayer: "left",
  plies: 0,
  lastAction: null,
  result: null,
  turnDeadlineAt: null,
  seats: {
    left: { joined: true, profile: { name: "MCP agent", clientKind: "mcp" } },
    right: { joined: true, profile: { name: "MCP agent", clientKind: "mcp" } }
  },
  yourPlayer: "left",
  yourTurn: true,
  legalActions: [{ type: "move", direction: "up" }]
};

test("a pre-bound session joins lazily once before serving state", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(PLAYER_STATE), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const session = new AgentSession({
    baseUrl: "http://127.0.0.1:7100",
    matchId: "m_test",
    token: "seat_secret",
    fetchImpl
  });

  await Promise.all([session.getState(), session.getState()]);

  assert.deepEqual(requests.map(({ url, options }) => ({
    path: new URL(url).pathname,
    method: options.method || "GET",
    authorization: options.headers.authorization
  })), [
    { path: "/api/matches/m_test/join", method: "POST", authorization: "Bearer seat_secret" },
    { path: "/api/matches/m_test/state", method: "GET", authorization: "Bearer seat_secret" },
    { path: "/api/matches/m_test/state", method: "GET", authorization: "Bearer seat_secret" }
  ]);
});

test("a failed shared join is cleared so the next state call can retry", async () => {
  let joinAttempts = 0;
  const fetchImpl = async (url) => {
    if (new URL(url).pathname.endsWith("/join")) {
      joinAttempts += 1;
      if (joinAttempts === 1) {
        return new Response(JSON.stringify({
          ok: false,
          error: { code: "STORAGE_ERROR", message: "temporary failure", details: {} }
        }), {
          status: 500,
          headers: { "content-type": "application/json" }
        });
      }
    }
    return new Response(JSON.stringify(PLAYER_STATE), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const session = new AgentSession({
    baseUrl: "http://127.0.0.1:7100",
    matchId: "m_test",
    token: "seat_secret",
    fetchImpl
  });

  const failed = await Promise.allSettled([session.getState(), session.getState()]);
  assert.deepEqual(failed.map((result) => result.status), ["rejected", "rejected"]);
  assert.equal(joinAttempts, 1);

  const recovered = await session.getState();
  assert.equal(recovered.yourPlayer, "left");
  assert.equal(joinAttempts, 2);
});

test("agent state compacts legal actions below the tool-result prune threshold", async () => {
  const game = createGame();
  const state = {
    ...PLAYER_STATE,
    ...game,
    legalActions: listLegalActions(game, "left")
  };
  const fetchImpl = async () => new Response(JSON.stringify(state), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
  const session = new AgentSession({
    baseUrl: "http://127.0.0.1:7100",
    matchId: "m_test",
    token: "seat_secret",
    fetchImpl
  });

  const projected = await session.getState();

  assert.deepEqual(projected.legalActions.moves, ["up", "left", "right"]);
  assert.equal(projected.legalActions.walls.h.length, 96);
  assert.equal(projected.legalActions.walls.v.length, 96);
  assert.deepEqual(projected.legalActions.walls.h[0], [0, 1]);
  assert.deepEqual(projected.legalActions.walls.v[0], [1, 0]);
  assert.ok(Buffer.byteLength(JSON.stringify(projected)) < 8192);
});
