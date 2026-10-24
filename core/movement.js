import { inBounds, cellEdgeKey } from "./coordinates.js";
import { buildBlockedEdges } from "./walls.js";

export const DIRECTIONS = Object.freeze({
  up: [0, 1],
  down: [0, -1],
  left: [-1, 0],
  right: [1, 0]
});

export function destinationFor(position, direction) {
  const delta = DIRECTIONS[direction];
  if (!delta) return null;
  return [position[0] + delta[0], position[1] + delta[1]];
}

export function listLegalMoves(game, playerId) {
  const blocked = buildBlockedEdges(game.walls);
  const origin = game.players[playerId].position;
  const opponentId = playerId === "left" ? "right" : "left";
  const opponent = game.players[opponentId].position;
  const result = [];
  for (const direction of ["up", "down", "left", "right"]) {
    const destination = destinationFor(origin, direction);
    if (!inBounds(destination[0], destination[1])) continue;
    if (destination[0] === opponent[0] && destination[1] === opponent[1]) continue;
    if (blocked.has(cellEdgeKey(origin, destination))) continue;
    result.push({ type: "move", direction });
  }
  return result;
}
