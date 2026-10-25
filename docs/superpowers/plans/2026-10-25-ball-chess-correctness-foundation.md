# Ball Chess Correctness Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing v1 Ball Chess backend and MCP binding correct under deadlines, concurrent calls, persistence failures, notification failures, and corrupt stored records before adding invitations or ready state.

**Architecture:** Keep the current pure rule engine, single Node service, JSON store, HTTP/SSE surface, and stdio MCP adapter. Add strict v1 admission and replay checks at the durable-record edge, inject time and timer functions into `MatchService`, and preserve the existing per-match queue as the single mutation path. This plan intentionally does not introduce record v2, invitations, ready state, frontend changes, a shared Agent Client, or the DSH plugin.

**Tech Stack:** Node.js 22 ESM, `node:test`, `node:assert/strict`, native HTTP/SSE, JSON files, `@modelcontextprotocol/sdk`

---

## File map

- Modify `core/constants.js`: own the maximum representable turn timeout.
- Modify `core/state.js`: validate `turnTimeoutMs` against that maximum.
- Modify `core/engine.js`: validate only the submitted action instead of enumerating every wall placement.
- Create `server/match-schema.js`: strictly admit stored v1 JSON fields before replay.
- Modify `server/store.js`: call the stored-record validator for every file.
- Modify `server/match-record.js`: replay accepted actions and verify stored status, version, deadline, and result consistency.
- Modify `server/match-service.js`: inject time/timers, settle overdue turns inside the match queue, and contain notification failures after commit.
- Modify `server/app.js`: attach recovery state to `TURN_EXPIRED` responses.
- Modify `server/http-utils.js`: map `TURN_EXPIRED` to HTTP 409 without redacting it as an internal error.
- Modify `mcp/session.js`: serialize first binding so concurrent joins cannot overwrite one another.
- Modify `README.md`: document the timeout upper bound and correctness guarantees actually delivered by this phase.
- Modify `tests/core/state.test.js`, `tests/core/engine.test.js`, `tests/server/store.test.js`, `tests/server/match-service.test.js`, `tests/server/http.test.js`, and `tests/mcp/session.test.js`.
- Create `tests/server/match-record.test.js`: focused replay and stored-result consistency tests.

## Task 1: Bound timeout configuration

**Files:**
- Modify: `core/constants.js`
- Modify: `core/state.js`
- Test: `tests/core/state.test.js`

- [ ] **Step 1: Write the failing timeout-bound test**

Append this test to `tests/core/state.test.js`:

```js
test("turn timeout fits the Node timer range", () => {
  assert.equal(normalizeConfig({ turnTimeoutMs: 2_147_483_647 }).turnTimeoutMs, 2_147_483_647);
  assert.throws(
    () => normalizeConfig({ turnTimeoutMs: 2_147_483_648 }),
    (error) => error.code === "INVALID_CONFIG" && /2147483647/.test(error.message)
  );
});
```

- [ ] **Step 2: Run the focused test and confirm the upper bound is not enforced**

Run:

```powershell
node --test tests/core/state.test.js
```

Expected: FAIL because `2_147_483_648` is currently accepted.

- [ ] **Step 3: Define and enforce the maximum**

Add this export to `core/constants.js`:

```js
export const MAX_TURN_TIMEOUT_MS = 2_147_483_647;
```

Update the import and validation in `core/state.js`:

```js
import { DEFAULT_CONFIG, MAX_TURN_TIMEOUT_MS, PLAYER_IDS, START_POSITIONS } from "./constants.js";

if (!(config.turnTimeoutMs === null || (
  Number.isInteger(config.turnTimeoutMs)
  && config.turnTimeoutMs > 0
  && config.turnTimeoutMs <= MAX_TURN_TIMEOUT_MS
))) {
  throw new GameError(
    "INVALID_CONFIG",
    `turnTimeoutMs must be null or an integer from 1 to ${MAX_TURN_TIMEOUT_MS}`
  );
}
```

Replace the existing `turnTimeoutMs` validation rather than adding a second check.

- [ ] **Step 4: Run the focused test**

Run:

```powershell
node --test tests/core/state.test.js
```

Expected: all state tests PASS.

- [ ] **Step 5: Commit the bounded configuration**

```powershell
git add core/constants.js core/state.js tests/core/state.test.js
git commit -m "fix: bound turn timeout for Node timers"
```

