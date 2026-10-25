# Ball Chess Agent Decision Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give MCP and DSH agents an unambiguous decision packet, copyable action IDs, and an on-demand complete match record without adding strategy assistance.

**Architecture:** Keep the existing HTTP game API and structured action engine authoritative. Add a reversible Agent-only action-ID codec, project HTTP state into a perspective-aware decision view, translate MCP/DSH action IDs back into existing actions, and project the existing public record endpoint through a new bound-session tool.

**Tech Stack:** Node.js ESM, built-in `node:test`, MCP SDK, DSH Cordis plugin, existing HTTP/SSE service.

---

### Task 1: Add reversible action IDs

**Files:**
- Create: `agent/action-id.js`
- Create: `tests/agent/action-id.test.js`

- [ ] **Step 1: Write failing codec tests**

Test all four moves and representative horizontal/vertical walls, then reject malformed prefixes, extra fields, signs, decimals and non-canonical leading zeroes:

```js
assert.equal(formatActionId({ type: "move", direction: "up" }), "move:up");
assert.equal(formatActionId({ type: "place_wall", orientation: "v", x: 3, y: 4 }), "wall:v:3:4");
assert.deepEqual(parseActionId("wall:h:2:6"), { type: "place_wall", orientation: "h", x: 2, y: 6 });
assert.throws(() => parseActionId("wall:v:03:4"), (error) => error.code === "INVALID_ACTION_ID");
```

- [ ] **Step 2: Run the test and observe the missing-module failure**

Run: `node --test tests/agent/action-id.test.js`

Expected: FAIL because `agent/action-id.js` does not exist.

- [ ] **Step 3: Implement the minimal codec**

Export `formatActionId(action)` and `parseActionId(actionId)`. Use exact string matching for moves and `/^wall:([hv]):(0|[1-9]\d*):(0|[1-9]\d*)$/` for walls. Throw `GameError("INVALID_ACTION_ID", "...")` for every rejected value.

- [ ] **Step 4: Run the codec tests**

Run: `node --test tests/agent/action-id.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add agent/action-id.js tests/agent/action-id.test.js
git commit -m "feat(agent): add canonical action ids"
```

### Task 2: Project a self-contained decision packet

**Files:**
- Modify: `agent/projection.js`
- Modify: `tests/agent/projection.test.js`
- Modify: `dsh/grant-store.js`
- Modify: `tests/dsh/grant-store.test.js`

- [ ] **Step 1: Write failing projection tests**

Assert that a left-seat and right-seat projection each expose the correct `decision.actor.you` and `decision.actor.opponent`; moves include action ID, original action and target coordinate; wall summaries retain counts/ranges; coordinate metadata contains the exact h/v blocked-edge formulas. Assert the ASCII view includes x labels `0..8` and y labels `0..12`.

- [ ] **Step 2: Run the focused tests and verify the missing `decision` failure**

Run: `node --test tests/agent/projection.test.js tests/dsh/grant-store.test.js`

Expected: FAIL because `decision` is absent and terminal receipt validation does not accept it.

- [ ] **Step 3: Implement decision projection and coordinate-labelled ASCII**

Add helpers that derive perspective aliases without changing absolute coordinates. For each legal move compute `to` using the current player's actual position. Expose wall ranges as the current lossless ranges plus `count` and ID format. Keep `legalActionList` and the existing grouped `legalActions` for compatibility.

Update the text renderer to lead with `you`, `opponent`, axes, wall semantics and copyable action IDs. Do not add path length or evaluation fields.

- [ ] **Step 4: Extend terminal receipt validation**

Add `decision` to the exact terminal state keys and validate it by comparing against a fresh `projectState()` result derived from the terminal state's existing facts. This keeps stored receipts strict instead of accepting arbitrary nested data.

- [ ] **Step 5: Run the focused tests**

