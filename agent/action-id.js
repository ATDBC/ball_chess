import { GameError } from "../core/errors.js";
import { wallAnchorError } from "../core/walls.js";

const MOVE_DIRECTIONS = new Set(["up", "down", "left", "right"]);
const WALL_PATTERN = /^wall:([hv]):(0|[1-9]\d*):(0|[1-9]\d*)$/;

function invalidActionId() {
  throw new GameError(
    "INVALID_ACTION_ID",
    "actionId must be move:up|down|left|right or wall:h|v:x:y using canonical non-negative integers"
  );
}

export function formatActionId(action) {
  if (!action || typeof action !== "object") invalidActionId();
  if (
    action.type === "move"
    && Object.keys(action).length === 2
    && MOVE_DIRECTIONS.has(action.direction)
  ) {
    return `move:${action.direction}`;
  }
  if (
    action.type === "place_wall"
    && Object.keys(action).length === 4
    && wallAnchorError(action) === null
  ) {
    return `wall:${action.orientation}:${action.x}:${action.y}`;
  }
  return invalidActionId();
}

export function parseActionId(actionId) {
  if (typeof actionId !== "string") return invalidActionId();
  if (actionId.startsWith("move:")) {
    const direction = actionId.slice("move:".length);
    if (MOVE_DIRECTIONS.has(direction)) return { type: "move", direction };
    return invalidActionId();
  }
  const match = WALL_PATTERN.exec(actionId);
  if (!match) return invalidActionId();
  const action = {
    type: "place_wall",
    orientation: match[1],
    x: Number(match[2]),
    y: Number(match[3])
  };
  if (wallAnchorError(action) !== null) return invalidActionId();
  return action;
}
