import test from "node:test";
import assert from "node:assert/strict";
import { createBallChessPlugin } from "../../dsh/plugin.js";
import { credentialKeyForAgent } from "../../dsh/grant-store.js";

class MemoryCredentials {
  records = new Map();
  async readRecord(key) { return this.records.get(key); }
  async modifyRecord(key, mutate) { const next = await mutate(this.records.get(key)); if (next !== undefined) this.records.set(key, next); return this.records.get(key); }
  async deleteRecord(key) { this.records.delete(key); }
}

function context(credentials = new MemoryCredentials()) {
  const definitions = new Map();
  const disposers = [];
  const ctx = {
    credentials,
    tools: { register(definition) { definitions.set(definition.name, definition); return () => definitions.delete(definition.name); } },
    effect(effect) { const dispose = effect(); disposers.push(dispose); return dispose; }
  };
  return { ctx, definitions, dispose: () => disposers.splice(0).reverse().forEach((entry) => entry()) };
}

const WAITING = {
  matchId: "m_one", version: 2, status: "waiting", yourPlayer: "left", yourTurn: false,
  seats: {
    left: { phase: "claimed", profile: { displayName: "Left", clientType: "dsh" }, invitation: null },
    right: { phase: "open", profile: null, invitation: null }
  },
  config: { width: 9, height: 13, wallLimit: null, maxPlies: 300, turnTimeoutMs: null, firstPlayer: "left" },
  players: {
    left: { color: "red", position: [2, 0], wallsUsed: 0 },
    right: { color: "blue", position: [6, 0], wallsUsed: 0 }
  },
  walls: [], currentPlayer: "left", plies: 0, lastAction: null, result: null, turnDeadlineAt: null,
  legalActions: []
};

function exec(id = "agent-1", header = {}) {
  return { agent: { id, session: { header } }, signal: new AbortController().signal };
}

test("plugin validates loopback config and registers only Ball Chess tools as effects", () => {
  const plugin = createBallChessPlugin();
  assert.throws(() => plugin.apply(context().ctx, { baseUrl: "https://example.com" }), /loopback HTTP/);
  const harness = context();
  plugin.apply(harness.ctx, { baseUrl: "http://127.0.0.1:7100" });
  assert.deepEqual([...harness.definitions.keys()], [
    "join_by_invite", "set_ready", "get_match_state", "get_match_record", "wait_for_turn", "submit_action"
  ]);
  for (const definition of harness.definitions.values()) {
    assert.deepEqual(definition.output.schema, { type: "object", additionalProperties: true });
    assert.equal(JSON.stringify(definition.parameters).includes("playerToken"), false);
  }
  harness.dispose();
  assert.equal(harness.definitions.size, 0);
});

test("join persists a bound grant while rendered output hides invitation and token", async () => {
  const harness = context();
  const fetchImpl = async (url) => {
    if (url.endsWith("/redeem")) return new Response(JSON.stringify({ matchId: "m_one", seat: "left", playerToken: "seat_secret", state: WAITING }), { status: 200 });
    if (url.endsWith("/ready")) return new Response(JSON.stringify({ ...WAITING, version: 3, seats: { ...WAITING.seats, left: { phase: "ready" } } }), { status: 200 });
    return new Response(JSON.stringify(WAITING), { status: 200 });
  };
  createBallChessPlugin({ fetchImpl, redemptionIdFactory: () => "a".repeat(32) }).apply(harness.ctx, { baseUrl: "http://127.0.0.1:7100" });
  const definition = harness.definitions.get("join_by_invite");
  const value = await definition.execute({ code: "01234-56789-ABCDE-FGHJK-MNPQRS", name: "Agent" }, exec());
  const rendered = definition.output.render({}, value)[0].text;
  assert.ok(!rendered.includes("01234"));
  assert.ok(!rendered.includes("seat_secret"));
  assert.deepEqual(harness.ctx.credentials.records.get(credentialKeyForAgent("agent-1")), {
    kind: "grant",
    payload: { version: 1, state: "bound", baseUrl: "http://127.0.0.1:7100", matchId: "m_one", seat: "left", playerToken: "seat_secret" }
  });
});

test("an authoritative invitation rejection releases the pending grant for a new code", async () => {
  const credentials = new MemoryCredentials();
  const harness = context(credentials);
  let expired = true;
  const fetchImpl = async (url) => {
    if (url.endsWith("/redeem") && expired) {
      expired = false;
      return new Response(JSON.stringify({
        ok: false,
        error: { code: "INVITE_EXPIRED", message: "Invitation code has expired", details: {} }
      }), { status: 409 });
    }
    if (url.endsWith("/redeem")) {
      return new Response(JSON.stringify({ matchId: "m_one", seat: "left", playerToken: "seat_secret", state: WAITING }), { status: 200 });
    }
    if (url.endsWith("/ready")) return new Response(JSON.stringify(WAITING), { status: 200 });
    throw new Error(`unexpected request: ${url}`);
  };
  let redemption = 0;
  createBallChessPlugin({ fetchImpl, redemptionIdFactory: () => (++redemption).toString(16).padStart(32, "0") })
    .apply(harness.ctx, { baseUrl: "http://127.0.0.1:7100" });
  const join = harness.definitions.get("join_by_invite");

  await assert.rejects(
    join.execute({ code: "01234-56789-ABCDE-FGHJK-MNPQRS" }, exec()),
    (error) => error.code === "INVITE_EXPIRED"
  );
  assert.deepEqual(await credentials.readRecord(credentialKeyForAgent("agent-1")), {
    kind: "grant",
    payload: { version: 1, state: "unbound" }
  });

  const joined = await join.execute({ code: "11234-56789-ABCDE-FGHJK-MNPQRS" }, exec());
  assert.equal(joined.kind, "waiting");
  assert.equal((await credentials.readRecord(credentialKeyForAgent("agent-1"))).payload.state, "bound");
});

