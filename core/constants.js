export const WIDTH = 9;
export const HEIGHT = 13;
export const PLAYER_IDS = Object.freeze(["left", "right"]);
export const START_POSITIONS = Object.freeze({ left: [2, 0], right: [6, 0] });
export const MAX_TURN_TIMEOUT_MS = 2_147_483_647;
export const DEFAULT_CONFIG = Object.freeze({
  width: WIDTH,
  height: HEIGHT,
  wallLimit: null,
  maxPlies: 300,
  turnTimeoutMs: null,
  firstPlayer: "left"
});