## Task 2: Validate the requested action directly

**Files:**
- Modify: `core/engine.js`
- Test: `tests/core/engine.test.js`

- [ ] **Step 1: Add focused move and wall validation tests**

Update the import in `tests/core/engine.test.js` to include `getActionError`, then append:

```js
test("requested moves and walls are validated without changing the game", () => {
  const game = createGame();
  assert.equal(getActionError(game, "left", { type: "move", direction: "up" }), null);
  assert.equal(
    getActionError(game, "left", { type: "move", direction: "down" }).details.reason,
    "ILLEGAL_MOVE"
  );
  assert.equal(getActionError(game, "left", {
    type: "place_wall", orientation: "h", x: 0, y: 1
  }), null);
  assert.equal(
    getActionError(game, "left", { type: "place_wall", orientation: "h", x: 8, y: 1 }).details.reason,
    "INVALID_WALL"
  );
  assert.deepEqual(game, createGame());
});
```

- [ ] **Step 2: Run the focused test as a behavior baseline**

Run:

```powershell
node --test tests/core/engine.test.js
```

Expected: PASS. This test fixes the behavior that the optimized implementation must preserve.

- [ ] **Step 3: Replace exhaustive action enumeration in `getActionError`**

Use these imports and implementation in `core/engine.js`:

```js
import { GameError } from "./errors.js";
import { otherPlayer } from "./state.js";
import { listLegalMoves } from "./movement.js";
import { listLegalActions, wallPlacementError } from "./legal.js";

export function getActionError(game, playerId, action) {
  if (game.result) return new GameError("MATCH_FINISHED", "Match is finished", { result: game.result });
  if (game.currentPlayer !== playerId) {
    return new GameError("NOT_YOUR_TURN", "Not your turn", { currentPlayer: game.currentPlayer });
  }
  if (!action || !["move", "place_wall"].includes(action.type)) {
    return new GameError("ILLEGAL_ACTION", "Unknown action", { reason: "INVALID_ACTION" });
  }
  const expectedKeys = action.type === "move" ? ["type", "direction"] : ["type", "orientation", "x", "y"];
  const actualKeys = Object.keys(action);
  if (actualKeys.length !== expectedKeys.length || expectedKeys.some((key) => !Object.hasOwn(action, key))) {
    return new GameError("ILLEGAL_ACTION", "Action has missing or unknown fields", { reason: "INVALID_ACTION" });
  }
  if (action.type === "move") {
    const legal = listLegalMoves(game, playerId).some((candidate) => candidate.direction === action.direction);
    return legal ? null : new GameError("ILLEGAL_ACTION", "Action is not legal", { reason: "ILLEGAL_MOVE" });
  }
  const reason = wallPlacementError(game, playerId, action);
  return reason === null ? null : new GameError("ILLEGAL_ACTION", "Action is not legal", { reason });
}
```

Leave `listLegalActions` in `settleCurrentTurn`; that function genuinely asks whether any action exists.

- [ ] **Step 4: Run the rule suite**

Run:

```powershell
node --test "tests/core/*.test.js"
```

Expected: all core tests PASS.

- [ ] **Step 5: Commit direct validation**

```powershell
git add core/engine.js tests/core/engine.test.js
git commit -m "perf: validate submitted action directly"
```

## Task 3: Make deadline settlement part of the command queue

**Files:**
- Modify: `server/match-service.js`
- Modify: `server/app.js`
- Modify: `server/http-utils.js`
- Test: `tests/server/match-service.test.js`
- Test: `tests/server/http.test.js`

- [ ] **Step 1: Let the service fixture inject deterministic time and timers**

Change the helper signature and service construction in `tests/server/match-service.test.js`:

```js
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
```

- [ ] **Step 2: Write the exact-boundary deadline test**

Append:

```js
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
```

- [ ] **Step 3: Run the test and observe the late action**

Run:

```powershell
node --test --test-name-pattern="deadline wins" tests/server/match-service.test.js
```

Expected: FAIL because the action is currently accepted.

- [ ] **Step 4: Inject time and timer operations into `MatchService`**

Change construction to this form:

