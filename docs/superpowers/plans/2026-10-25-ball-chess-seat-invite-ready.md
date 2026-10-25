# Ball Chess Seat, Invitation, and Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace join-triggered start with persistent seat phases, ten-minute one-time seat invitations, idempotent redemption, and a shared ready transition that starts only when both seats are ready.

**Architecture:** Persist record v2 as the sole authority and migrate valid v1 records in memory on load. Keep every match mutation in the existing per-match queue; invitation lookup only locates a candidate, while redemption and consumption happen inside that match queue. Adapt the current Web, MCP, bot, and tests only enough to remain usable; the four-stage frontend redesign, shared Agent Client, and DSH plugin remain later phases.

**Tech Stack:** Node.js 22 ESM, `node:test`, native crypto/HTTP/SSE, JSON files, native browser JavaScript, `@modelcontextprotocol/sdk`

---

## File map

- Create `server/invitations.js`: Crockford Base32 generation, normalization, and SHA-256 digesting.
- Modify `server/match-schema.js`: admit strict v1 and v2 durable records.
- Modify `server/store.js`: dispatch durable validation by schema version.
- Modify `server/match-record.js`: v2 creation, v1 migration, derived status, claim, ready, invitation, action, timeout, abort, and serialization transitions.
- Modify `server/match-service.js`: nested create request, ready and invitation commands, digest lookup, and public-state projection with the injected clock.
- Modify `server/app.js` and `server/http-utils.js`: expose create, ready, invitation generation, and redemption routes with stable errors.
- Modify `web/api.js`, `web/app.js`, `web/index.html`, and `web/state-view.js`: minimally expose current phase and a ready/cancel-ready button.
- Modify `mcp/session.js` and `mcp/tools.js`: expose `set_ready` without adding invitation or shared-client work early.
- Modify `examples/bot.js`: join then ready before the play loop.
- Update focused tests under `tests/server`, `tests/web`, `tests/mcp`, and `tests/e2e`.
- Modify `README.md`: document record v2, invitation and ready APIs, migration, and transitional client behavior.

## Task 1: Invitation code primitives

**Files:**
- Create: `server/invitations.js`
- Create: `tests/server/invitations.test.js`

- [ ] Write tests that a fixed 16-byte value produces 26 Crockford characters, formatted and unformatted codes normalize to the same value, lowercase and hyphens are accepted, invalid alphabet/length is rejected, and equal normalized codes have equal SHA-256 digests.
- [ ] Run `node --test tests/server/invitations.test.js` and confirm failure because the module does not exist.
- [ ] Implement these exports:

```js
export const INVITATION_TTL_MS = 10 * 60 * 1000;
export function generateInvitationCode(random = randomBytes) {}
export function normalizeInvitationCode(value) {}
export function digestInvitationCode(value) {}
```

`generateInvitationCode` must request exactly 16 random bytes, encode all 128 bits into 26 Crockford Base32 characters, and display them as groups `5-5-5-5-6`. `normalizeInvitationCode` removes hyphens, uppercases, and requires exactly 26 characters from `0123456789ABCDEFGHJKMNPQRSTVWXYZ`. `digestInvitationCode` hashes the normalized 26-character value and returns lowercase hexadecimal.
- [ ] Re-run the focused test and expect PASS.
- [ ] Commit with `feat: add seat invitation codes`.

## Task 2: Record v2 and safe v1 migration

**Files:**
- Modify: `server/match-schema.js`
- Modify: `server/store.js`
- Modify: `server/match-record.js`
- Modify: `tests/server/store.test.js`
- Modify: `tests/server/match-record.test.js`

- [ ] Add failing tests for a new record with `schemaVersion: 2`, `startedAt: null`, seat phases `open`, empty invitations, no persisted `status`, and public `status: waiting` derived from `startedAt` and `result`.
- [ ] Add v1 migration tests:
  - waiting unjoined/ joined seats become `open`/`claimed`;
  - playing seats become `ready`, preserve deadline, and receive `startedAt` from first action time or old `updatedAt`;
  - finished started records remain finished and ready;
  - contradictory v1 replay still throws before migration.
- [ ] Add v2 restoration tests for invalid phase/profile pairs, illegal started/deadline combinations, and replay/result contradiction.
- [ ] Run `node --test tests/server/match-record.test.js tests/server/store.test.js` and confirm v2 cases fail.
- [ ] Extend `match-schema.js` with `assertStoredMatchV2(raw, expectedId)`. Validate common tokens/timestamps/config/actions plus:

