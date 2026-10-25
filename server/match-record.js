import { isDeepStrictEqual } from "node:util";
import { createGame, otherPlayer } from "../core/state.js";
import { applyAction, settleCurrentTurn } from "../core/engine.js";
import { listLegalActions } from "../core/legal.js";
import { GameError } from "../core/errors.js";

function deadlineFor(record, now) {
  return record.config.turnTimeoutMs === null ? null : now + record.config.turnTimeoutMs;
}

function corrupt(message) {
  throw new Error(`Invalid match record: ${message}`);
}

function isExternalResult(result, game) {
  if (result?.reason === "admin_abort") {
    return result.kind === "aborted" && result.winner === null;
  }
  if (result?.reason === "turn_timeout") {
    return result.kind === "win" && result.winner === otherPlayer(game.currentPlayer);
  }
  return false;
}

function expectedStatus(record, result) {
  if (result !== null) return "finished";
  return record.joined.left && record.joined.right ? "playing" : "waiting";
}

function assertMetadata(record, replayResult) {
  for (const seat of ["left", "right"]) {
    if (record.joined[seat] !== (record.profiles[seat] !== null)) {
      corrupt(`profiles.${seat} contradicts joined.${seat}`);
    }
  }
  if (record.updatedAt < record.createdAt) corrupt("updatedAt precedes createdAt");
  let previousAt = record.createdAt;
  for (const [index, entry] of record.actions.entries()) {
    if (entry.at < previousAt || entry.at > record.updatedAt) corrupt(`actions[${index}].at is out of order`);
    previousAt = entry.at;
  }
  const externalIncrement = record.result !== null && replayResult === null ? 1 : 0;
  const expectedVersion = Number(record.joined.left) + Number(record.joined.right)
    + record.actions.length + externalIncrement;
  if (record.version !== expectedVersion) corrupt("version contradicts accepted mutations");
  const status = expectedStatus(record, record.result);
  if (record.status !== status) corrupt("status contradicts the record");
  if (status === "playing") {
    const expectedDeadline = record.config.turnTimeoutMs === null
      ? null
      : record.updatedAt + record.config.turnTimeoutMs;
    if (record.turnDeadlineAt !== expectedDeadline) corrupt("turnDeadlineAt contradicts the active turn");
  } else if (record.turnDeadlineAt !== null) {
    corrupt("turnDeadlineAt exists outside an active timed turn");
  }
}

export function createMatchRecord({ id, adminToken, playerTokens, config, now = Date.now() }) {
  return {
    schemaVersion: 1,
    id,
    adminToken,
    playerTokens,
    createdAt: now,
    updatedAt: now,
    joined: { left: false, right: false },
    profiles: { left: null, right: null },
    status: "waiting",
    version: 0,
    turnDeadlineAt: null,
    config,
    actions: [],
    game: createGame(config)
  };
}

export function toPublicState(record, seat = null) {
  const game = structuredClone(record.game);
  const yourTurn = seat !== null && record.status === "playing" && game.currentPlayer === seat && !game.result;
  return {
    matchId: record.id,
    version: record.version,
    status: record.status,
    ...game,
    turnDeadlineAt: record.turnDeadlineAt,
    seats: {
      left: { joined: record.joined.left, profile: structuredClone(record.profiles.left) },
      right: { joined: record.joined.right, profile: structuredClone(record.profiles.right) }
    },
    ...(seat ? { yourPlayer: seat, yourTurn, legalActions: yourTurn ? listLegalActions(game, seat) : [] } : {})
  };
}

export function serializeMatch(record) {
  return {
    schemaVersion: 1,
    id: record.id,
    adminToken: record.adminToken,
    playerTokens: structuredClone(record.playerTokens),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    joined: structuredClone(record.joined),
    profiles: structuredClone(record.profiles),
    status: record.status,
    version: record.version,
    turnDeadlineAt: record.turnDeadlineAt,
    config: structuredClone(record.config),
    actions: structuredClone(record.actions),
    result: structuredClone(record.game.result)
  };
}

export function restoreMatch(raw) {
  const record = structuredClone(raw);
  let game = createGame(record.config);
  for (const [index, entry] of record.actions.entries()) {
    game = applyAction(game, entry.player, entry.action);
    if (game.plies !== entry.ply) corrupt(`actions[${index}].ply contradicts replay`);
  }

  const replayResult = structuredClone(game.result);
  if (replayResult !== null) {
    if (!isDeepStrictEqual(record.result, replayResult)) corrupt("result contradicts replay");
  } else if (record.result !== null) {
    if (!isExternalResult(record.result, game)) corrupt("result contradicts replay");
    if (record.result.reason === "turn_timeout" && !(record.joined.left && record.joined.right)) {
      corrupt("turn timeout exists before both seats joined");
    }
    game.result = structuredClone(record.result);
  }

  assertMetadata(record, replayResult);
  return { ...record, game };
}

export function joinMatchRecord(record, seat, profile, now = Date.now()) {
  if (record.joined[seat]) return record;
  if (record.game.result) throw new GameError("MATCH_FINISHED", "Match is finished", { result: record.game.result });
  const next = structuredClone(record);
  next.joined[seat] = true;
  next.profiles[seat] = structuredClone(profile);
  next.updatedAt = now;
  next.version += 1;
  if (next.joined.left && next.joined.right) {
    next.status = "playing";
    next.turnDeadlineAt = deadlineFor(next, now);
    next.game = settleCurrentTurn(next.game);
    if (next.game.result) {
      next.status = "finished";
      next.turnDeadlineAt = null;
    }
  }
  return next;
}

export function submitMatchAction(record, seat, expectedVersion, action, now = Date.now()) {
  if (record.status === "waiting") throw new GameError("MATCH_NOT_READY", "Both seats must join before play");
  if (record.status !== "playing" || record.game.result) {
    throw new GameError("MATCH_FINISHED", "Match is finished", { result: record.game.result });
  }
  if (record.version !== expectedVersion) {
    throw new GameError("STALE_STATE", "Action was based on an old state", { expectedVersion, currentVersion: record.version });
  }
  const next = structuredClone(record);
  next.game = applyAction(record.game, seat, action);
  next.actions.push({ player: seat, ply: next.game.plies, action: structuredClone(action), at: now });
  next.version += 1;
  next.updatedAt = now;
  next.status = next.game.result ? "finished" : "playing";
  next.turnDeadlineAt = next.game.result ? null : deadlineFor(next, now);
  return next;
}

export function expireMatchRecord(record, now = Date.now()) {
  if (record.status !== "playing" || record.game.result) return record;
  const next = structuredClone(record);
  const loser = next.game.currentPlayer;
  next.game.result = { kind: "win", winner: otherPlayer(loser), reason: "turn_timeout" };
  next.status = "finished";
  next.version += 1;
  next.updatedAt = now;
  next.turnDeadlineAt = null;
  return next;
}

export function abortMatchRecord(record, now = Date.now()) {
  if (record.game.result) return record;
  const next = structuredClone(record);
  next.game.result = { kind: "aborted", winner: null, reason: "admin_abort" };
  next.status = "finished";
  next.version += 1;
  next.updatedAt = now;
  next.turnDeadlineAt = null;
  return next;
}
