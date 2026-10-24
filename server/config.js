import { randomInt } from "node:crypto";
import { normalizeConfig } from "../core/state.js";
import { GameError } from "../core/errors.js";

const ALLOWED_KEYS = new Set(["wallLimit", "maxPlies", "turnTimeoutMs", "firstPlayer"]);

export function resolveMatchConfig(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new GameError("INVALID_CONFIG", "Match configuration must be an object");
  }
  for (const key of Object.keys(options)) {
    if (!ALLOWED_KEYS.has(key)) throw new GameError("INVALID_CONFIG", `Unknown match configuration field: ${key}`);
  }
  const resolved = { ...options };
  if (resolved.firstPlayer === "random") resolved.firstPlayer = randomInt(2) === 0 ? "left" : "right";
  return normalizeConfig(resolved);
}
