# Ball Chess Phase 4 Shared Agent Client and MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. Work on the current `master`; do not create a branch or worktree.

**Goal:** Give MCP and future DSH integration one protocol-neutral Agent Client that joins by invitation, owns credentials outside model-visible arguments/results, waits efficiently over SSE, and returns compact actionable projections.

**Architecture:** Move HTTP, authentication, binding, projection, error recovery, and SSE lifecycle into `agent/`. A client instance owns exactly one seat binding and serializes joins. MCP becomes a thin tool-schema and presentation adapter. The client may expose a rich canonical result to host code, while model-facing text contains only compact state, legal actions, and recovery guidance.

**Tech Stack:** Node.js 22 ESM, native fetch/Web Streams, MCP SDK, `node:test`

---

## Task 1: Protocol-neutral Agent Client

**Files:** Create `agent/client.js`, `agent/projection.js`, `agent/sse.js`, and matching tests under `tests/agent/`.

- [ ] Write failing tests for binding by invitation, binding by compatibility token, concurrent join serialization, same-binding idempotency, conflicting binding rejection, ready/state/action calls, stable HTTP errors, and token absence from projections/errors.
- [ ] Write failing SSE tests for fragmented frames, CRLF, comments/heartbeats, reconnect after EOF/transient failure, monotonic notifications, caller abort, and reader cancellation.
- [ ] Run `node --test "tests/agent/*.test.js"` and confirm missing modules.
- [ ] Implement `BallChessAgentClient` with explicit `bindByInvite`, `bindByToken`, `setReady`, `getState`, `submitAction`, `waitForActionable`, and `close`. Credentials remain private fields and never appear in returned values.
- [ ] Implement compact ASCII and grouped legal-action projection under `agent/projection.js`; remove rule logic from adapters.
- [ ] Make `waitForActionable` return only `turn`, `finished`, `canceled`, or fatal failure. Heartbeats, reconnects, and waiting timeouts do not claim a turn is complete.
- [ ] Run agent tests and expect PASS.
- [ ] Commit with `feat: add shared ball chess agent client`.

## Task 2: MCP tool surface migration

**Files:** Modify `mcp/session.js`, `mcp/ascii.js`, `mcp/tools.js`, `mcp/index.js`, and tests under `tests/mcp/`.

- [ ] Change tests to require exactly `join_by_invite`, `set_ready`, `get_match_state`, `wait_for_turn`, and `submit_action` for an unbound MCP process. Assert no tool input schema accepts `playerToken`.
- [ ] Assert a `--match` prebound process hides `join_by_invite`, reads `BALL_CHESS_PLAYER_TOKEN` only in the host process, and otherwise exposes the same four play tools.
- [ ] Assert model-facing text is compact and never contains invitation codes, player tokens, authorization headers, or the full JSON state.
- [ ] Run MCP tests and confirm failures against `join_match` and JSON-string rendering.
- [ ] Replace MCP session networking with a thin wrapper over `BallChessAgentClient`. Remove duplicated ASCII/SSE/request logic.
- [ ] Implement invite join with an internally generated idempotency ID, automatic ready after successful join, compact tool text, and structured canonical results without credentials.
- [ ] Thread MCP call cancellation into `waitForActionable`; ensure reader cancellation closes the subscription.
- [ ] Run MCP tests and expect PASS.
- [ ] Commit with `refactor: share agent client with mcp`.

## Task 3: Agent integration verification and docs

**Files:** Modify `README.md`, `web/agent-instructions.js`, `tests/web/agent-instructions.test.js`, and `tests/e2e/bots.test.js`.

- [ ] Update agent setup copy to prefer `加入邀请码 <code> 并开始`; retain prebound token configuration only as an advanced compatibility example.
- [ ] Add an end-to-end case with two independent clients redeeming separate invitations, readying, waiting, and completing a match.
- [ ] Run `node --test "tests/agent/*.test.js" "tests/mcp/*.test.js" tests/web/agent-instructions.test.js tests/e2e/bots.test.js`.
- [ ] Run `npm.cmd test`, `node --check mcp/index.js`, and `git diff --check`.
- [ ] Commit with `docs: describe invitation-first agent access`.
