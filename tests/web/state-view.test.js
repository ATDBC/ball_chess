import test from "node:test";
import assert from "node:assert/strict";
import { shouldAcceptSnapshot, canInteract, wallsRemaining, resolveInteractionMode } from "../../web/state-view.js";

test("snapshots cannot roll the board backward", () => {
  assert.equal(shouldAcceptSnapshot({ version: 4 }, { version: 3 }), false);
  assert.equal(shouldAcceptSnapshot({ version: 4 }, { version: 4 }), true);
  assert.equal(shouldAcceptSnapshot(null, { version: 0 }), true);
});

test("spectators cannot act and unlimited walls display infinity", () => {
  assert.equal(canInteract({ status: "playing", yourTurn: false }), false);
  assert.equal(wallsRemaining({ config: { wallLimit: null }, players: { left: { wallsUsed: 9 } } }, "left"), "∞");
});

test("wall mode survives opponent snapshots and resets only for own exhausted walls", () => {
  const waiting = { status: "playing", yourTurn: false, result: null, legalActions: [] };
  assert.equal(resolveInteractionMode(waiting, "wall", false), "wall");
  const exhausted = { status: "playing", yourTurn: true, result: null, legalActions: [{ type: "move", direction: "up" }] };
  assert.equal(resolveInteractionMode(exhausted, "wall", false), "move");
});