test("an ambiguous invitation failure keeps the pending grant for idempotent recovery", async () => {
  const credentials = new MemoryCredentials();
  const harness = context(credentials);
  createBallChessPlugin({
    fetchImpl: async () => { throw new TypeError("connection lost"); },
    redemptionIdFactory: () => "a".repeat(32)
  }).apply(harness.ctx, { baseUrl: "http://127.0.0.1:7100" });
  const join = harness.definitions.get("join_by_invite");

  await assert.rejects(join.execute({ code: "01234-56789-ABCDE-FGHJK-MNPQRS" }, exec()), /connection lost/);
  assert.equal((await credentials.readRecord(credentialKeyForAgent("agent-1"))).payload.state, "redeeming");
  await assert.rejects(
    join.execute({ code: "11234-56789-ABCDE-FGHJK-MNPQRS" }, exec()),
    (error) => error.code === "REDEMPTION_IN_PROGRESS"
  );
});

test("cold resume replaces the token with a recoverable terminal receipt", async () => {
  const credentials = new MemoryCredentials();
  credentials.records.set(credentialKeyForAgent("agent-1"), {
    kind: "grant",
    payload: { version: 1, state: "bound", baseUrl: "http://127.0.0.1:7100", matchId: "m_one", seat: "left", playerToken: "seat_secret" }
  });
  const finished = { ...WAITING, version: 9, status: "finished", result: { kind: "win", winner: "left", reason: "reached_goal" } };
  const first = context(credentials);
  createBallChessPlugin({ fetchImpl: async () => new Response(JSON.stringify(finished), { status: 200 }) }).apply(first.ctx, { baseUrl: "http://127.0.0.1:7100" });
  const value = await first.definitions.get("get_match_state").execute({}, exec());
  assert.equal(value.kind, "finished");
  const stored = await credentials.readRecord(credentialKeyForAgent("agent-1"));
  assert.equal(stored.payload.state, "finished");
  assert.equal(JSON.stringify(stored).includes("seat_secret"), false);
  first.dispose();

  const recovered = context(credentials);
  createBallChessPlugin({ fetchImpl: async () => { throw new Error("network must not be used"); } }).apply(recovered.ctx, { baseUrl: "http://127.0.0.1:7100" });
  assert.deepEqual(await recovered.definitions.get("get_match_state").execute({}, exec()), value);
  await assert.rejects(
    recovered.definitions.get("get_match_state").execute({}, exec("child", { isSeeded: true, parentSession: "parent" })),
    (error) => error.code === "BINDING_NOT_INHERITED"
  );
  recovered.dispose();
});

test("terminal settlement preserves the live submit result contract", async () => {
  const credentials = new MemoryCredentials();
  credentials.records.set(credentialKeyForAgent("agent-1"), {
    kind: "grant",
    payload: { version: 1, state: "bound", baseUrl: "http://127.0.0.1:7100", matchId: "m_one", seat: "left", playerToken: "seat_secret" }
  });
  const finished = { ...WAITING, version: 9, status: "finished", result: { kind: "win", winner: "left", reason: "reached_goal" } };
  const harness = context(credentials);
  createBallChessPlugin({ fetchImpl: async () => new Response(JSON.stringify(finished), { status: 200 }) })
    .apply(harness.ctx, { baseUrl: "http://127.0.0.1:7100" });

  const value = await harness.definitions.get("submit_action").execute({
    expectedVersion: 8,
    actionId: "move:up"
  }, exec());
  assert.equal(value.ok, true);
  assert.equal(value.kind, "finished");
  assert.equal((await credentials.readRecord(credentialKeyForAgent("agent-1"))).payload.receipt.kind, "finished");
  harness.dispose();
});

test("a finished DSH receipt can read the public record without restoring a token", async () => {
  const credentials = new MemoryCredentials();
  credentials.records.set(credentialKeyForAgent("agent-1"), {
    kind: "grant",
    payload: { version: 1, state: "bound", baseUrl: "http://127.0.0.1:7100", matchId: "m_one", seat: "left", playerToken: "seat_secret" }
  });
  const finished = { ...WAITING, version: 9, status: "finished", result: { kind: "win", winner: "left", reason: "reached_goal" } };
  const first = context(credentials);
  createBallChessPlugin({ fetchImpl: async () => new Response(JSON.stringify(finished), { status: 200 }) })
    .apply(first.ctx, { baseUrl: "http://127.0.0.1:7100" });
  await first.definitions.get("get_match_state").execute({}, exec());
  first.dispose();

  const record = {
    schemaVersion: 1, matchId: "m_one", config: WAITING.config,
    actions: [{ player: "left", ply: 1, action: { type: "move", direction: "up" }, at: 10 }],
    result: finished.result, createdAt: 0, updatedAt: 10
  };
  const second = context(credentials);
  createBallChessPlugin({
    fetchImpl: async (url, options) => {
      assert.equal(url, "http://127.0.0.1:7100/api/matches/m_one/record");
      assert.equal(options.headers.authorization, undefined);
      return new Response(JSON.stringify(record), { status: 200 });
    }
  }).apply(second.ctx, { baseUrl: "http://127.0.0.1:7100" });
  const value = await second.definitions.get("get_match_record").execute({}, exec());
  assert.equal(value.kind, "record");
  assert.equal(value.record.actions[0].actionId, "move:up");
  second.dispose();
});
