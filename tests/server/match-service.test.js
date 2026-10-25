import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { MatchStore } from "../../server/store.js";
import { MatchService } from "../../server/match-service.js";

async function fixture(t, options = {}, dependencies = {}) {
  await mkdir(path.join(process.cwd(), ".tmp"), { recursive: true });
  const directory = await mkdtemp(path.join(process.cwd(), ".tmp", "matches-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new MatchStore({ directory });
  const service = await MatchService.open({ store, ...dependencies });
  t.after(() => service.close());
  const created = await service.create({ maxPlies: 40, ...options });
  await service.join(created.matchId, created.playerTokens.left, { name: "L", clientKind: "test" });
  await service.join(created.matchId, created.playerTokens.right, { name: "R", clientKind: "test" });
  return { store, service, created };
}

test("two seats start at version 2 and stale retries do not apply twice", async (t) => {
  const { service, created } = await fixture(t);
  const accepted = await service.submitAction(created.matchId, created.playerTokens.left, 2, { type: "move", direction: "up" });
  assert.equal(accepted.version, 3);
  await assert.rejects(
    service.submitAction(created.matchId, created.playerTokens.left, 2, { type: "move", direction: "up" }),
    (error) => error.code === "STALE_STATE"
  );
  const state = await service.getState(created.matchId, created.playerTokens.left);
  assert.deepEqual(state.players.left.position, [2, 1]);
  assert.equal(state.plies, 1);
});

test("concurrent copies of one version can only apply once", async (t) => {
  const { service, created } = await fixture(t);
  const attempts = await Promise.allSettled([
    service.submitAction(created.matchId, created.playerTokens.left, 2, { type: "move", direction: "up" }),
    service.submitAction(created.matchId, created.playerTokens.left, 2, { type: "move", direction: "left" })
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  const rejected = attempts.find((attempt) => attempt.status === "rejected");
  assert.equal(rejected.reason.code, "STALE_STATE");
  const state = await service.getState(created.matchId);
  assert.equal(state.version, 3);
  assert.equal(state.plies, 1);
});

test("restart rebuilds game from accepted actions and hides exported tokens", async (t) => {
  const { store, service, created } = await fixture(t);
  await service.submitAction(created.matchId, created.playerTokens.left, 2, { type: "move", direction: "up" });
  const restored = await MatchService.open({ store });
  const state = await restored.getState(created.matchId, created.playerTokens.left);
  assert.deepEqual(state.players.left.position, [2, 1]);
  const record = await restored.getRecord(created.matchId);
  assert.equal(JSON.stringify(record).includes("playerTokens"), false);
  assert.equal(JSON.stringify(record).includes(created.adminToken), false);
});

test("expired current player loses without advancing plies", async (t) => {
  const { service, created } = await fixture(t, { turnTimeoutMs: 20 });
  await new Promise((resolve) => setTimeout(resolve, 35));
  const state = await service.getState(created.matchId);
  assert.equal(state.result.reason, "turn_timeout");
  assert.equal(state.result.winner, "right");
  assert.equal(state.plies, 0);
});

test("only admin can abort and aborted games reject later actions", async (t) => {
  const { service, created } = await fixture(t);
  await assert.rejects(service.abort(created.matchId, created.playerTokens.left), (error) => error.code === "FORBIDDEN");
  const aborted = await service.abort(created.matchId, created.adminToken);
  assert.deepEqual(aborted.result, { kind: "aborted", winner: null, reason: "admin_abort" });
  assert.equal(aborted.plies, 0);
  await assert.rejects(
    service.submitAction(created.matchId, created.playerTokens.left, aborted.version, { type: "move", direction: "up" }),
    (error) => error.code === "MATCH_FINISHED"
  );
});

test("random first player is resolved once into the public config", async (t) => {
  const { service, created } = await fixture(t, { firstPlayer: "random" });
  const state = await service.getState(created.matchId);
  assert.ok(["left", "right"].includes(state.config.firstPlayer));
  assert.equal(state.currentPlayer, state.config.firstPlayer);
});

test("deadline wins when an action arrives exactly at the deadline", async (t) => {
  let now = 1_000;
  const scheduled = [];
  const { service, created } = await fixture(t, { turnTimeoutMs: 10 }, {
    now: () => now,
    setTimer: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      scheduled.push(timer);
      return timer;
    },
    clearTimer() {}
  });
  assert.equal(scheduled.at(-1).delay, 10);

  now = 1_010;
  await assert.rejects(
    service.submitAction(created.matchId, created.playerTokens.left, 2, { type: "move", direction: "up" }),
    (error) => error.code === "TURN_EXPIRED"
  );

  const state = await service.getState(created.matchId);
  assert.equal(state.version, 3);
  assert.equal(state.plies, 0);
  assert.deepEqual(state.result, { kind: "win", winner: "right", reason: "turn_timeout" });
});

test("a broken update listener cannot turn a committed action into a failure", async (t) => {
  const background = [];
  const { store, service, created } = await fixture(t, {}, {
    onBackgroundError: (error, context) => background.push({ error, context })
  });
  service.on("update", () => { throw new Error("subscriber broke"); });

  const accepted = await service.submitAction(
    created.matchId,
    created.playerTokens.left,
    2,
    { type: "move", direction: "up" }
  );
  assert.equal(accepted.version, 3);
  assert.equal(background.length, 1);
  assert.equal(background[0].context.operation, "publish_update");

  const restored = await MatchService.open({ store });
  t.after(() => restored.close());
  assert.equal((await restored.getState(created.matchId)).version, 3);
});

test("a rejected asynchronous update listener is reported in the background", async (t) => {
  const background = [];
  const { service, created } = await fixture(t, {}, {
    onBackgroundError: (error, context) => background.push({ error, context })
  });
  service.on("update", async () => { throw new Error("async subscriber broke"); });

  const accepted = await service.submitAction(
    created.matchId,
    created.playerTokens.left,
    2,
    { type: "move", direction: "up" }
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(accepted.version, 3);
  assert.equal(background.length, 1);
  assert.equal(background[0].context.operation, "publish_update");
});

test("a failed save changes neither memory nor notifications", async (t) => {
  const { store, service, created } = await fixture(t);
  const saved = store.save.bind(store);
  let updates = 0;
  service.on("update", () => { updates += 1; });
  store.save = async () => { throw new Error("disk full"); };

  await assert.rejects(
    service.submitAction(created.matchId, created.playerTokens.left, 2, { type: "move", direction: "up" }),
    (error) => error.code === "STORAGE_ERROR"
  );
  assert.equal((await service.getState(created.matchId)).version, 2);
  assert.equal(updates, 0);

  store.save = saved;
});
