import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../../core/state.js";
import { projectState, renderAgentResult } from "../../agent/projection.js";

test("projection groups actions and never adds credentials", () => {
  const projected = projectState({
    ...createGame(), matchId: "m_test", version: 3, status: "playing", yourPlayer: "left", yourTurn: true,
    legalActions: [{ type: "move", direction: "up" }, { type: "place_wall", orientation: "h", x: 1, y: 2 }]
  });
  assert.deepEqual(projected.legalActions, { moves: ["up"], walls: { h: [[1, 2]], v: [] } });
  assert.match(projected.ascii, /L/);
  assert.ok(!JSON.stringify(projected).includes("playerToken"));
});

test("agent text is compact and action-oriented", () => {
  const text = renderAgentResult({ kind: "turn", state: { matchId: "m_test", version: 4, status: "playing", yourPlayer: "left", yourTurn: true, ascii: "L R", legalActions: { moves: ["up"], walls: { h: [], v: [] } } } });
  assert.match(text, /TURN m_test v4 left/);
  assert.match(text, /moves=up/);
  assert.ok(text.length < 300);
});

