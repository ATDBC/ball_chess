import { isDeepStrictEqual } from "node:util";
import { createGame, otherPlayer } from "../core/state.js";
import { applyAction, settleCurrentTurn } from "../core/engine.js";
import { listLegalActions } from "../core/legal.js";
import { GameError } from "../core/errors.js";
import { assertStoredMatchV1, assertStoredMatchV2 } from "./match-schema.js";

const SEATS = ["left", "right"];

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

function replay(record) {
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
    game.result = structuredClone(record.result);
  }
  return { game, replayResult };
}

function expectedV1Status(record) {
  if (record.result !== null) return "finished";
  return record.joined.left && record.joined.right ? "playing" : "waiting";
}

function assertActionTimes(record) {
  if (record.updatedAt < record.createdAt) corrupt("updatedAt precedes createdAt");
  let previousAt = record.createdAt;
  for (const [index, entry] of record.actions.entries()) {
    if (entry.at < previousAt || entry.at > record.updatedAt) {
      corrupt(`actions[${index}].at is out of order`);
    }
    previousAt = entry.at;
  }
}

function assertV1Metadata(record, replayResult) {
  for (const seat of SEATS) {
    if (record.joined[seat] !== (record.profiles[seat] !== null)) {
      corrupt(`profiles.${seat} contradicts joined.${seat}`);
    }
  }
  assertActionTimes(record);
  const externalIncrement = record.result !== null && replayResult === null ? 1 : 0;
  const expectedVersion = Number(record.joined.left) + Number(record.joined.right)
    + record.actions.length + externalIncrement;
  if (record.version !== expectedVersion) corrupt("version contradicts accepted mutations");
  const status = expectedV1Status(record);
  if (record.status !== status) corrupt("status contradicts the record");
  if (record.result?.reason === "turn_timeout" && !(record.joined.left && record.joined.right)) {
    corrupt("turn timeout exists before both seats joined");
  }
  if (record.actions.length > 0 && !(record.joined.left && record.joined.right)) {
    corrupt("actions exist before both seats joined");
  }
  if (status === "playing") {
    const expectedDeadline = record.config.turnTimeoutMs === null
      ? null
      : record.updatedAt + record.config.turnTimeoutMs;
    if (record.turnDeadlineAt !== expectedDeadline) corrupt("turnDeadlineAt contradicts the active turn");
  } else if (record.turnDeadlineAt !== null) {
    corrupt("turnDeadlineAt exists outside an active timed turn");
  }
}

function assertV2Metadata(record) {
  assertActionTimes(record);
  if (record.startedAt !== null && (
    record.startedAt < record.createdAt
    || record.startedAt > record.updatedAt
  )) {
    corrupt("startedAt is outside the match lifetime");
  }
  for (const seat of SEATS) {
    const { phase, profile } = record.seats[seat];
    if ((phase === "open") !== (profile === null)) {
      corrupt(`seats.${seat} phase contradicts profile`);
    }
    const invitation = record.invitations[seat];
    if (invitation !== null) {
      if (invitation.expiresAt < record.createdAt) {
        corrupt(`invitations.${seat}.expiresAt precedes match creation`);
      }
      if (invitation.consumedAt !== null && (
        invitation.consumedAt < record.createdAt
        || invitation.consumedAt > record.updatedAt
        || invitation.consumedAt >= invitation.expiresAt
      )) {
        corrupt(`invitations.${seat}.consumedAt is invalid`);
      }
      if (invitation.consumedAt === null && phase !== "open") {
        corrupt(`invitations.${seat} is active for an occupied seat`);
      }
      if (invitation.consumedAt !== null && phase === "open") {
        corrupt(`invitations.${seat} was consumed without claiming the seat`);
      }
    }
  }

  const status = statusFor(record);
  if (record.startedAt === null) {
    if (record.actions.length > 0) corrupt("actions exist before startedAt");
    if (record.seats.left.phase === "ready" && record.seats.right.phase === "ready") {
      corrupt("both seat phases are ready without startedAt");
    }
    if (record.result !== null && record.result.reason !== "admin_abort") {
      corrupt("non-abort result exists before startedAt");
    }
  } else {
    if (record.seats.left.phase !== "ready" || record.seats.right.phase !== "ready") {
      corrupt("startedAt requires both seat phases to be ready");
    }
    if (record.actions[0]?.at < record.startedAt) corrupt("first action precedes startedAt");
  }

  if (status === "playing") {
    const expectedDeadline = record.config.turnTimeoutMs === null
      ? null
      : record.updatedAt + record.config.turnTimeoutMs;
    if (record.turnDeadlineAt !== expectedDeadline) corrupt("turnDeadlineAt contradicts the active turn");
  } else if (record.turnDeadlineAt !== null) {
    corrupt("turnDeadlineAt exists outside an active timed turn");
  }
}

