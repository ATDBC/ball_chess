import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { describeMatchRules, describeWallBudgets } from "../core/rule-description.js";

function fail(detail = "") {
  throw new Error(`invalid Ball Chess grant record${detail}`);
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function nonempty(value) {
  return typeof value === "string" && value.length > 0;
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function playerId(value) {
  return value === "left" || value === "right";
}

function coordinate(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isInteger);
}

function validAction(value) {
  if (exactKeys(value, ["type", "direction"]) && value.type === "move") {
    return ["up", "down", "left", "right"].includes(value.direction);
  }
  return exactKeys(value, ["type", "orientation", "x", "y"]) && value.type === "place_wall" &&
    ["h", "v"].includes(value.orientation) && Number.isInteger(value.x) && Number.isInteger(value.y);
}

function validLastAction(value) {
  return exactKeys(value, ["player", "ply", "action"]) && playerId(value.player) &&
    Number.isSafeInteger(value.ply) && value.ply > 0 && validAction(value.action);
}

function validResult(value) {
  if (!exactKeys(value, ["kind", "winner", "reason"])) return false;
  if (value.kind === "win") {
    return playerId(value.winner) && ["reached_goal", "no_legal_action", "turn_timeout"].includes(value.reason);
  }
  if (value.kind === "draw") return value.winner === null && value.reason === "max_plies";
  return value.kind === "aborted" && value.winner === null && value.reason === "admin_abort";
}

function validConfig(value) {
  return exactKeys(value, ["width", "height", "wallLimit", "maxPlies", "turnTimeoutMs", "firstPlayer"]) &&
    value.width === 9 && value.height === 13 &&
    (value.wallLimit === null || nonnegativeInteger(value.wallLimit)) &&
    Number.isSafeInteger(value.maxPlies) && value.maxPlies > 0 &&
    (value.turnTimeoutMs === null || (Number.isSafeInteger(value.turnTimeoutMs) && value.turnTimeoutMs > 0)) &&
    playerId(value.firstPlayer);
}

function validPlayer(value, seat) {
  return exactKeys(value, ["color", "position", "wallsUsed"]) &&
    value.color === (seat === "left" ? "red" : "blue") && coordinate(value.position) &&
    nonnegativeInteger(value.wallsUsed);
}

function validWall(value) {
  return exactKeys(value, ["orientation", "x", "y"]) && ["h", "v"].includes(value.orientation) &&
    Number.isInteger(value.x) && Number.isInteger(value.y);
}

function validProfile(value) {
  return value === null || (
    exactKeys(value, ["displayName", "clientType"]) && nonempty(value.displayName) && nonempty(value.clientType)
  );
}

function validInvitation(value) {
  return value === null || (
    exactKeys(value, ["available", "generation"]) && typeof value.available === "boolean" &&
    Number.isSafeInteger(value.generation) && value.generation >= 1
  );
}

function validSeat(value) {
  return exactKeys(value, ["phase", "profile", "invitation"]) &&
    ["open", "claimed", "ready"].includes(value.phase) && validProfile(value.profile) && validInvitation(value.invitation);
}

function validEmptyLegalActions(value) {
  return exactKeys(value, ["moves", "walls", "wallRanges"]) && Array.isArray(value.moves) && value.moves.length === 0 &&
    exactKeys(value.walls, ["h", "v"]) && Array.isArray(value.walls.h) && value.walls.h.length === 0 &&
    Array.isArray(value.walls.v) && value.walls.v.length === 0 &&
    exactKeys(value.wallRanges, ["h", "v"]) && Array.isArray(value.wallRanges.h) && value.wallRanges.h.length === 0 &&
    Array.isArray(value.wallRanges.v) && value.wallRanges.v.length === 0;
}

const TERMINAL_STATE_KEYS = [
  "matchId", "version", "status", "config", "players", "walls", "currentPlayer", "plies", "lastAction",
  "result", "turnDeadlineAt", "seats", "yourPlayer", "yourTurn", "legalActions", "ascii", "rules",
  "wallBudgets", "legalActionList"
];

function validTerminalState(state, matchId, seat) {
  if (!exactKeys(state, TERMINAL_STATE_KEYS) || state.matchId !== matchId || state.status !== "finished" ||
      !nonnegativeInteger(state.version) || state.yourPlayer !== seat || state.yourTurn !== false ||
      state.turnDeadlineAt !== null || !validConfig(state.config) || !playerId(state.currentPlayer) ||
      !nonnegativeInteger(state.plies) || state.plies > state.config.maxPlies ||
      !(state.lastAction === null || validLastAction(state.lastAction)) || !validResult(state.result) ||
      !exactKeys(state.players, ["left", "right"]) || !validPlayer(state.players.left, "left") ||
      !validPlayer(state.players.right, "right") || !Array.isArray(state.walls) || !state.walls.every(validWall) ||
      !exactKeys(state.seats, ["left", "right"]) || !validSeat(state.seats.left) || !validSeat(state.seats.right) ||
      !Array.isArray(state.legalActionList) || state.legalActionList.length !== 0 ||
      !validEmptyLegalActions(state.legalActions) || typeof state.ascii !== "string" || state.ascii.length === 0) {
    return false;
  }
  const rulesValid = isDeepStrictEqual(state.rules, describeMatchRules(state.config));
  const budgetsValid = isDeepStrictEqual(state.wallBudgets, describeWallBudgets(state));
  if (!rulesValid || !budgetsValid) return false;
  if (state.lastAction !== null && state.lastAction.ply !== state.plies) return false;
  return true;
}

function secretKeyPath(value, path = "receipt") {
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (["playerToken", "playerTokens", "adminToken", "inviteCode"].includes(key)) return childPath;
    const nested = secretKeyPath(child, childPath);
    if (nested) return nested;
  }
  return null;
}

