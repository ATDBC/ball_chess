import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldAcceptSnapshot,
  canInteract,
  nextReadyValue,
  resolveInteractionMode,
  seatPhaseText,
  wallsRemaining
} from "../../web/state-view.js";

test("snapshots cannot roll the board backward", () => {
  assert.equal(shouldAcceptSnapshot({ version: 4 }, { version: 3 }), false);
  assert.equal(shouldAcceptSnapshot({ version: 4 }, { version: 4 }), true);
  assert.equal(shouldAcceptSnapshot(null, { version: 0 }), true);
});

test("spectators cannot act and unlimited walls display infinity", () => {
  assert.equal(canInteract({ status: "playing", yourTurn: false }), false);
  assert.equal(wallsRemaining({ config: { wallLimit: null }, players: { left: { wallsUsed: 9 } } }, "left"), "∞");
});

test("wall mode survives opponent snapshots and resets only for own exhausted walls", () => {
  const waiting = { status: "playing", yourTurn: false, result: null, legalActions: [] };
  assert.equal(resolveInteractionMode(waiting, "wall", false), "wall");
  const exhausted = { status: "playing", yourTurn: true, result: null, legalActions: [{ type: "move", direction: "up" }] };
  assert.equal(resolveInteractionMode(exhausted, "wall", false), "move");
});

test("ready control is available only for the current claimed or ready seat", () => {
  const state = {
    status: "waiting",
    yourPlayer: "left",
    seats: { left: { phase: "claimed" }, right: { phase: "open" } }
  };
  assert.equal(nextReadyValue(state), true);
  state.seats.left.phase = "ready";
  assert.equal(nextReadyValue(state), false);
  state.status = "playing";
  assert.equal(nextReadyValue(state), null);
  assert.equal(nextReadyValue({ ...state, status: "waiting", yourPlayer: undefined }), null);
});

test("seat phase text distinguishes open, claimed, and ready", () => {
  assert.equal(seatPhaseText("open"), "等待加入");
  assert.equal(seatPhaseText("claimed"), "已加入");
  assert.equal(seatPhaseText("ready"), "已准备");
});