```js
constructor(store, {
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onBackgroundError = (error) => console.error(error)
} = {}) {
  super();
  this.store = store;
  this.now = now;
  this.setTimer = setTimer;
  this.clearTimer = clearTimer;
  this.onBackgroundError = onBackgroundError;
  this.matches = new Map();
  this.timers = new Map();
  this.unavailable = new Map();
  this.queues = new Map();
}

static async open({ store, ...dependencies }) {
  const service = new MatchService(store, dependencies);
  const { records, failures } = await store.loadAll();
  for (const failure of failures) service.unavailable.set(failure.matchId, failure);
  for (const raw of records) {
    try {
      const record = restoreMatch(raw);
      service.matches.set(record.id, record);
      service.armTimer(record);
    } catch (error) {
      service.unavailable.set(raw.id, { message: error.message });
    }
  }
  return service;
}
```

Replace `armTimer()` and `close()` with these implementations:

```js
armTimer(record) {
  const old = this.timers.get(record.id);
  if (old) this.clearTimer(old);
  this.timers.delete(record.id);
  if (record.status !== "playing" || record.turnDeadlineAt === null) return;
  const delay = Math.max(0, record.turnDeadlineAt - this.now());
  const timer = this.setTimer(() => {
    this.expire(record.id, record.version).catch((error) => {
      this.emit("persistenceError", { matchId: record.id, error });
    });
  }, delay);
  timer.unref?.();
  this.timers.set(record.id, timer);
}

close() {
  for (const timer of this.timers.values()) this.clearTimer(timer);
  this.timers.clear();
}
```

Task 4 replaces the timer callback's background report. In `create()`, construct the record with the injected time:

```js
const record = createMatchRecord({
  id,
  adminToken,
  playerTokens,
  config,
  now: this.now()
});
```

In the queued bodies of `join()` and `abort()`, pass `this.now()` as the final argument:

```js
const candidate = joinMatchRecord(record, seat, normalizeProfile(profile), this.now());
```

```js
const candidate = abortMatchRecord(record, this.now());
```

- [ ] **Step 5: Settle expiry before validating an action**

Add this method:

```js
async expireIfDue(record, now = this.now()) {
  if (
    record.status !== "playing"
    || record.turnDeadlineAt === null
    || record.turnDeadlineAt > now
  ) return record;
  return this.commit(expireMatchRecord(record, now));
}
```

Use it at the start of the queued `submitAction` operation:

```js
submitAction(id, token, expectedVersion, action) {
  return this.enqueue(id, async () => {
    const seat = this.seatForToken(this.requireMatch(id), token);
    const now = this.now();
    const record = await this.expireIfDue(this.requireMatch(id), now);
    if (record.game.result?.reason === "turn_timeout") {
      throw new GameError("TURN_EXPIRED", "The turn deadline has passed", { result: record.game.result });
    }
    const candidate = submitMatchAction(record, seat, expectedVersion, action, now);
    await this.commit(candidate);
    return toPublicState(candidate, seat);
  });
}
```

Replace the deadline branch in `getState()` with:

```js
const now = this.now();
if (record.status === "playing" && record.turnDeadlineAt !== null && record.turnDeadlineAt <= now) {
  await this.expire(id, record.version);
  record = this.requireMatch(id);
}
```

Replace `expire()` with:

```js
expire(id, version) {
  return this.enqueue(id, async () => {
    const record = this.requireMatch(id);
    if (record.version !== version) return record;
    return this.expireIfDue(record, this.now());
  });
}
```

Add `TURN_EXPIRED` to `ACTION_STATE_ERRORS` in `server/app.js` so HTTP callers receive the committed terminal state. Add the status mapping in `server/http-utils.js`:

```js
TURN_EXPIRED: 409,
```

- [ ] **Step 6: Add an HTTP recovery-state test**

Change the HTTP fixture signature and service construction in `tests/server/http.test.js`:

```js
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
```

Then append:

```js
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
  now = 1_010;

  const response = await fetch(`${base}/api/matches/${created.matchId}/actions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${created.playerTokens.left}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      expectedVersion: 2,
      action: { type: "move", direction: "up" }
    })
  });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "TURN_EXPIRED");
  assert.equal(body.state.version, 3);
  assert.equal(body.state.result.reason, "turn_timeout");
  assert.equal(body.state.plies, 0);
});
```

- [ ] **Step 7: Run the deadline and existing service tests**

Run:

```powershell
node --test tests/server/match-service.test.js tests/server/http.test.js
```

Expected: all selected tests PASS, including the exact-boundary test.

- [ ] **Step 8: Commit deadline correctness**

```powershell
git add server/match-service.js server/app.js server/http-utils.js tests/server/match-service.test.js tests/server/http.test.js
git commit -m "fix: settle expired turns before actions"
```

## Task 4: Preserve committed state when notification fails

**Files:**
- Modify: `server/match-service.js`
- Test: `tests/server/match-service.test.js`

- [ ] **Step 1: Write a failing notification-containment test**

Append:

```js
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
```

- [ ] **Step 2: Run the focused test and observe the false failure**

Run:

```powershell
node --test --test-name-pattern="broken update listener" tests/server/match-service.test.js
```

Expected: FAIL because `EventEmitter.emit()` propagates the listener exception out of `commit()`.

- [ ] **Step 3: Add contained background reporting and per-listener delivery**

Add these methods to `MatchService`:

```js
reportBackgroundError(error, context) {
  try {
    this.onBackgroundError(error, context);
  } catch (reportError) {
    console.error("Ball Chess background error reporter failed", reportError);
  }
}

publishUpdate(record) {
  const payload = { matchId: record.id, state: toPublicState(record) };
  for (const listener of this.rawListeners("update")) {
    try {
      const pending = listener.call(this, payload);
      Promise.resolve(pending).catch((error) => {
        this.reportBackgroundError(error, { operation: "publish_update", matchId: record.id });
      });
    } catch (error) {
      this.reportBackgroundError(error, { operation: "publish_update", matchId: record.id });
    }
  }
}
```

Replace the final `this.emit("update", ...)` in `commit()` with:

```js
this.publishUpdate(candidate);
```

Replace the timer callback's `this.emit("persistenceError", ...)` path with:

```js
this.expire(record.id, record.version).catch((error) => {
  this.reportBackgroundError(error, { operation: "expire_turn", matchId: record.id });
});
```

Do not catch `store.save`: it must still become a `STORAGE_ERROR` before memory, timer, or notification changes.

- [ ] **Step 4: Verify failed storage still leaves the old in-memory version**

Append this regression test:

```js
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
```

- [ ] **Step 5: Run the service tests**

Run:

```powershell
node --test tests/server/match-service.test.js
```

Expected: all service tests PASS.

- [ ] **Step 6: Commit the submission pipeline fix**

```powershell
git add server/match-service.js tests/server/match-service.test.js
git commit -m "fix: contain post-commit notification failures"
```

## Task 5: Strictly admit stored v1 JSON

**Files:**
- Create: `server/match-schema.js`
- Modify: `server/store.js`
- Test: `tests/server/store.test.js`

- [ ] **Step 1: Add corrupt-field isolation cases**

Add this fixture after `tempStore()` in `tests/server/store.test.js`:

```js
function validRecord(id = "m_valid") {
  return {
    schemaVersion: 1,
    id,
    adminToken: "admin",
    playerTokens: { left: "secret", right: "right" },
    createdAt: 1,
    updatedAt: 1,
    joined: { left: false, right: false },
    profiles: { left: null, right: null },
    status: "waiting",
    version: 0,
    turnDeadlineAt: null,
    config: {
      width: 9,
      height: 13,
      wallLimit: null,
      maxPlies: 300,
      turnTimeoutMs: null,
      firstPlayer: "left"
    },
    actions: [],
    result: null
  };
}
```

Replace the two existing partial-record writes with complete fixtures:

```js
await store.save(validRecord("m_test"));
```

```js
await store.save(validRecord("m_valid"));
```

Then append the corrupt-field test:

```js
test("structurally invalid v1 records are isolated by file", async (t) => {
  const store = await tempStore(t);
  await store.save(validRecord());
  await writeFile(
    path.join(store.directory, "m_bad.json"),
    `${JSON.stringify({ ...validRecord("m_bad"), joined: { left: "yes", right: false } })}\n`,
    "utf8"
  );

  const loaded = await store.loadAll();
  assert.deepEqual(loaded.records.map((record) => record.id), ["m_valid"]);
  assert.equal(loaded.failures[0].matchId, "m_bad");
  assert.match(loaded.failures[0].message, /joined\.left/);
});
```

After the replacement, `loaded.records[0].playerTokens.left === "secret"` remains the round-trip assertion. A partial `{ schemaVersion, id, actions }` object is no longer a valid durable record.

- [ ] **Step 2: Run the store tests and observe shallow validation accepting the bad field**

Run:

```powershell
node --test tests/server/store.test.js
```

Expected: FAIL because `joined.left: "yes"` is currently accepted.

- [ ] **Step 3: Create `server/match-schema.js`**

Create the file with these complete validators:

```js
import { normalizeConfig } from "../core/state.js";