```js
seats: {
  left: { phase: "open" | "claimed" | "ready", profile: object | null },
  right: { phase: "open" | "claimed" | "ready", profile: object | null }
},
invitations: { left: invitationOrNull, right: invitationOrNull },
startedAt: number | null,
result: object | null
```

An invitation record contains `generation`, `digest`, `expiresAt`, `consumedAt`, and `redemptionId`; the last two are both null or both non-null.
- [ ] Make `MatchStore.loadAll()` select the v1 or v2 validator by `schemaVersion` and isolate unknown versions.
- [ ] Refactor `restoreMatch(raw)` to validate/replay v1 first, migrate it to an in-memory v2 record, and validate/replay native v2 directly. `serializeMatch()` always writes v2 and never writes `status`.
- [ ] Export `statusFor(record)` and make `toPublicState(record, seat, now)` expose `seats.<seat>.phase`, profile, and invitation availability/generation without digests or tokens.
- [ ] Run the focused tests and expect PASS.
- [ ] Commit with `feat: migrate matches to record v2`.

## Task 3: Claim and ready transitions

**Files:**
- Modify: `server/match-record.js`
- Modify: `tests/server/match-record.test.js`
- Modify: `tests/server/match-service.test.js`

- [ ] Add failing transition tests proving:
  - claiming changes only `open → claimed` and never starts;
  - duplicate claim by the seat token is idempotent;
  - only claimed seats can ready;
  - ready can return to claimed before start;
  - a repeated ready value does not increment version;
  - the second ready atomically sets both phases ready, `startedAt`, and the first deadline with one version increment;
  - ready cannot change after start.
- [ ] Run the two focused files and confirm failures because v1 join still auto-starts and ready does not exist.
- [ ] Replace `joinMatchRecord` with `claimMatchRecord(record, seat, profile, now)` and add:

```js
export function setReadyMatchRecord(record, seat, ready, now = Date.now()) {}
```

Use `MATCH_ALREADY_STARTED`, `SEAT_NOT_CLAIMED`, and `MATCH_FINISHED` errors. Claiming or externally occupying a seat clears only that seat's unconsumed invitation. Starting settles the initial turn and clears the deadline if the initial position is terminal.
- [ ] Update action, expiry, abort, timer, and public-state paths to use `statusFor(record)` instead of a stored status field. Abort clears unconsumed invitations but retains consumed redemption receipts.
- [ ] Run focused record and service tests; expect PASS.
- [ ] Commit with `feat: add persistent seat readiness`.

## Task 4: Creation and ready service/API

**Files:**
- Modify: `server/match-service.js`
- Modify: `server/app.js`
- Modify: `server/http-utils.js`
- Modify: `tests/server/match-service.test.js`
- Modify: `tests/server/http.test.js`

- [ ] Add failing service and HTTP tests for `POST /api/matches` with `{ config, claim? }`: no claim returns only admin credentials; a claim atomically returns `seat` and only that seat's `playerToken`; neither response contains `playerTokens`.
- [ ] Add failing tests for `POST /api/matches/:id/ready` with player authentication, `{ ready: boolean }`, idempotent repeats, cancellation before start, second-ready start, and rejection after start.
- [ ] Run the focused tests and confirm failures against the flat create body and missing route.
- [ ] Make `MatchService.create({ config, claim })` validate exact request fields, normalize a `profile` with `displayName` and `clientType`, create v2, and apply an optional claim before the single initial save.
- [ ] Make `join()` call the claim transition and add `setReady(id, token, ready)` through `enqueue()`.
- [ ] Add `/ready` routing and map `SEAT_NOT_CLAIMED`, `MATCH_ALREADY_STARTED`, and `SEAT_NOT_OPEN` to HTTP 409. Validate booleans and reject unknown fields as `INVALID_REQUEST`.
- [ ] Update existing service/HTTP fixtures to retrieve compatibility tokens through authenticated `/setup` or `service.getSetup()` and explicitly ready both seats before actions.
- [ ] Run focused service/HTTP tests and expect PASS.
- [ ] Commit with `feat: expose seat ready API`.

## Task 5: Invitation generation and idempotent redemption

