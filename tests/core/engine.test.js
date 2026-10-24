import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../../core/state.js";
import { applyAction, settleCurrentTurn } from "../../core/engine.js";

test("left wins on ply 23 when both players only advance", () => {
  let game = createGame();
  for (let i = 0; i < 11; i += 1) {
    game = applyAction(game, "left", { type: "move", direction: "up" });
    game = applyAction(game, "right", { type: "move", direction: "up" });
  }
  game = applyAction(game, "left", { type: "move", direction: "up" });
  assert.equal(game.plies, 23);
  assert.deepEqual(game.result, { kind: "win", winner: "left", reason: "reached_goal" });
});

test("ply 300 draws and rejected actions leave the input immutable", () => {
  const drawGame = createGame({ maxPlies: 300 });
  drawGame.plies = 299;
  const draw = applyAction(drawGame, "left", { type: "move", direction: "up" });
  assert.equal(draw.plies, 300);
  assert.equal(draw.result.kind, "draw");
  assert.equal(drawGame.plies, 299);
  assert.throws(() => applyAction(drawGame, "right", { type: "move", direction: "up" }), (error) => error.code === "NOT_YOUR_TURN");
});

test("reaching the goal on ply 300 wins before the draw check", () => {
  const game = createGame({ maxPlies: 300 });
  game.plies = 299;
  game.players.left.position = [2, 11];
  const won = applyAction(game, "left", { type: "move", direction: "up" });
  assert.equal(won.plies, 300);
  assert.deepEqual(won.result, { kind: "win", winner: "left", reason: "reached_goal" });
});

test("actions reject unknown fields without changing state", () => {
  const game = createGame();
  assert.throws(
    () => applyAction(game, "left", { type: "move", direction: "up", unexpected: true }),
    (error) => error.code === "ILLEGAL_ACTION" && error.details.reason === "INVALID_ACTION"
  );
  assert.equal(game.plies, 0);
});

test("no legal action loses instead of deadlocking", () => {
  const game = createGame({ wallLimit: 0 });
  game.players.left.position = [0, 0];
  game.players.right.position = [1, 0];
  game.walls.push({ orientation: "h", x: 0, y: 1 });
  const settled = settleCurrentTurn(game);
  assert.deepEqual(settled.result, { kind: "win", winner: "right", reason: "no_legal_action" });
});
