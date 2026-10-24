import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../../core/state.js";
import { listLegalMoves } from "../../core/movement.js";

test("bottom starts cannot move down", () => {
  const game = createGame();
  assert.deepEqual(listLegalMoves(game, "left").map((a) => a.direction), ["up", "left", "right"]);
});

test("pawn occupancy and walls independently block movement without jumping", () => {
  const occupied = createGame();
  occupied.players.right.position = [2, 1];
  assert.ok(!listLegalMoves(occupied, "left").some((a) => a.direction === "up"));
  assert.ok(listLegalMoves(occupied, "left").some((a) => a.direction === "left"));
  const walled = createGame();
  walled.walls.push({ orientation: "h", x: 1, y: 1 });
  assert.ok(!listLegalMoves(walled, "left").some((a) => a.direction === "up"));
  assert.ok(listLegalMoves(walled, "left").some((a) => a.direction === "right"));
});

test("wall blocks only its two exact edges", () => {
  const game = createGame();
  game.walls.push({ orientation: "h", x: 2, y: 1 });
  assert.ok(!listLegalMoves(game, "left").some((a) => a.direction === "up"));
  assert.ok(listLegalMoves(game, "right").some((a) => a.direction === "up"));
});