**Files:**
- Modify: `server/match-record.js`
- Modify: `server/match-service.js`
- Modify: `server/app.js`
- Modify: `server/http-utils.js`
- Modify: `tests/server/match-record.test.js`
- Modify: `tests/server/match-service.test.js`
- Modify: `tests/server/http.test.js`

- [ ] Add failing tests for administrator-only generation on an explicit open seat, ten-minute expiry, generation replacement, and public state that exposes only availability/generation.
- [ ] Add failing concurrent redemption tests: two different redemption IDs yield one success and one `INVITE_CONSUMED`; retrying the successful ID returns the same match, seat, token, and latest state after expiry or finish.
- [ ] Add failing tests that malformed, unknown, expired, occupied, and aborted invitations return stable errors without leaking code/digest/token.
- [ ] Run focused tests and confirm missing methods/routes.
- [ ] Add record transitions:

```js
export function createInvitationRecord(record, seat, digest, expiresAt, now) {}
export function redeemInvitationRecord(record, seat, digest, redemptionId, profile, now) {}
```

Idempotency checks consumed digest plus redemption ID before expiry, result, or seat checks. Successful redemption changes `open → claimed`, retains the consumed invitation receipt, and increments version once.
- [ ] Inject `generateInvitationCode` into `MatchService`; add administrator validation, digest lookup across loaded matches, queued generation, and queued redemption. Reject digest collisions rather than selecting one match.
- [ ] Add `POST /api/matches/:id/invitations` and `POST /api/invitations/redeem`. Validate seat, normalized profile, and a client-supplied redemption ID encoded as exactly 32 hexadecimal characters (128 bits).
- [ ] Map `INVITE_INVALID` to 404 and `INVITE_EXPIRED`, `INVITE_CONSUMED`, and `SEAT_NOT_OPEN` to 409.
- [ ] Run focused tests and expect PASS.
- [ ] Commit with `feat: add idempotent seat invitations`.

## Task 6: Keep existing clients usable

**Files:**
- Modify: `web/api.js`, `web/app.js`, `web/index.html`, `web/state-view.js`
- Modify: `mcp/session.js`, `mcp/tools.js`
- Modify: `examples/bot.js`
- Modify: `tests/web/api.test.js`, `tests/web/state-view.test.js`
- Modify: `tests/mcp/session.test.js`, `tests/mcp/ascii.test.js`, `tests/mcp/mcp.test.js`
- Modify: `tests/e2e/bots.test.js`

- [ ] Add failing Web API/state tests for `ready(id, token, boolean)`, ready-button eligibility, and `phase`-based seat display.
- [ ] Add failing MCP tests for `set_ready`, including the pre-bound tool list and a real two-client start only after both calls.
- [ ] Add/update the bot e2e expectation so each bot claims and readies before playing.
- [ ] Run Web, MCP, and bot tests and confirm failures from missing client support.
- [ ] Implement `MatchApi.ready`, a minimal ready/cancel-ready button, and phase text without reorganizing the page layout. Change create requests to `{ config, claim }` and profiles to `{ displayName, clientType }`.
- [ ] Implement `AgentSession.setReady(ready)` and a `set_ready` MCP tool with required boolean input. Keep `join_match` and pre-bound token flows for compatibility.
- [ ] Make `runBot()` call `/ready` after `/join`. Update e2e setup to obtain both compatibility tokens through `/setup` because create no longer returns both.
- [ ] Run `node --test "tests/web/*.test.js" "tests/mcp/*.test.js" tests/e2e/bots.test.js`; expect PASS.
- [ ] Commit with `feat: adapt clients to ready state`.

## Task 7: Documentation and final verification

**Files:**
- Modify: `README.md`

- [ ] Update the API table and user/MCP/bot instructions for nested creation, seat phases, invitations, ready, and record v2 migration. State that `/setup` remains a temporary advanced compatibility surface until the phase-three frontend replaces token-oriented setup.
- [ ] Run focused server, Web, MCP, and bot tests.
- [ ] Run `npm.cmd test`, `node --check server/index.js`, `node --check mcp/index.js`, `node --check web/app.js`, and `git diff --check`.
- [ ] Commit with `docs: describe seat invitation and ready flow`.
- [ ] Confirm `git status --short` shows only the pre-existing untracked `quoridor-reference-20261024.png`.
