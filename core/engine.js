import { HEIGHT } from "./constants.js";
import { GameError } from "./errors.js";
import { otherPlayer } from "./state.js";
import { destinationFor, listLegalMoves } from "./movement.js";
import { listLegalActions, wallPlacementError } from "./legal.js";

export function getActionError(game, playerId, action) {
  if (game.result) return new GameError("MATCH_FINISHED", "Match is finished", { result: game.result });
  if (game.currentPlayer !== playerId) return new GameError("NOT_YOUR_TURN", "Not your turn", { currentPlayer: game.currentPlayer });
  if (!action || !["move", "place_wall"].includes(action.type)) {
    return new GameError("ILLEGAL_ACTION", "Unknown action", { reason: "INVALID_ACTION" });
  }
  const expectedKeys = action.type === "move" ? ["type", "direction"] : ["type", "orientation", "x", "y"];
  const actualKeys = Object.keys(action);
  if (actualKeys.length !== expectedKeys.length || expectedKeys.some((key) => !Object.hasOwn(action, key))) {
    return new GameError("ILLEGAL_ACTION", "Action has missing or unknown fields", { reason: "INVALID_ACTION" });
  }
  if (action.type === "move") {
    const legal = listLegalMoves(game, playerId).some((candidate) => candidate.direction === action.direction);
    return legal ? null : new GameError("ILLEGAL_ACTION", "Action is not legal", { reason: "ILLEGAL_MOVE" });
  }
  const reason = wallPlacementError(game, playerId, action);
  return reason === null ? null : new GameError("ILLEGAL_ACTION", "Action is not legal", { reason });
}

export function settleCurrentTurn(game) {
  if (game.result || listLegalActions(game, game.currentPlayer).length > 0) return game;
  const next = structuredClone(game);
  const loser = next.currentPlayer;
  next.result = { kind: "win", winner: otherPlayer(loser), reason: "no_legal_action" };
  return next;
}

export function applyAction(game, playerId, action) {
  const error = getActionError(game, playerId, action);
  if (error) throw error;
  const next = structuredClone(game);
  if (action.type === "move") {
    next.players[playerId].position = destinationFor(next.players[playerId].position, action.direction);
  } else {
    next.walls.push({ orientation: action.orientation, x: action.x, y: action.y, player: playerId });
    next.players[playerId].wallsUsed += 1;
  }
  next.plies += 1;
  next.lastAction = { player: playerId, ply: next.plies, action: structuredClone(action) };
  if (action.type === "move" && next.players[playerId].position[1] === HEIGHT - 1) {
    next.result = { kind: "win", winner: playerId, reason: "reached_goal" };
    return next;
  }
  if (next.plies >= next.config.maxPlies) {
    next.result = { kind: "draw", winner: null, reason: "max_plies" };
    return next;
  }
  next.currentPlayer = otherPlayer(playerId);
  return settleCurrentTurn(next);
}