function migrateV1(record, game) {
  const started = record.status === "playing"
    || (record.status === "finished" && (record.joined.left && record.joined.right));
  return {
    schemaVersion: 2,
    id: record.id,
    adminToken: record.adminToken,
    playerTokens: structuredClone(record.playerTokens),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    startedAt: started ? (record.actions[0]?.at ?? record.updatedAt) : null,
    seats: Object.fromEntries(SEATS.map((seat) => [seat, {
      phase: started ? "ready" : (record.joined[seat] ? "claimed" : "open"),
      profile: structuredClone(record.profiles[seat])
    }])),
    invitations: { left: null, right: null },
    version: record.version,
    turnDeadlineAt: record.turnDeadlineAt,
    config: structuredClone(record.config),
    actions: structuredClone(record.actions),
    game
  };
}

function invitationSummary(record, seat, now) {
  const invitation = record.invitations[seat];
  if (invitation === null) return null;
  return {
    available: statusFor(record) === "waiting"
      && record.seats[seat].phase === "open"
      && invitation.consumedAt === null
      && now < invitation.expiresAt,
    generation: invitation.generation
  };
}

export function statusFor(record) {
  const result = record.game ? record.game.result : record.result;
  if (result !== null) return "finished";
  return record.startedAt === null ? "waiting" : "playing";
}

export function createMatchRecord({ id, adminToken, playerTokens, config, now = Date.now() }) {
  return {
    schemaVersion: 2,
    id,
    adminToken,
    playerTokens,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    seats: {
      left: { phase: "open", profile: null },
      right: { phase: "open", profile: null }
    },
    invitations: { left: null, right: null },
    version: 0,
    turnDeadlineAt: null,
    config,
    actions: [],
    game: createGame(config)
  };
}

export function toPublicState(record, seat = null, now = Date.now()) {
  const game = structuredClone(record.game);
  const status = statusFor(record);
  const yourTurn = seat !== null && status === "playing" && game.currentPlayer === seat && !game.result;
  return {
    matchId: record.id,
    version: record.version,
    status,
    ...game,
    turnDeadlineAt: record.turnDeadlineAt,
    seats: Object.fromEntries(SEATS.map((seatId) => [seatId, {
      phase: record.seats[seatId].phase,
      profile: structuredClone(record.seats[seatId].profile),
      invitation: invitationSummary(record, seatId, now)
    }])),
    ...(seat ? { yourPlayer: seat, yourTurn, legalActions: yourTurn ? listLegalActions(game, seat) : [] } : {})
  };
}

export function serializeMatch(record) {
  return {
    schemaVersion: 2,
    id: record.id,
    adminToken: record.adminToken,
    playerTokens: structuredClone(record.playerTokens),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    startedAt: record.startedAt,
    seats: structuredClone(record.seats),
    invitations: structuredClone(record.invitations),
    version: record.version,
    turnDeadlineAt: record.turnDeadlineAt,
    config: structuredClone(record.config),
    actions: structuredClone(record.actions),
    result: structuredClone(record.game.result)
  };
}

export function restoreMatch(raw) {
  const record = structuredClone(raw);
  if (record.schemaVersion === 1) {
    assertStoredMatchV1(record, record.id);
    const { game, replayResult } = replay(record);
    assertV1Metadata(record, replayResult);
    const migrated = migrateV1(record, game);
    assertV2Metadata({ ...migrated, result: game.result });
    return migrated;
  }
  assertStoredMatchV2(record, record.id);
  const { game } = replay(record);
  const restored = { ...record, game };
  delete restored.result;
  assertV2Metadata({ ...restored, result: game.result });
  return restored;
}

export function claimMatchRecord(record, seat, profile, now = Date.now()) {
  if (record.seats[seat].phase !== "open") return record;
  if (record.game.result) {
    throw new GameError("MATCH_FINISHED", "Match is finished", { result: record.game.result });
  }
  const next = structuredClone(record);
  next.seats[seat] = { phase: "claimed", profile: structuredClone(profile) };
  if (next.invitations[seat]?.consumedAt === null) next.invitations[seat] = null;
  next.updatedAt = now;
  next.version += 1;
  return next;
}

export function setReadyMatchRecord(record, seat, ready, now = Date.now()) {
  if (record.game.result) {
    throw new GameError("MATCH_FINISHED", "Match is finished", { result: record.game.result });
  }
  if (record.startedAt !== null) {
    throw new GameError("MATCH_ALREADY_STARTED", "Match has already started");
  }
  if (record.seats[seat].phase === "open") {
    throw new GameError("SEAT_NOT_CLAIMED", "Seat must be claimed before it can be ready");
  }
  const targetPhase = ready ? "ready" : "claimed";
  if (record.seats[seat].phase === targetPhase) return record;

  const next = structuredClone(record);
  next.seats[seat].phase = targetPhase;
  next.updatedAt = now;
  next.version += 1;
  if (next.seats.left.phase === "ready" && next.seats.right.phase === "ready") {
    next.startedAt = now;
    next.game = settleCurrentTurn(next.game);
    next.turnDeadlineAt = next.game.result ? null : deadlineFor(next, now);
  }
  return next;
}

