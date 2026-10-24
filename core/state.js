import { DEFAULT_CONFIG, PLAYER_IDS, START_POSITIONS } from "./constants.js";
import { GameError } from "./errors.js";

export function normalizeConfig(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options, width: 9, height: 13 };
  if (!(config.wallLimit === null || (Number.isInteger(config.wallLimit) && config.wallLimit >= 0))) {
    throw new GameError("INVALID_CONFIG", "wallLimit must be null or a non-negative integer");
  }
  if (!Number.isInteger(config.maxPlies) || config.maxPlies < 1) {
    throw new GameError("INVALID_CONFIG", "maxPlies must be a positive integer");
  }
  if (!(config.turnTimeoutMs === null || (Number.isInteger(config.turnTimeoutMs) && config.turnTimeoutMs > 0))) {
    throw new GameError("INVALID_CONFIG", "turnTimeoutMs must be null or a positive integer");
  }
  if (!PLAYER_IDS.includes(config.firstPlayer)) {
    throw new GameError("INVALID_CONFIG", "firstPlayer must be left or right");
  }
  return config;
}

export function otherPlayer(playerId) {
  if (!PLAYER_IDS.includes(playerId)) throw new GameError("INVALID_PLAYER", "Unknown player", { playerId });
  return playerId === "left" ? "right" : "left";
}

export function createGame(options = {}) {
  const config = normalizeConfig(options);
  return {
    config,
    players: {
      left: { color: "red", position: [...START_POSITIONS.left], wallsUsed: 0 },
      right: { color: "blue", position: [...START_POSITIONS.right], wallsUsed: 0 }
    },
    walls: [],
    currentPlayer: config.firstPlayer,
    plies: 0,
    lastAction: null,
    result: null
  };
}
