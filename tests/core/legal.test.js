import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../../core/state.js";
import { hasPathToGoal, pathsRemainAfterWall } from "../../core/paths.js";
import { listLegalActions, wallPlacementError } from "../../core/legal.js";

test("path search treats pawns as temporary but walls as permanent", () => {
  const game = createGame();
  game.players.right.position = [2, 1];
  assert.equal(hasPathToGoal(game, game.players.left.position), true);
  game.walls.push({ orientation: "h", x: 0, y: 1 }, { orientation: "v", x: 1, y: 0 });
  assert.equal(hasPathToGoal(game, [0, 0]), false);
});

test("candidate that closes the last path is detected", () => {
  const game = createGame();
  game.players.left.position = [0, 0];
  game.walls.push({ orientation: "h", x: 0, y: 1 });
  assert.equal(pathsRemainAfterWall(game, { orientation: "v", x: 1, y: 0 }), false);
});

test("legal actions honor wall limits and preserve paths", () => {
  const unlimited = createGame();
  assert.equal(listLegalActions(unlimited, "right").length, 0);
  assert.equal(listLegalActions(unlimited, "left").length, 195);
  for (const action of listLegalActions(unlimited, "left")) {
    if (action.type === "place_wall") assert.equal(pathsRemainAfterWall(unlimited, action), true);
  }
  const exhausted = createGame({ wallLimit: 1 });
  exhausted.players.left.wallsUsed = 1;
  assert.equal(wallPlacementError(exhausted, "left", { orientation: "h", x: 0, y: 5 }), "WALL_LIMIT_REACHED");
  const zeroWalls = createGame({ wallLimit: 0 });
  assert.deepEqual(listLegalActions(zeroWalls, "left").map((a) => a.direction), ["up", "left", "right"]);
  assert.equal(wallPlacementError(unlimited, "left", { orientation: "h", x: 2, y: 5 }), null);
  unlimited.walls.push({ orientation: "h", x: 2, y: 5 });
  assert.equal(wallPlacementError(unlimited, "left", { orientation: "h", x: 2, y: 5 }), "WALL_OVERLAP");
});
