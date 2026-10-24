import { listAllWallAnchors, wallAnchorError, wallConflict } from "./walls.js";
import { listLegalMoves } from "./movement.js";
import { pathsRemainAfterWall } from "./paths.js";

export function wallPlacementError(game, playerId, wall) {
  const anchorError = wallAnchorError(wall);
  if (anchorError) return anchorError;
  if (game.config.wallLimit !== null && game.players[playerId].wallsUsed >= game.config.wallLimit) return "WALL_LIMIT_REACHED";
  for (const existing of game.walls) {
    const conflict = wallConflict(existing, wall);
    if (conflict) return conflict;
  }
  return pathsRemainAfterWall(game, wall) ? null : "PATH_BLOCKED";
}

export function listLegalActions(game, playerId) {
  if (game.result || game.currentPlayer !== playerId) return [];
  const actions = listLegalMoves(game, playerId);
  if (game.config.wallLimit !== null && game.players[playerId].wallsUsed >= game.config.wallLimit) return actions;
  for (const wall of listAllWallAnchors()) {
    if (wallPlacementError(game, playerId, wall) === null) actions.push({ type: "place_wall", ...wall });
  }
  return actions;
}

export function actionEquals(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === "move") return a.direction === b.direction;
  if (a.type === "place_wall") return a.orientation === b.orientation && a.x === b.x && a.y === b.y;
  return false;
}
