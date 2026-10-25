import test from "node:test";
import assert from "node:assert/strict";
import {
  abortMatchRecord,
  createMatchRecord,
  expireMatchRecord,
  joinMatchRecord,
  restoreMatch,
  serializeMatch,
  submitMatchAction
} from "../../server/match-record.js";

function waitingRecord(config = {}) {
  return createMatchRecord({
    id: "m_test",
    adminToken: "admin",
    playerTokens: { left: "left", right: "right" },
    config: {
      width: 9,
      height: 13,
      wallLimit: null,
      maxPlies: 300,
      turnTimeoutMs: null,
      firstPlayer: "left",
      ...config
    },
    now: 100
  });
}

function playingRecord(config = {}) {
  let record = waitingRecord(config);
  record = joinMatchRecord(record, "left", { name: "L" }, 110);
  return joinMatchRecord(record, "right", { name: "R" }, 120);
}

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
  forged.status = "finished";
  forged.version += 1;
  forged.turnDeadlineAt = null;
  assert.throws(() => restoreMatch(forged), /result contradicts replay/);

  const wrongTimeoutWinner = serializeMatch(playing);
  wrongTimeoutWinner.result = { kind: "win", winner: "left", reason: "turn_timeout" };
  wrongTimeoutWinner.status = "finished";
  wrongTimeoutWinner.version += 1;
  wrongTimeoutWinner.turnDeadlineAt = null;
  assert.throws(() => restoreMatch(wrongTimeoutWinner), /result contradicts replay/);
});

test("restore derives and checks v1 status, version and deadline", () => {
  const raw = serializeMatch(playingRecord({ turnTimeoutMs: 10 }));
  assert.equal(restoreMatch(raw).status, "playing");

  assert.throws(() => restoreMatch({ ...structuredClone(raw), status: "waiting" }), /status/);
  assert.throws(() => restoreMatch({ ...structuredClone(raw), version: 99 }), /version/);
  assert.throws(() => restoreMatch({ ...structuredClone(raw), turnDeadlineAt: 999 }), /turnDeadlineAt/);
});