function fail(field) {
  throw new Error(`Invalid match record field: ${field}`);
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(field);
  return value;
}

function finite(value, field) {
  if (!Number.isFinite(value)) fail(field);
}

function nonEmptyString(value, field) {
  if (typeof value !== "string" || value.length === 0) fail(field);
}

function nullableObject(value, field) {
  if (value !== null) object(value, field);
}

export function assertStoredMatchV1(raw, expectedId) {
  object(raw, "record");
  if (raw.schemaVersion !== 1) fail("schemaVersion");
  nonEmptyString(raw.id, "id");
  if (raw.id !== expectedId) fail("id");
  nonEmptyString(raw.adminToken, "adminToken");
  object(raw.playerTokens, "playerTokens");
  nonEmptyString(raw.playerTokens.left, "playerTokens.left");
  nonEmptyString(raw.playerTokens.right, "playerTokens.right");
  finite(raw.createdAt, "createdAt");
  finite(raw.updatedAt, "updatedAt");
  object(raw.joined, "joined");
  for (const seat of ["left", "right"]) {
    if (typeof raw.joined[seat] !== "boolean") fail(`joined.${seat}`);
  }
  object(raw.profiles, "profiles");
  nullableObject(raw.profiles.left, "profiles.left");
  nullableObject(raw.profiles.right, "profiles.right");
  if (!["waiting", "playing", "finished"].includes(raw.status)) fail("status");
  if (!Number.isSafeInteger(raw.version) || raw.version < 0) fail("version");
  if (raw.turnDeadlineAt !== null) finite(raw.turnDeadlineAt, "turnDeadlineAt");
  object(raw.config, "config");
  const normalized = normalizeConfig(raw.config);
  if (normalized.width !== raw.config.width || normalized.height !== raw.config.height) fail("config");
  if (!Array.isArray(raw.actions)) fail("actions");
  raw.actions.forEach((entry, index) => {
    object(entry, `actions[${index}]`);
    if (!["left", "right"].includes(entry.player)) fail(`actions[${index}].player`);
    if (entry.ply !== index + 1) fail(`actions[${index}].ply`);
    object(entry.action, `actions[${index}].action`);
    finite(entry.at, `actions[${index}].at`);
  });
  nullableObject(raw.result, "result");
  return raw;
}
```

- [ ] **Step 4: Call the validator from `MatchStore.loadAll()`**

Import it in `server/store.js`:

```js
import { assertStoredMatchV1 } from "./match-schema.js";
```

Replace the current three-field schema condition with:

```js
const record = JSON.parse(await readFile(path.join(this.directory, file), "utf8"));
assertStoredMatchV1(record, matchId);
records.push(record);
```

- [ ] **Step 5: Run the store tests**

Run:

```powershell
node --test tests/server/store.test.js
```

Expected: all store tests PASS; one bad file remains isolated from the valid file.

- [ ] **Step 6: Commit durable-edge validation**

```powershell
git add server/match-schema.js server/store.js tests/server/store.test.js
git commit -m "fix: validate stored match records"
```

## Task 6: Reject replay and metadata contradictions

**Files:**
- Modify: `server/match-record.js`
- Create: `tests/server/match-record.test.js`

- [ ] **Step 1: Create replay-integrity tests**

Create `tests/server/match-record.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
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

