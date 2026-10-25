import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { MatchStore } from "../../server/store.js";
import { MatchService } from "../../server/match-service.js";
import { createApp } from "../../server/app.js";
import { createBallChessPlugin } from "../../dsh/plugin.js";
import { credentialKeyForAgent } from "../../dsh/grant-store.js";

class MemoryCredentials {
  records = new Map();
  async readRecord(key) { return this.records.get(key); }
  async modifyRecord(key, mutate) { const next = await mutate(this.records.get(key)); if (next !== undefined) this.records.set(key, next); return this.records.get(key); }
  async deleteRecord(key) { this.records.delete(key); }
}

function pluginHarness(credentials, baseUrl, fetchImpl) {
  const tools = new Map();
  const effects = [];
  const ctx = {
    credentials,
    tools: { register(definition) { tools.set(definition.name, definition); return () => tools.delete(definition.name); } },
    effect(callback) { const dispose = callback(); effects.push(dispose); return dispose; }
  };
  createBallChessPlugin(fetchImpl === undefined ? {} : { fetchImpl }).apply(ctx, { baseUrl });
  return { tools, dispose: () => effects.splice(0).reverse().forEach((dispose) => dispose()) };
}

function execution(id, signal = new AbortController().signal, header = {}) {
  return { agent: { id, session: { header } }, signal };
}

