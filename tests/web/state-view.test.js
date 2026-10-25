import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldAcceptSnapshot,
  canInteract,
  nextReadyValue,
  rulePanelLines,
  resolveInteractionMode,
  seatPhaseText,
  wallsRemaining
} from "../../web/state-view.js";

test("rule panel follows finite and unlimited wall settings", () => {
  const base = {
    config: {
      width: 9,
      height: 13,
      firstPlayer: "left",
      maxPlies: 300,
      turnTimeoutMs: null,
      wallLimit: 5
    },
    players: { left: { wallsUsed: 2 }, right: { wallsUsed: 1 } }
  };
  assert.deepEqual(rulePanelLines(base), [
    "棋盘 9×13；双方目标均为到达 y=12",
    "每回合只能行动一次：正交移动一格或放置一堵覆盖两条边的墙；不能斜走、跳跃、进入对方格或跳过回合",
    "墙不得重叠或交叉；允许端点连接和 T 形连接，并且必须为双方保留到达目标行的路径",
    "先手：左方；最多 300 手；不限时",
    "墙：每方 5 堵；左方剩余 3，右方剩余 4"
  ]);
  assert.equal(rulePanelLines({ ...base, config: { ...base.config, wallLimit: null } })[4], "墙：无限；左方已用 2，右方已用 1");
});

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