test("restore accepts only timeout and abort as rule-external results", () => {
  const playing = playingRecord({ turnTimeoutMs: 10 });
  const expired = expireMatchRecord(playing, 130);
  assert.equal(restoreMatch(serializeMatch(expired)).game.result.reason, "turn_timeout");

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
```

- [ ] **Step 2: Run the new tests and observe forged records restoring**

Run:

```powershell
node --test tests/server/match-record.test.js
```

Expected: at least the contradiction tests FAIL because `restoreMatch()` currently overwrites replayed results with stored data.

- [ ] **Step 3: Add complete v1 consistency helpers**

Add this import and helpers to `server/match-record.js`:

```js
import { isDeepStrictEqual } from "node:util";

function corrupt(message) {
  throw new Error(`Invalid match record: ${message}`);
}

function isExternalResult(result, game) {
  if (result?.reason === "admin_abort") {
    return result.kind === "aborted" && result.winner === null;
  }
  if (result?.reason === "turn_timeout") {
    return result.kind === "win" && result.winner === otherPlayer(game.currentPlayer);
  }
  return false;
}

function expectedStatus(record, result) {
  if (result !== null) return "finished";
  return record.joined.left && record.joined.right ? "playing" : "waiting";
}

function assertMetadata(record, replayResult) {
  for (const seat of ["left", "right"]) {
    if (record.joined[seat] !== (record.profiles[seat] !== null)) {
      corrupt(`profiles.${seat} contradicts joined.${seat}`);
    }
  }
  if (record.updatedAt < record.createdAt) corrupt("updatedAt precedes createdAt");
  let previousAt = record.createdAt;
  for (const [index, entry] of record.actions.entries()) {
    if (entry.at < previousAt || entry.at > record.updatedAt) corrupt(`actions[${index}].at is out of order`);
    previousAt = entry.at;
  }
  const externalIncrement = record.result !== null && replayResult === null ? 1 : 0;
  const expectedVersion = Number(record.joined.left) + Number(record.joined.right)
    + record.actions.length + externalIncrement;
  if (record.version !== expectedVersion) corrupt("version contradicts accepted mutations");
  const status = expectedStatus(record, record.result);
  if (record.status !== status) corrupt("status contradicts the record");
  if (status === "playing") {
    const expectedDeadline = record.config.turnTimeoutMs === null
      ? null
      : record.updatedAt + record.config.turnTimeoutMs;
    if (record.turnDeadlineAt !== expectedDeadline) corrupt("turnDeadlineAt contradicts the active turn");
  } else if (record.turnDeadlineAt !== null) {
    corrupt("turnDeadlineAt exists outside an active timed turn");
  }
}
```

- [ ] **Step 4: Replace `restoreMatch()` with replay-first restoration**

Use this complete implementation:

```js
export function restoreMatch(raw) {
  const record = structuredClone(raw);
  let game = createGame(record.config);
  for (const [index, entry] of record.actions.entries()) {
    game = applyAction(game, entry.player, entry.action);
    if (game.plies !== entry.ply) corrupt(`actions[${index}].ply contradicts replay`);
  }

  const replayResult = structuredClone(game.result);
  if (replayResult !== null) {
    if (!isDeepStrictEqual(record.result, replayResult)) corrupt("result contradicts replay");
  } else if (record.result !== null) {
    if (!isExternalResult(record.result, game)) corrupt("result contradicts replay");
    if (record.result.reason === "turn_timeout" && !(record.joined.left && record.joined.right)) {
      corrupt("turn timeout exists before both seats joined");
    }
    game.result = structuredClone(record.result);
  }

  assertMetadata(record, replayResult);
  return { ...record, game };
}
```

Do not catch `applyAction` errors here. `MatchService.open()` already converts any restore exception into one unavailable-record entry while continuing to load other matches.

- [ ] **Step 5: Run record, store, and service restoration tests**

Run:

```powershell
node --test tests/server/match-record.test.js tests/server/store.test.js tests/server/match-service.test.js
```

Expected: all selected tests PASS.

- [ ] **Step 6: Commit replay integrity**

```powershell
git add server/match-record.js tests/server/match-record.test.js
git commit -m "fix: reject contradictory match records"
```

## Task 7: Serialize MCP seat binding

**Files:**
- Modify: `mcp/session.js`
- Test: `tests/mcp/session.test.js`

- [ ] **Step 1: Write the concurrent-different-binding regression test**

Append:

```js
test("concurrent joins cannot replace the first requested binding", async () => {
  const requests = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    await gate;
    const matchId = new URL(url).pathname.split("/")[3];
    return new Response(JSON.stringify({ ...PLAYER_STATE, matchId }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const session = new AgentSession({ baseUrl: "http://127.0.0.1:7100", fetchImpl });

  const first = session.join("m_first", "token_first", "First");
  const second = session.join("m_second", "token_second", "Second");
  release();

  assert.equal((await first).matchId, "m_first");
  await assert.rejects(second, (error) => error.code === "ALREADY_JOINED");
  assert.equal(requests.length, 1);
  assert.equal(session.matchId, "m_first");
  assert.equal(session.token, "token_first");
});
```

- [ ] **Step 2: Run the regression and observe both HTTP joins**

Run:

```powershell
node --test --test-name-pattern="concurrent joins" tests/mcp/session.test.js
```

Expected: FAIL because both requests are sent and the later response can replace the binding.

- [ ] **Step 3: Make `join()` own the single in-flight binding attempt**

Replace `ensureJoined()` and `join()` with:

```js
async ensureJoined() {
  this.requireBinding();
  if (this.joined) return;
  await this.join(this.matchId, this.token);
}

async join(matchId, token, name) {
  const conflicts = () => this.matchId && (this.matchId !== matchId || this.token !== token);
  if (this.joined && conflicts()) {
    throw new GameError("ALREADY_JOINED", "This MCP session is already bound to a match seat");
  }
  if (this.joining) {
    const state = await this.joining;
    if (conflicts()) {
      throw new GameError("ALREADY_JOINED", "This MCP session is already bound to a match seat");
    }
    return state;
  }
  if (conflicts()) {
    throw new GameError("ALREADY_JOINED", "This MCP session is already bound to a match seat");
  }

  const attempt = this.request(`/api/matches/${matchId}/join`, {
    token,
    method: "POST",
    body: JSON.stringify({ name: name || "MCP agent", clientKind: "mcp" })
  }).then((state) => {
    this.matchId = matchId;
    this.token = token;
    this.joined = true;
    return withAscii(state);
  });
  this.joining = attempt;
  try {
    return await attempt;
  } finally {
    if (this.joining === attempt) this.joining = null;
  }
}
```

The first caller establishes the requested identity before another network request can start. Same-binding callers share the result; different-binding callers wait and then receive `ALREADY_JOINED`. A rejected attempt clears `this.joining`, preserving the existing retry behavior.

- [ ] **Step 4: Run all MCP tests**

Run:

```powershell
node --test "tests/mcp/*.test.js"
```

Expected: all MCP tests PASS, including pre-bound lazy join, shared failure recovery, and concurrent different joins.

- [ ] **Step 5: Commit binding serialization**

```powershell
git add mcp/session.js tests/mcp/session.test.js
git commit -m "fix: serialize MCP seat binding"
```

## Task 8: Document and verify the correctness foundation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update only the behavior delivered by this phase**

In the rules section, replace the timeout bullet with:

```markdown
- 默认不限回合时间；`turnTimeoutMs` 可配置为 1 至 2,147,483,647 毫秒。处理请求时若已到截止时间，服务端先结算超时，恰好在截止时刻到达的行动也不会被接受。管理员也可中止对局。
```

In “持久化与安全边界”, replace the record-recovery bullet with:

```markdown
- 回合计时按持久化截止时间恢复。载入时会校验记录字段并重放全部行动；字段、版本、状态、截止时间或结果互相矛盾的记录会被隔离且不会自动覆盖。
```

Do not document invitations, ready state, DSH presets, or record v2 in this phase.

- [ ] **Step 2: Run focused behavioral verification**

Run:

```powershell
node --test "tests/core/*.test.js" "tests/server/*.test.js" "tests/mcp/*.test.js"
```

Expected: all selected tests PASS.

- [ ] **Step 3: Run repository-level verification**

Run:

```powershell
npm.cmd test
node --check server/index.js
node --check mcp/index.js
node --check web/app.js
git diff --check
```

Expected: 0 failing tests; all three syntax checks exit 0; `git diff --check` prints no errors. Do not rerun a passing command merely for the final commit.

- [ ] **Step 4: Commit the delivered documentation**

```powershell
git add README.md
git commit -m "docs: describe match correctness guarantees"
```

- [ ] **Step 5: Inspect the final phase boundary**

Run:

```powershell
git status --short
git log --oneline -8
```

Expected: no tracked modifications remain. The pre-existing `quoridor-reference-20261024.png` may remain untracked and must not be added. The log shows separate commits for timeout bounds, direct validation, deadline settlement, notification containment, stored-record validation, replay integrity, MCP binding, and documentation.