export function createInvitationRecord(record, seat, digest, expiresAt, now = Date.now()) {
  const status = statusFor(record);
  if (status === "finished") {
    throw new GameError("MATCH_FINISHED", "Match is finished", { result: record.game.result });
  }
  if (status !== "waiting") {
    throw new GameError("MATCH_ALREADY_STARTED", "Match has already started");
  }
  if (record.seats[seat].phase !== "open") {
    throw new GameError("SEAT_NOT_OPEN", "Seat is not open");
  }
  const previous = record.invitations[seat];
  const next = structuredClone(record);
  next.invitations[seat] = {
    generation: (previous?.generation ?? 0) + 1,
    digest,
    expiresAt,
    consumedAt: null,
    redemptionId: null
  };
  next.updatedAt = now;
  next.version += 1;
  return next;
}

export function redeemInvitationRecord(record, seat, digest, redemptionId, profile, now = Date.now()) {
  const invitation = record.invitations[seat];
  if (
    invitation?.digest === digest
    && invitation.consumedAt !== null
    && invitation.redemptionId === redemptionId
  ) {
    return record;
  }
  if (invitation?.digest !== digest) {
    throw new GameError("INVITE_INVALID", "Invitation code is invalid");
  }
  if (invitation.consumedAt !== null) {
    throw new GameError("INVITE_CONSUMED", "Invitation code has already been used");
  }
  if (now >= invitation.expiresAt) {
    throw new GameError("INVITE_EXPIRED", "Invitation code has expired");
  }
  const status = statusFor(record);
  if (status === "finished") {
    throw new GameError("MATCH_FINISHED", "Match is finished", { result: record.game.result });
  }
  if (status !== "waiting") {
    throw new GameError("MATCH_ALREADY_STARTED", "Match has already started");
  }
  if (record.seats[seat].phase !== "open") {
    throw new GameError("SEAT_NOT_OPEN", "Seat is not open");
  }

  const next = structuredClone(record);
  next.seats[seat] = { phase: "claimed", profile: structuredClone(profile) };
  next.invitations[seat].consumedAt = now;
  next.invitations[seat].redemptionId = redemptionId;
  next.updatedAt = now;
  next.version += 1;
  return next;
}

// Transitional compatibility for token-based clients until the service and
// clients adopt separate claim and ready requests.
export function joinMatchRecord(record, seat, profile, now = Date.now()) {
  if (record.seats[seat].phase !== "open") return record;
  if (record.game.result) throw new GameError("MATCH_FINISHED", "Match is finished", { result: record.game.result });
  const next = structuredClone(record);
  next.seats[seat] = { phase: "claimed", profile: structuredClone(profile) };
  next.invitations[seat] = null;
  next.updatedAt = now;
  next.version += 1;
  if (next.seats.left.phase !== "open" && next.seats.right.phase !== "open") {
    next.seats.left.phase = "ready";
    next.seats.right.phase = "ready";
    next.startedAt = now;
    next.game = settleCurrentTurn(next.game);
    next.turnDeadlineAt = next.game.result ? null : deadlineFor(next, now);
  }
  return next;
}

export function submitMatchAction(record, seat, expectedVersion, action, now = Date.now()) {
  const status = statusFor(record);
  if (status === "waiting") throw new GameError("MATCH_NOT_READY", "Both seats must be ready before play");
  if (status !== "playing" || record.game.result) {
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
  next.turnDeadlineAt = next.game.result ? null : deadlineFor(next, now);
  return next;
}

export function expireMatchRecord(record, now = Date.now()) {
  if (statusFor(record) !== "playing" || record.game.result) return record;
  const next = structuredClone(record);
  const loser = next.game.currentPlayer;
  next.game.result = { kind: "win", winner: otherPlayer(loser), reason: "turn_timeout" };
  next.version += 1;
  next.updatedAt = now;
  next.turnDeadlineAt = null;
  return next;
}

export function abortMatchRecord(record, now = Date.now()) {
  if (record.game.result) return record;
  const next = structuredClone(record);
  next.game.result = { kind: "aborted", winner: null, reason: "admin_abort" };
  next.version += 1;
  next.updatedAt = now;
  next.turnDeadlineAt = null;
  for (const seat of SEATS) {
    if (next.invitations[seat]?.consumedAt === null) next.invitations[seat] = null;
  }
  return next;
}
