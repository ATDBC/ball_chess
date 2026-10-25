import { HEIGHT, START_POSITIONS, WIDTH } from "./constants.js";

export function describeMatchRules(config) {
  return {
    board: { width: WIDTH, height: HEIGHT, origin: "bottom-left" },
    starts: { left: [...START_POSITIONS.left], right: [...START_POSITIONS.right] },
    goals: { left: HEIGHT - 1, right: HEIGHT - 1 },
    turn: { actions: 1, choices: ["move", "place_wall"], passAllowed: false },
    movement: {
      directions: ["up", "down", "left", "right"],
      distance: 1,
      diagonalAllowed: false,
      jumpAllowed: false,
      occupiedCellAllowed: false
    },
    wallPlacement: {
      edges: 2,
      overlapAllowed: false,
      crossingAllowed: false,
      endpointConnectionAllowed: true,
      tJunctionAllowed: true,
      preservePathFor: ["left", "right"]
    },
    outcome: { maxPliesResult: "draw" },
    firstPlayer: config.firstPlayer,
    maxPlies: config.maxPlies,
    turnTimeoutMs: config.turnTimeoutMs,
    wallLimit: config.wallLimit
  };
}

export function describeWallBudgets(state) {
  const used = (seat) => state.players[seat].wallsUsed;
  if (state.config.wallLimit === null) {
    return {
      mode: "unlimited",
      left: { used: used("left") },
      right: { used: used("right") }
    };
  }
  const limit = state.config.wallLimit;
  const budget = (seat) => ({
    used: used(seat),
    remaining: Math.max(0, limit - used(seat))
  });
  return {
    mode: "finite",
    limit,
    left: budget("left"),
    right: budget("right")
  };
}
