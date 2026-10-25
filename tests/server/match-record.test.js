import test from "node:test";
import assert from "node:assert/strict";
import {
  abortMatchRecord,
  createMatchRecord,
  expireMatchRecord,
  joinMatchRecord,
  restoreMatch,
  serializeMatch,
  statusFor,
  submitMatchAction,
  toPublicState
} from "../../server/match-record.js";

const config = {
  width: 9,
  height: 13,
  wallLimit: null,
  maxPlies: 300,
  turnTimeoutMs: null,
  firstPlayer: "left"
};

function waitingRecord(overrides = {}) {
  return createMatchRecord({
    id: "m_test",
    adminToken: "admin",
    playerTokens: { left: "left", right: "right" },
    config: { ...config, ...overrides },
    now: 100
  });
}

function playingRecord(overrides = {}) {
  let record = waitingRecord(overrides);
  record = joinMatchRecord(record, "left", { displayName: "L", clientType: "test" }, 110);
  return joinMatchRecord(record, "right", { displayName: "R", clientType: "test" }, 120);
}

function storedV1(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "m_legacy",
    adminToken: "admin",
    playerTokens: { left: "left", right: "right" },
    createdAt: 100,
    updatedAt: 100,
    joined: { left: false, right: false },
    profiles: { left: null, right: null },
    status: "waiting",
    version: 0,
    turnDeadlineAt: null,
    config: structuredClone(config),
    actions: [],
    result: null,
    ...overrides
  };
}

test("new records use v2 phases and derive public status", () => {
  const record = waitingRecord();
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.startedAt, null);
  assert.deepEqual(record.seats, {
    left: { phase: "open", profile: null },
    right: { phase: "open", profile: null }
  });
  assert.deepEqual(record.invitations, { left: null, right: null });
  assert.equal(Object.hasOwn(record, "status"), false);
  assert.equal(statusFor(record), "waiting");

  const publicState = toPublicState(record, null, 100);
  assert.equal(publicState.status, "waiting");
  assert.deepEqual(publicState.seats.left, {
    phase: "open",
    profile: null,
    invitation: null
  });
  assert.equal("playerTokens" in publicState, false);
});

test("serialize always emits v2 without persisted status", () => {
  const raw = serializeMatch(waitingRecord());
  assert.equal(raw.schemaVersion, 2);
  assert.equal(Object.hasOwn(raw, "status"), false);
  assert.equal(Object.hasOwn(raw, "game"), false);
  assert.equal(raw.result, null);
});

test("restore migrates waiting v1 seats to open and claimed", () => {
  const migrated = restoreMatch(storedV1({
    joined: { left: true, right: false },
    profiles: { left: { name: "Legacy" }, right: null },
    version: 1,
    updatedAt: 110
  }));
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.startedAt, null);
  assert.deepEqual(migrated.seats, {
    left: { phase: "claimed", profile: { name: "Legacy" } },
    right: { phase: "open", profile: null }
  });
  assert.deepEqual(migrated.invitations, { left: null, right: null });
  assert.equal(statusFor(migrated), "waiting");
});

test("restore migrates playing v1 records and derives startedAt", () => {
  const noActions = restoreMatch(storedV1({
    joined: { left: true, right: true },
    profiles: { left: {}, right: {} },
    status: "playing",
    version: 2,
    updatedAt: 120,
    config: { ...config, turnTimeoutMs: 10 },
    turnDeadlineAt: 130
  }));
  assert.equal(noActions.startedAt, 120);
  assert.equal(noActions.turnDeadlineAt, 130);
  assert.equal(statusFor(noActions), "playing");
  assert.equal(noActions.seats.left.phase, "ready");
  assert.equal(noActions.seats.right.phase, "ready");

  const withAction = restoreMatch(storedV1({
    joined: { left: true, right: true },
    profiles: { left: {}, right: {} },
    status: "playing",
    version: 3,
    updatedAt: 130,
    actions: [{ player: "left", ply: 1, action: { type: "move", direction: "up" }, at: 125 }]
  }));
  assert.equal(withAction.startedAt, 125);
});

