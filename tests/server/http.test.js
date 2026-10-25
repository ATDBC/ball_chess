import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { MatchStore } from "../../server/store.js";
import { MatchService } from "../../server/match-service.js";
import { createApp } from "../../server/app.js";

async function fixture(t, dependencies = {}) {
  await mkdir(path.join(process.cwd(), ".tmp"), { recursive: true });
  const directory = await mkdtemp(path.join(process.cwd(), ".tmp", "http-"));
  const service = await MatchService.open({ store: new MatchStore({ directory }), ...dependencies });
  const server = createApp({ service, webRoot: path.resolve("web"), coreRoot: path.resolve("core") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  t.after(async () => {
    if (server.listening) {
      const closed = new Promise((resolve) => server.once("close", resolve));
      server.close();
      server.closeAllConnections();
      await closed;
    }
    service.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { service, base: `http://127.0.0.1:${address.port}` };
}

async function createMatch(base, config = { maxPlies: 40 }) {
  const response = await fetch(`${base}/api/matches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config })
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  const setupResponse = await fetch(`${base}/api/matches/${created.matchId}/setup`, {
    headers: { authorization: `Bearer ${created.adminToken}` }
  });
  assert.equal(setupResponse.status, 200);
  const setup = await setupResponse.json();
  return { ...created, playerTokens: setup.playerTokens };
}

async function join(base, created, seat) {
  const response = await fetch(`${base}/api/matches/${created.matchId}/join`, {
    method: "POST",
    headers: { authorization: `Bearer ${created.playerTokens[seat]}`, "content-type": "application/json" },
    body: JSON.stringify({ displayName: seat, clientType: "test" })
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function ready(base, created, seat, value = true) {
  const response = await fetch(`${base}/api/matches/${created.matchId}/ready`, {
    method: "POST",
    headers: { authorization: `Bearer ${created.playerTokens[seat]}`, "content-type": "application/json" },
    body: JSON.stringify({ ready: value })
  });
  assert.equal(response.status, 200);
  return response.json();
}

test("HTTP creation can atomically claim one seat without exposing the other token", async (t) => {
  const { base } = await fixture(t);
  const response = await fetch(`${base}/api/matches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      config: { maxPlies: 40 },
      claim: {
        seat: "left",
        profile: { displayName: "Browser", clientType: "browser" }
      }
    })
  });
  const created = await response.json();
  assert.equal(response.status, 201);
  assert.equal(created.seat, "left");
  assert.equal(typeof created.playerToken, "string");
  assert.equal(Object.hasOwn(created, "playerTokens"), false);
  assert.equal(created.state.seats.left.phase, "claimed");
});

