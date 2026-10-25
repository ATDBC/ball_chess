import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptSnapshot,
  activateIdentity,
  createAppState,
  createRefreshCoordinator,
  stageFor
} from "../../web/app-state.js";

test("application state projects the four match stages", () => {
  const outside = createAppState();
  assert.equal(stageFor(outside), "outside");
  const active = activateIdentity(outside, { matchId: "m_one", role: "player", seat: "left", playerToken: "secret" });
  assert.equal(stageFor(active), "waiting");
  const playing = acceptSnapshot(active, { matchId: "m_one", version: 2, status: "playing" }, active.identity.epoch);
  assert.equal(stageFor(playing), "playing");
  assert.equal(stageFor(acceptSnapshot(playing, { matchId: "m_one", version: 3, status: "finished" }, playing.identity.epoch)), "finished");
});
test("obsolete identities and older snapshots cannot replace trusted state", () => {
  const first = activateIdentity(createAppState(), { matchId: "m_one", role: "spectator" });
  const trusted = acceptSnapshot(first, { matchId: "m_one", version: 4, status: "playing" }, first.identity.epoch);
  assert.equal(acceptSnapshot(trusted, { matchId: "m_one", version: 3, status: "waiting" }, trusted.identity.epoch), trusted);
  const second = activateIdentity(trusted, { matchId: "m_two", role: "spectator" });
  assert.equal(acceptSnapshot(second, { matchId: "m_one", version: 9, status: "finished" }, first.identity.epoch), second);
});
test("refresh coordinator coalesces concurrent work and permits a later refresh", async () => {
  let calls = 0;
  let release;
  const coordinator = createRefreshCoordinator(async () => {
    calls += 1;
    await new Promise((resolve) => { release = resolve; });
    return calls;
  });
  const first = coordinator.refresh();
  const second = coordinator.refresh();
  assert.equal(first, second);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, 1);
  const third = coordinator.refresh();
  release();
  assert.equal(await third, 2);
});