export function decodeGrant(record) {
  if (record === undefined) return null;
  if (!exactKeys(record, ["kind", "payload"]) || record.kind !== "grant") fail();
  const payload = record.payload;
  if (payload?.state === "redeeming") {
    if (!exactKeys(payload, ["version", "state", "baseUrl", "inviteCode", "redemptionId"]) ||
        payload.version !== 1 || !nonempty(payload.baseUrl) || !nonempty(payload.inviteCode) ||
        !/^[0-9a-f]{32}$/.test(payload.redemptionId)) fail();
    return structuredClone(payload);
  }
  if (payload?.state === "bound") {
    if (!exactKeys(payload, ["version", "state", "baseUrl", "matchId", "seat", "playerToken"]) ||
        payload.version !== 1 || !nonempty(payload.baseUrl) || !nonempty(payload.matchId) ||
        !["left", "right"].includes(payload.seat) || !nonempty(payload.playerToken)) fail();
    return structuredClone(payload);
  }
  if (payload?.state === "finished") {
    const secret = secretKeyPath(payload.receipt);
    if (!exactKeys(payload, ["version", "state", "matchId", "seat", "receipt"]) ||
        payload.version !== 1 || !nonempty(payload.matchId) || !["left", "right"].includes(payload.seat) ||
        !exactKeys(payload.receipt, ["kind", "state"]) || payload.receipt.kind !== "finished" ||
        !validTerminalState(payload.receipt.state, payload.matchId, payload.seat)) fail();
    if (secret) fail(`: secret field ${secret}`);
    return structuredClone(payload);
  }
  fail();
}

export function credentialKeyForAgent(agentId) {
  return `ball-chess/s-${createHash("sha256").update(agentId).digest("hex")}`;
}

export function inheritedSession(header = {}) {
  return header.isSeeded === true || header.origin === "subagent" || Boolean(header.parentSession);
}

export class BallChessGrantStore {
  constructor(credentials) {
    this.credentials = credentials;
  }

  async read(agentId) {
    return decodeGrant(await this.credentials.readRecord(credentialKeyForAgent(agentId)));
  }

  async beginRedemption(agentId, request) {
    const key = credentialKeyForAgent(agentId);
    const record = await this.credentials.modifyRecord(key, async (current) => {
      const grant = decodeGrant(current);
      if (grant?.state === "bound") throw Object.assign(new Error("This DSH session is already bound to a Ball Chess seat"), { code: "ALREADY_BOUND" });
      if (grant?.state === "redeeming") {
        if (grant.baseUrl !== request.baseUrl || grant.inviteCode !== request.inviteCode) {
          throw Object.assign(new Error("A different invitation redemption is already pending"), { code: "REDEMPTION_IN_PROGRESS" });
        }
        return current;
      }
      return { kind: "grant", payload: { version: 1, state: "redeeming", ...request } };
    });
    return decodeGrant(record);
  }

  async completeRedemption(agentId, redemptionId, binding) {
    const key = credentialKeyForAgent(agentId);
    const record = await this.credentials.modifyRecord(key, async (current) => {
      const grant = decodeGrant(current);
      if (grant?.state !== "redeeming" || grant.redemptionId !== redemptionId) {
        throw Object.assign(new Error("The pending invitation redemption changed"), { code: "REDEMPTION_CHANGED" });
      }
      return { kind: "grant", payload: { version: 1, state: "bound", ...binding } };
    });
    return decodeGrant(record);
  }

  async finish(agentId, matchId, receipt) {
    const key = credentialKeyForAgent(agentId);
    const record = await this.credentials.modifyRecord(key, async (current) => {
      const grant = decodeGrant(current);
      if (grant?.state === "finished" && grant.matchId === matchId) return current;
      if (grant?.state !== "bound" || grant.matchId !== matchId) {
        throw Object.assign(new Error("The Ball Chess binding changed before the terminal receipt was saved"), {
          code: "BINDING_CHANGED"
        });
      }
      const next = {
        kind: "grant",
        payload: {
          version: 1,
          state: "finished",
          matchId,
          seat: grant.seat,
          receipt: structuredClone(receipt)
        }
      };
      decodeGrant(next);
      return next;
    });
    return decodeGrant(record);
  }

  delete(agentId) {
    return this.credentials.deleteRecord(credentialKeyForAgent(agentId));
  }
}