test("two DSH sessions play independently, resume cold, cancel waits, isolate forks, and preserve terminal receipts", { timeout: 15000 }, async (t) => {
  await mkdir(path.join(process.cwd(), ".tmp"), { recursive: true });
  const directory = await mkdtemp(path.join(process.cwd(), ".tmp", "dsh-plugin-"));
  const service = await MatchService.open({ store: new MatchStore({ directory }) });
  const server = createApp({ service, webRoot: path.resolve("web"), coreRoot: path.resolve("core") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    const closed = new Promise((resolve) => server.once("close", resolve));
    server.close();
    server.closeAllConnections();
    await closed;
    service.close();
    await rm(directory, { recursive: true, force: true });
  });

  const created = await fetch(`${baseUrl}/api/matches`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: { maxPlies: 40 } })
  }).then((response) => response.json());
  const invitation = (seat) => fetch(`${baseUrl}/api/matches/${created.matchId}/invitations`, {
    method: "POST",
    headers: { authorization: `Bearer ${created.adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ seat })
  }).then((response) => response.json());
  const leftInvite = await invitation("left");
  const rightInvite = await invitation("right");

  const credentials = new MemoryCredentials();
  let harness = pluginHarness(credentials, baseUrl);
  const leftExec = execution("dsh-left");
  const rightExec = execution("dsh-right");
  const joinedLeft = await harness.tools.get("join_by_invite").execute({ code: leftInvite.code }, leftExec);
  const joinedRight = await harness.tools.get("join_by_invite").execute({ code: rightInvite.code }, rightExec);
  for (const [definition, value, secret] of [
    [harness.tools.get("join_by_invite"), joinedLeft, leftInvite.code],
    [harness.tools.get("join_by_invite"), joinedRight, rightInvite.code]
  ]) {
    const text = definition.output.render({}, value)[0].text;
    assert.ok(!text.includes(secret));
    assert.ok(!text.includes("playerToken"));
  }
  assert.notDeepEqual(
    credentials.records.get(credentialKeyForAgent("dsh-left")),
    credentials.records.get(credentialKeyForAgent("dsh-right"))
  );

  const cancel = new AbortController();
  const waiting = harness.tools.get("wait_for_turn").execute({}, execution("dsh-right", cancel.signal));
  cancel.abort();
  assert.equal((await waiting).kind, "canceled");
  assert.ok(credentials.records.has(credentialKeyForAgent("dsh-right")));
  await assert.rejects(
    harness.tools.get("get_match_state").execute({}, execution("fork", undefined, { isSeeded: true, parentSession: "dsh-left" })),
    (error) => error.code === "BINDING_NOT_INHERITED"
  );

  const opening = await harness.tools.get("get_match_state").execute({}, leftExec);
  await harness.tools.get("submit_action").execute({ expectedVersion: opening.state.version, actionId: "wall:h:0:1" }, leftExec);
  assert.ok(credentials.records.has(credentialKeyForAgent("dsh-left")));
  harness.dispose();
  assert.ok(credentials.records.has(credentialKeyForAgent("dsh-left")));
  harness = pluginHarness(credentials, baseUrl);
  const resumed = await harness.tools.get("get_match_state").execute({}, rightExec);
  assert.equal(resumed.state.players.left.position[1], 0);
  assert.equal(resumed.state.walls[0].orientation, "h");
  await harness.tools.get("submit_action").execute({
    expectedVersion: resumed.state.version,
    actionId: "wall:v:8:0"
  }, rightExec);

  for (let turn = 0; turn < 40; turn += 1) {
    const left = await harness.tools.get("get_match_state").execute({}, leftExec);
    if (left.state.status === "finished") break;
    const currentExec = left.state.yourTurn ? leftExec : rightExec;
    const current = left.state.yourTurn ? left : await harness.tools.get("get_match_state").execute({}, rightExec);
    const next = await harness.tools.get("submit_action").execute({ expectedVersion: current.state.version, actionId: "move:up" }, currentExec);
    if (next.kind === "finished") break;
  }
  const finalLeft = await harness.tools.get("get_match_state").execute({}, leftExec).catch((error) => ({ error }));
  if (!finalLeft.error) assert.equal(finalLeft.kind, "finished");
  const finalRight = await harness.tools.get("get_match_state").execute({}, rightExec).catch((error) => ({ error }));
  if (!finalRight.error) assert.equal(finalRight.kind, "finished");
  for (const id of ["dsh-left", "dsh-right"]) {
    const stored = credentials.records.get(credentialKeyForAgent(id));
    assert.equal(stored.payload.state, "finished");
    assert.equal(JSON.stringify(stored).includes("playerToken"), false);
  }
  const record = await harness.tools.get("get_match_record").execute({}, leftExec);
  assert.deepEqual(record.record.actions.slice(0, 2).map((entry) => entry.actionId), ["wall:h:0:1", "wall:v:8:0"]);
  assert.deepEqual(record.record.result, { kind: "win", winner: "left", reason: "reached_goal" });
  harness.dispose();
  const offline = pluginHarness(credentials, baseUrl, async () => { throw new Error("network must not be used"); });
  const recoveredLeft = await offline.tools.get("get_match_state").execute({}, leftExec);
  const recoveredRight = await offline.tools.get("get_match_state").execute({}, rightExec);
  assert.deepEqual(recoveredLeft.state.result, { kind: "win", winner: "left", reason: "reached_goal" });
  assert.deepEqual(recoveredRight.state.result, recoveredLeft.state.result);
  offline.dispose();
});

test("an expired invitation does not block the same DSH session from joining with a fresh invitation", async (t) => {
  await mkdir(path.join(process.cwd(), ".tmp"), { recursive: true });
  const directory = await mkdtemp(path.join(process.cwd(), ".tmp", "dsh-expired-invite-"));
  let now = 100;
  const codes = [
    "01234-56789-ABCDE-FGHJK-MNPQRS",
    "11234-56789-ABCDE-FGHJK-MNPQRS"
  ];
  const service = await MatchService.open({
    store: new MatchStore({ directory }),
    now: () => now,
    generateInvitationCode: () => codes.shift()
  });
  const server = createApp({ service, webRoot: path.resolve("web"), coreRoot: path.resolve("core") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    const closed = new Promise((resolve) => server.once("close", resolve));
    server.close();
    server.closeAllConnections();
    await closed;
    service.close();
    await rm(directory, { recursive: true, force: true });
  });

  const created = await service.create();
  const expired = await service.createInvitation(created.matchId, created.adminToken, "left");
  now = expired.expiresAt;
  const credentials = new MemoryCredentials();
  const harness = pluginHarness(credentials, baseUrl);
  t.after(() => harness.dispose());
  const join = harness.tools.get("join_by_invite");
  const agent = execution("dsh-expired-invite");

  await assert.rejects(join.execute({ code: expired.code }, agent), (error) => error.code === "INVITE_EXPIRED");
  const fresh = await service.createInvitation(created.matchId, created.adminToken, "left");
  const joined = await join.execute({ code: fresh.code }, agent);

  assert.equal(joined.kind, "waiting");
  assert.equal(joined.state.seats.left.phase, "ready");
  assert.equal((await credentials.readRecord(credentialKeyForAgent("dsh-expired-invite"))).payload.state, "bound");
});