Run: `node --test tests/agent/projection.test.js tests/dsh/grant-store.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```text
git add agent/projection.js tests/agent/projection.test.js dsh/grant-store.js tests/dsh/grant-store.test.js
git commit -m "feat(agent): expose decision-ready match state"
```

### Task 3: Change model submission to action IDs and add records

**Files:**
- Modify: `agent/client.js`
- Modify: `mcp/session.js`
- Modify: `mcp/tools.js`
- Modify: `tests/agent/client.test.js`
- Modify: `tests/mcp/session.test.js`
- Modify: `tests/mcp/ascii.test.js`

- [ ] **Step 1: Write failing client and tool tests**

Require `submit_action` parameters `expectedVersion` and `actionId`; assert no structured `action` schema remains. Add `get_match_record` to the tool list. Verify record actions receive canonical IDs and that `submit_action("wall:v:3:4")` sends the existing HTTP body:

```json
{"expectedVersion":7,"action":{"type":"place_wall","orientation":"v","x":3,"y":4}}
```

- [ ] **Step 2: Run focused tests and observe schema/method failures**

Run: `node --test tests/agent/client.test.js tests/mcp/session.test.js tests/mcp/ascii.test.js`

Expected: FAIL because `get_match_record` and action-ID submission are not implemented.

- [ ] **Step 3: Implement record projection and client access**

Add `projectRecord(record)` and record text rendering beside the state projection. `BallChessAgentClient.getRecord()` must call the bound match's public `/record` endpoint and return the projected record. Each projected action retains `ply`, `player`, `action`, `at` and adds `actionId`.

- [ ] **Step 4: Update MCP session and tool definitions**

`AgentSession.submitAction(expectedVersion, actionId)` parses the ID and calls the existing client method. `AgentSession.getRecord()` ensures binding and delegates to the client. Register `get_match_record` after `get_match_state`; render its result through the shared Agent renderer.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/agent/client.test.js tests/mcp/session.test.js tests/mcp/ascii.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```text
git add agent/client.js agent/projection.js mcp/session.js mcp/tools.js tests/agent/client.test.js tests/mcp/session.test.js tests/mcp/ascii.test.js
git commit -m "feat(mcp): submit action ids and expose match records"
```

### Task 4: Update DSH lifecycle, prompt and compaction

**Files:**
- Modify: `dsh/plugin.js`
- Modify: `dsh/ball-chess.overlay.yml`
- Modify: `dsh/compaction-summary.js`
- Modify: `web/agent-instructions.js`
- Modify: `tests/dsh/plugin.test.js`
- Modify: `tests/dsh/compaction-summary.test.js`
- Modify: `tests/web/agent-instructions.test.js`

- [ ] **Step 1: Write failing DSH and prompt tests**

Assert the plugin registers `get_match_record`, translates `actionId`, and can fetch a finished match record using the configured loopback URL plus the receipt `matchId`. Assert persona, generated invitation instructions and compaction language say to copy an `actionId` and never preserve a recommended move.

- [ ] **Step 2: Run focused tests and observe failures**

Run: `node --test tests/dsh/plugin.test.js tests/dsh/compaction-summary.test.js tests/web/agent-instructions.test.js`

Expected: FAIL on the absent record tool and old submission wording.

- [ ] **Step 3: Implement DSH execution paths**

For live grants, use the cached client. For a finished receipt, read `/record` from the configured local server using `receipt.state.matchId`; do not recreate or persist a player token. Keep `get_match_state` offline-recoverable exactly as today.

- [ ] **Step 4: Update model-visible guidance**

Tell the model to select a current listed action ID, call `submit_action` with that exact ID and version, and call `get_match_record` only when it needs the full history. Preserve the instruction that configuration values are dynamic and that no strategy aid is supplied.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/dsh/plugin.test.js tests/dsh/compaction-summary.test.js tests/web/agent-instructions.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```text
git add dsh/plugin.js dsh/ball-chess.overlay.yml dsh/compaction-summary.js web/agent-instructions.js tests/dsh/plugin.test.js tests/dsh/compaction-summary.test.js tests/web/agent-instructions.test.js
git commit -m "feat(dsh): use decision action ids and match records"
```

### Task 5: Prove end-to-end wall and record behavior

**Files:**
- Modify: `tests/mcp/mcp.test.js`
- Modify: `tests/e2e/dsh-plugin.test.js`
- Modify: `README.md`
- Modify: `dsh/README.md`

- [ ] **Step 1: Change end-to-end tests before production compatibility updates**

Update MCP and DSH calls to submit action IDs. In at least one real two-client flow, submit `wall:h:...` and `wall:v:...`, then call `get_match_record` and assert both canonical IDs occur in ply order and the returned structured actions replay without rejection.

- [ ] **Step 2: Run end-to-end tests and confirm the old expectations fail**

Run: `node --test tests/mcp/mcp.test.js tests/e2e/dsh-plugin.test.js`

Expected: FAIL until all callers and record rendering use the new surface.

- [ ] **Step 3: Make the minimum compatibility corrections**

Update remaining model-facing callers and exact tool-list assertions. Do not change the browser or example bot HTTP action format.

- [ ] **Step 4: Update documentation**

Document the six-tool surface, action-ID grammar, coordinate/wall formulas, decision fields, record semantics and the fairness boundary. Explicitly state that wall counts come from the match configuration.

- [ ] **Step 5: Run relevant verification**

Run:

```text
node --test tests/agent tests/mcp tests/dsh tests/e2e/dsh-plugin.test.js tests/web/agent-instructions.test.js
node --check agent/action-id.js
node --check agent/projection.js
node --check mcp/tools.js
node --check dsh/plugin.js
git diff --check
```

Expected: all tests and syntax checks pass; `git diff --check` reports no content errors. The pre-existing untracked `quoridor-reference-20261024.png` remains untouched.

- [ ] **Step 6: Commit**

```text
git add tests/mcp/mcp.test.js tests/e2e/dsh-plugin.test.js README.md dsh/README.md
git commit -m "test: verify agent decision interface end to end"
```

## Self-review

- The plan covers every approved design element: copyable IDs, perspective aliases, explicit coordinates, on-demand record, DSH compaction, dynamic configuration and no strategy oracle.
- Browser and program-bot HTTP consumers remain compatible.
- Every production behavior has a preceding failing test and a focused command.
- The plan introduces no general game framework, action-mask service, analysis engine, pagination system or worktree.