test("restore migrates started and unstarted finished v1 records distinctly", () => {
  const started = restoreMatch(storedV1({
    joined: { left: true, right: true },
    profiles: { left: {}, right: {} },
    status: "finished",
    version: 3,
    updatedAt: 130,
    result: { kind: "aborted", winner: null, reason: "admin_abort" }
  }));
  assert.equal(started.startedAt, 130);
  assert.equal(started.seats.left.phase, "ready");
  assert.equal(statusFor(started), "finished");

  const unstarted = restoreMatch(storedV1({
    joined: { left: true, right: false },
    profiles: { left: {}, right: null },
    status: "finished",
    version: 2,
    updatedAt: 115,
    result: { kind: "aborted", winner: null, reason: "admin_abort" }
  }));
  assert.equal(unstarted.startedAt, null);
  assert.equal(unstarted.seats.left.phase, "claimed");
  assert.equal(unstarted.seats.right.phase, "open");
});

test("restore rejects invalid native v2 metadata", () => {
  const raw = serializeMatch(waitingRecord({ turnTimeoutMs: 10 }));
  assert.throws(() => restoreMatch({
    ...structuredClone(raw),
    seats: { ...raw.seats, left: { phase: "open", profile: {} } }
  }), /seats\.left/);
  assert.throws(() => restoreMatch({
    ...structuredClone(raw),
    startedAt: 100,
    seats: {
      left: { phase: "ready", profile: {} },
      right: { phase: "claimed", profile: {} }
    }
  }), /startedAt|phase/);
  assert.throws(() => restoreMatch({
    ...structuredClone(raw),
    turnDeadlineAt: 999
  }), /turnDeadlineAt/);
});

test("restore rejects a stored result that contradicts action replay", () => {
  const record = submitMatchAction(
    playingRecord({ maxPlies: 1 }),
    "left",
    2,
    { type: "move", direction: "up" },
    130
  );
  const raw = serializeMatch(record);
  raw.result = null;
  assert.throws(() => restoreMatch(raw), /result contradicts replay/);
});

test("restore accepts only valid timeout and abort results outside the rule engine", () => {
  const playing = playingRecord({ turnTimeoutMs: 10 });
  const expired = expireMatchRecord(playing, 130);
  assert.equal(restoreMatch(serializeMatch(expired)).game.result.reason, "turn_timeout");
  const aborted = abortMatchRecord(waitingRecord(), 130);
  assert.equal(restoreMatch(serializeMatch(aborted)).game.result.reason, "admin_abort");

  const forged = serializeMatch(playing);
  forged.result = { kind: "win", winner: "left", reason: "reached_goal" };
  forged.version += 1;
  forged.turnDeadlineAt = null;
  assert.throws(() => restoreMatch(forged), /result contradicts replay/);

  const wrongTimeoutWinner = serializeMatch(playing);
  wrongTimeoutWinner.result = { kind: "win", winner: "left", reason: "turn_timeout" };
  wrongTimeoutWinner.version += 1;
  wrongTimeoutWinner.turnDeadlineAt = null;
  assert.throws(() => restoreMatch(wrongTimeoutWinner), /result contradicts replay/);
});

test("v1 contradictions are rejected before migration", () => {
  const raw = storedV1({
    joined: { left: true, right: true },
    profiles: { left: {}, right: {} },
    status: "playing",
    version: 2,
    updatedAt: 120,
    config: { ...config, turnTimeoutMs: 10 },
    turnDeadlineAt: 130
  });
  assert.throws(() => restoreMatch({ ...structuredClone(raw), status: "waiting" }), /status/);
  assert.throws(() => restoreMatch({ ...structuredClone(raw), version: 99 }), /version/);
  assert.throws(() => restoreMatch({ ...structuredClone(raw), turnDeadlineAt: 999 }), /turnDeadlineAt/);
});
