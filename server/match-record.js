import { createGame, otherPlayer } from "../core/state.js";
import { applyAction, settleCurrentTurn } from "../core/engine.js";
import { listLegalActions } from "../core/legal.js";
import { GameError } from "../core/errors.js";

function deadlineFor(record, now) {
  return record.config.turnTimeoutMs === null ? null : now + record.config.turnTimeoutMs;
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
  let game = createGame(raw.config);
  for (const entry of raw.actions) game = applyAction(game, entry.player, entry.action);
  game.result = structuredClone(raw.result);
  return { ...structuredClone(raw), game };
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
