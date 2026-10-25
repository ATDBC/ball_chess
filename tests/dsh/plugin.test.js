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
  seats: { left: { phase: "claimed" }, right: { phase: "open" } }, config: { wallLimit: null },
  players: { left: { position: [2, 0], wallsUsed: 0 }, right: { position: [6, 0], wallsUsed: 0 } }, walls: [], legalActions: []
};

function exec(id = "agent-1", header = {}) {
  return { agent: { id, session: { header } }, signal: new AbortController().signal };
}

test("plugin validates loopback config and registers only Ball Chess tools as effects", () => {
  const plugin = createBallChessPlugin();
  assert.throws(() => plugin.apply(context().ctx, { baseUrl: "https://example.com" }), /loopback HTTP/);
  const harness = context();
  plugin.apply(harness.ctx, { baseUrl: "http://127.0.0.1:7100" });
  assert.deepEqual([...harness.definitions.keys()], ["join_by_invite", "set_ready", "get_match_state", "wait_for_turn", "submit_action"]);
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

test("cold resume uses the session grant, forks do not inherit it, and finish deletes it", async () => {
  const credentials = new MemoryCredentials();
  credentials.records.set(credentialKeyForAgent("agent-1"), {
    kind: "grant",
    payload: { version: 1, state: "bound", baseUrl: "http://127.0.0.1:7100", matchId: "m_one", seat: "left", playerToken: "seat_secret" }
  });
  const harness = context(credentials);
  const finished = { ...WAITING, version: 9, status: "finished", result: { kind: "win", winner: "left", reason: "reached_goal" } };
  createBallChessPlugin({ fetchImpl: async () => new Response(JSON.stringify(finished), { status: 200 }) }).apply(harness.ctx, { baseUrl: "http://127.0.0.1:7100" });
  const value = await harness.definitions.get("get_match_state").execute({}, exec());
  assert.equal(value.kind, "finished");
  assert.equal(await credentials.readRecord(credentialKeyForAgent("agent-1")), undefined);
  await assert.rejects(
    harness.definitions.get("get_match_state").execute({}, exec("child", { isSeeded: true, parentSession: "parent" })),
    (error) => error.code === "BINDING_NOT_INHERITED"
  );
});