test("HTTP ready validates booleans and starts only after both seats are ready", async (t) => {
  const { base } = await fixture(t);
  const createdResponse = await fetch(`${base}/api/matches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config: { maxPlies: 40 } })
  });
  const created = await createdResponse.json();
  const setup = await fetch(`${base}/api/matches/${created.matchId}/setup`, {
    headers: { authorization: `Bearer ${created.adminToken}` }
  }).then((response) => response.json());
  for (const seat of ["left", "right"]) {
    const joined = await fetch(`${base}/api/matches/${created.matchId}/join`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${setup.playerTokens[seat]}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ displayName: seat, clientType: "test" })
    });
    assert.equal(joined.status, 200);
  }

  const invalid = await fetch(`${base}/api/matches/${created.matchId}/ready`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${setup.playerTokens.left}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ ready: "yes" })
  });
  assert.equal(invalid.status, 400);

  const setReady = (seat, ready) => fetch(`${base}/api/matches/${created.matchId}/ready`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${setup.playerTokens[seat]}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ ready })
  });
  const left = await setReady("left", true);
  assert.equal(left.status, 200);
  assert.equal((await left.json()).status, "waiting");
  const right = await setReady("right", true);
  assert.equal(right.status, 200);
  assert.equal((await right.json()).status, "playing");
  const afterStart = await setReady("left", false);
  assert.equal(afterStart.status, 409);
  assert.equal((await afterStart.json()).error.code, "MATCH_ALREADY_STARTED");
});

test("HTTP actions, errors, safe export and SSE share authoritative state", { timeout: 10000 }, async (t) => {
  const { base } = await fixture(t);
  const created = await createMatch(base);
  const leftAuth = { authorization: `Bearer ${created.playerTokens.left}` };
  const rightAuth = { authorization: `Bearer ${created.playerTokens.right}` };
  await join(base, created, "left");
  await join(base, created, "right");
  await ready(base, created, "left");
  await ready(base, created, "right");
  const response = await fetch(`${base}/api/matches/${created.matchId}/actions`, {
    method: "POST",
    headers: { ...leftAuth, "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: 4, action: { type: "move", direction: "up" } })
  });
  assert.equal(response.status, 200);

  const badAuth = await fetch(`${base}/api/matches/${created.matchId}/state`, { headers: { authorization: "Bearer wrong" } });
  assert.equal(badAuth.status, 401);
  const stale = await fetch(`${base}/api/matches/${created.matchId}/actions`, {
    method: "POST",
    headers: { ...leftAuth, "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: 4, action: { type: "move", direction: "up" } })
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).state.plies, 1);
  const recordText = await fetch(`${base}/api/matches/${created.matchId}/record`).then((r) => r.text());
  assert.ok(!recordText.includes(created.adminToken));
  assert.ok(!recordText.includes(created.playerTokens.left));
  assert.ok(!recordText.includes(created.playerTokens.right));
  const traversal = await fetch(`${base}/..%2Fdata%2Fmatches%2Fsecret.json`);
  assert.notEqual(traversal.status, 200);
  assert.ok(!(await traversal.text()).includes("secret"));

  const sseResponse = await fetch(`${base}/api/matches/${created.matchId}/events`);
  assert.equal(sseResponse.status, 200);
  const reader = sseResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  async function nextSse() {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const packet = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = packet.split("\n").find((line) => line.startsWith("data:"));
        if (data) return JSON.parse(data.slice(5).trim());
      }
      const { done, value } = await reader.read();
      if (done) throw new Error("SSE closed before the expected event");
      buffer += decoder.decode(value, { stream: true });
    }
  }
  assert.equal((await nextSse()).version, 5);
  await fetch(`${base}/api/matches/${created.matchId}/actions`, {
    method: "POST",
    headers: { ...rightAuth, "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: 5, action: { type: "move", direction: "up" } })
  });
  assert.equal((await nextSse()).version, 6);
  await reader.cancel();
});

test("request validation and admin setup do not expose the admin token", async (t) => {
  const { base } = await fixture(t);
  const invalid = await fetch(`${base}/api/matches`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ unknown: true })
  });
  assert.equal(invalid.status, 400);
  const tooLarge = await fetch(`${base}/api/matches`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ padding: "x".repeat(17000) })
  });
  assert.equal(tooLarge.status, 413);
  const created = await createMatch(base);
  await join(base, created, "left");
  await join(base, created, "right");
  await ready(base, created, "left");
  await ready(base, created, "right");
  const illegal = await fetch(`${base}/api/matches/${created.matchId}/actions`, {
    method: "POST",
    headers: { authorization: `Bearer ${created.playerTokens.left}`, "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: 4, action: { type: "move", direction: "down" } })
  });
  assert.equal(illegal.status, 422);
  assert.equal((await illegal.json()).state.plies, 0);
  const setupResponse = await fetch(`${base}/api/matches/${created.matchId}/setup`, {
    headers: { authorization: `Bearer ${created.adminToken}` }
  });
  assert.equal(setupResponse.status, 200);
  const setup = await setupResponse.json();
  assert.equal(setup.mcp.args[1], "--url");
  assert.ok(!JSON.stringify(setup).includes(created.adminToken));
  const staticCore = await fetch(`${base}/core/state.js`);
  assert.equal(staticCore.status, 200);
  assert.match(staticCore.headers.get("content-type"), /javascript/);
});

test("an action at the deadline returns the committed timeout state", async (t) => {
  let now = 1_000;
  const { base } = await fixture(t, {
    now: () => now,
    setTimer: () => ({ unref() {} }),
    clearTimer() {}
  });
  const created = await createMatch(base, { maxPlies: 40, turnTimeoutMs: 10 });
  await join(base, created, "left");
  await join(base, created, "right");
  await ready(base, created, "left");
  await ready(base, created, "right");
  now = 1_010;

  const response = await fetch(`${base}/api/matches/${created.matchId}/actions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${created.playerTokens.left}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      expectedVersion: 4,
      action: { type: "move", direction: "up" }
    })
  });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "TURN_EXPIRED");
  assert.equal(body.state.version, 5);
  assert.equal(body.state.result.reason, "turn_timeout");
  assert.equal(body.state.plies, 0);
});
