import test from "node:test";
import assert from "node:assert/strict";
import { createGame, normalizeConfig } from "../../core/state.js";

test("initial game matches the confirmed board", () => {
  const game = createGame();
  assert.deepEqual(game.players.left.position, [2, 0]);
  assert.deepEqual(game.players.right.position, [6, 0]);
  assert.equal(game.currentPlayer, "left");
  assert.equal(game.plies, 0);
  assert.equal(game.config.wallLimit, null);
  assert.equal(game.config.maxPlies, 300);
  assert.equal(game.result, null);
});

test("configuration accepts finite walls and rejects invalid values", () => {
  assert.equal(normalizeConfig({ wallLimit: 0 }).wallLimit, 0);
  assert.equal(normalizeConfig({ firstPlayer: "right" }).firstPlayer, "right");
  assert.throws(() => normalizeConfig({ wallLimit: -1 }), /wallLimit/);
  assert.throws(() => normalizeConfig({ maxPlies: 0 }), /maxPlies/);
  assert.throws(() => normalizeConfig({ turnTimeoutMs: 0 }), /turnTimeoutMs/);
  assert.throws(() => normalizeConfig({ firstPlayer: "random" }), /firstPlayer/);
});
