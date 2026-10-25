# Ball Chess Agent Rules and Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Ball Chess client one configuration-derived rule/state projection, preserve recoverable terminal results, package the DSH preset as a portable bundle, and add a Ball Chess-specific compaction engine built on `BasicCompactionEngine`.

**Architecture:** A pure descriptor under `core/` owns configuration-derived rule facts; Agent and Web renderers consume it without duplicating game rules. The DSH plugin replaces a bound secret grant with a non-secret finished receipt before returning terminal output. The Ball Chess package becomes a DSH bundle whose preset mounts the existing tools and a `BasicCompactionEngine` subclass that overrides only summary generation.

**Tech Stack:** Node.js ESM, `node:test`, native HTTP/SSE, Cordis plugins, DeepSeek Harness `BasicCompactionEngine`, `@deepseek-ai/dsh-llm`, HTML/CSS/vanilla browser JavaScript.

---

## File map

- Create `core/rule-description.js`: configuration-derived rule facts and wall budgets; no UI wording or I/O.
- Modify `agent/projection.js`: Agent-facing English rule/state renderer and lossless legal-wall range compression.
- Modify `agent/client.js`: keep all returned states on the shared projection path.
- Modify `tests/agent/projection.test.js`: finite/unlimited walls, terminal outcome, timeout and lossless action compression.
- Modify `web/state-view.js`: Chinese rule-panel view model derived from `core/rule-description.js`.
- Modify `web/index.html`, `web/app.js`, `web/styles.css`: render the dynamic rules panel without adding a second rule source.
- Modify `tests/web/state-view.test.js`, `tests/web/app-flow.test.js`: dynamic panel and DOM wiring coverage.
- Modify `dsh/grant-store.js`: add the non-secret `finished` receipt state and atomic bound-to-finished replacement.
- Modify `dsh/plugin.js`: persist a terminal receipt before closing the authenticated client; recover it without a player token.
- Modify `tests/dsh/grant-store.test.js`, `tests/dsh/plugin.test.js`, `tests/e2e/dsh-plugin.test.js`: terminal interruption and recovery coverage.
- Modify `package.json`, `package-lock.json`, `dsh/ball-chess.overlay.yml`: declare the local DSH bundle, peer dependencies and relative plugin paths.
- Modify `tests/dsh/overlay.test.js`: bundle manifest, relative loading, minimal preset and dynamic persona checks.
- Create `dsh/compaction-summary.js`: Ball Chess checkpoint prompt, policy/target selection and output validation helpers independent of Cordis.
- Create `dsh/compaction-plugin.js`: `BasicCompactionEngine` subclass and one-shot LLM summary call.
- Create `tests/dsh/compaction-summary.test.js`: prompt, target selection and checkpoint validation tests.
- Create `tests/dsh/compaction-plugin.test.js`: public DSH runtime integration test for summary call and failure handling.
- Modify `dsh/README.md`, `README.md`: bundle installation, preset behavior, rule projection and compaction settings.

### Task 1: Shared rule facts and complete Agent projection

**Files:**
- Create: `core/rule-description.js`
- Modify: `agent/projection.js`
- Test: `tests/agent/projection.test.js`

- [ ] **Step 1: Write failing tests for configuration-derived rules and wall budgets**

Add imports and assertions showing that unlimited and finite walls are different data, not different hardcoded prose:

```js
import { describeMatchRules, describeWallBudgets } from "../../core/rule-description.js";

test("rule facts preserve the actual match configuration", () => {
  const game = createGame({ wallLimit: 6, maxPlies: 80, turnTimeoutMs: 30_000, firstPlayer: "right" });
  assert.deepEqual(describeMatchRules(game.config), {
    board: { width: 9, height: 13, origin: "bottom-left" },
    starts: { left: [2, 0], right: [6, 0] },
    goals: { left: 12, right: 12 },
    firstPlayer: "right",
    maxPlies: 80,
    turnTimeoutMs: 30_000,
    wallLimit: 6
  });
  assert.deepEqual(describeWallBudgets(game), {
    mode: "finite", limit: 6,
    left: { used: 0, remaining: 6 }, right: { used: 0, remaining: 6 }
  });
});

test("unlimited walls expose usage without invented remaining counts", () => {
  const game = createGame({ wallLimit: null });
  game.players.left.wallsUsed = 3;
  assert.deepEqual(describeWallBudgets(game), {
    mode: "unlimited", left: { used: 3 }, right: { used: 0 }
  });
});
```

- [ ] **Step 2: Run the focused tests and verify the missing module failure**

Run: `node --test tests/agent/projection.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `core/rule-description.js`.

- [ ] **Step 3: Implement the pure rule descriptor**

Create `core/rule-description.js` with no localized strings:

```js
import { HEIGHT, START_POSITIONS, WIDTH } from "./constants.js";

export function describeMatchRules(config) {
  return {
    board: { width: WIDTH, height: HEIGHT, origin: "bottom-left" },
    starts: { left: [...START_POSITIONS.left], right: [...START_POSITIONS.right] },
    goals: { left: HEIGHT - 1, right: HEIGHT - 1 },
    firstPlayer: config.firstPlayer,
    maxPlies: config.maxPlies,
    turnTimeoutMs: config.turnTimeoutMs,
    wallLimit: config.wallLimit
  };
}

export function describeWallBudgets(state) {
  const used = (seat) => state.players[seat].wallsUsed;
  if (state.config.wallLimit === null) {
    return { mode: "unlimited", left: { used: used("left") }, right: { used: used("right") } };
  }
  const limit = state.config.wallLimit;
  const budget = (seat) => ({ used: used(seat), remaining: Math.max(0, limit - used(seat)) });
  return { mode: "finite", limit, left: budget("left"), right: budget("right") };
}
```

- [ ] **Step 4: Add failing tests for complete decision text and lossless wall ranges**

Extend `tests/agent/projection.test.js`:

```js
import { expandWallRanges, projectState, renderAgentResult } from "../../agent/projection.js";

test("wall range text is lossless across gaps and orientations", () => {
  const projected = projectState({
    ...createGame({ wallLimit: 4, turnTimeoutMs: 30_000 }),
    matchId: "m_range", version: 7, status: "playing", yourPlayer: "left", yourTurn: true,
    turnDeadlineAt: 40_000,
    legalActions: [
      { type: "place_wall", orientation: "h", x: 0, y: 1 },
      { type: "place_wall", orientation: "h", x: 1, y: 1 },
      { type: "place_wall", orientation: "h", x: 3, y: 1 },
      { type: "place_wall", orientation: "v", x: 1, y: 0 }
    ]
  });
  assert.deepEqual(expandWallRanges(projected.legalActions.wallRanges), {
    h: [[0, 1], [1, 1], [3, 1]], v: [[1, 0]]
  });
  const text = renderAgentResult({ kind: "turn", state: projected });
  assert.match(text, /walls=finite limit=4 left used=0 remaining=4 right used=0 remaining=4/);
  assert.match(text, /deadline=40000/);
});

test("finished text carries the authoritative outcome and forbids more actions", () => {
  const state = projectState({
    ...createGame(), matchId: "m_done", version: 12, status: "finished",
    yourPlayer: "left", yourTurn: false, turnDeadlineAt: null, legalActions: [],
    result: { kind: "win", winner: "left", reason: "reached_goal" }
  });
  const text = renderAgentResult({ kind: "finished", state });
  assert.match(text, /winner=left reason=reached_goal/);
  assert.match(text, /do not submit more actions/i);
});
```

- [ ] **Step 5: Implement deterministic action ranges and the complete renderer**

Modify `agent/projection.js` so `projectState()` attaches `rules`, `wallBudgets`, grouped actions and `wallRanges`. Encode only consecutive x-values on the same y row; keep orientations separate. Export `expandWallRanges()` for proof tests. Render waiting, turn and finished text in a fixed order:

```js
projected.rules = describeMatchRules(state.config);
projected.wallBudgets = describeWallBudgets(state);
projected.legalActions = groupLegalActions(state.legalActions);
projected.legalActions.wallRanges = compressWallCoordinates(projected.legalActions.walls);
```

The renderer must include `rules=board 9x13 ...`, dynamic walls, deadline (`none` for untimed play), ASCII board, compressed actions, and terminal `winner`/`reason`. It must never inspect or print credential fields.

- [ ] **Step 6: Run the focused Agent tests**

Run: `node --test tests/agent/projection.test.js tests/agent/client.test.js tests/mcp/mcp.test.js`

Expected: all tests PASS; no snapshot contains `playerToken`.

- [ ] **Step 7: Commit the shared projection**

```powershell
git add core/rule-description.js agent/projection.js tests/agent/projection.test.js
git commit -m "feat: describe ball chess rules to agents"
```

### Task 2: Dynamic frontend rules panel

**Files:**
- Modify: `web/state-view.js`
- Modify: `web/index.html`
- Modify: `web/app.js`
- Modify: `web/styles.css`
- Test: `tests/web/state-view.test.js`
- Test: `tests/web/app-flow.test.js`

- [ ] **Step 1: Write failing view-model tests**

Import `rulePanelLines` in `tests/web/state-view.test.js` and assert both wall modes:

```js
test("rule panel follows finite and unlimited wall settings", () => {
  const base = {
    config: { width: 9, height: 13, firstPlayer: "left", maxPlies: 300, turnTimeoutMs: null, wallLimit: 5 },
    players: { left: { wallsUsed: 2 }, right: { wallsUsed: 1 } }
  };
  assert.deepEqual(rulePanelLines(base), [
    "棋盘 9×13；双方目标均为到达 y=12",
    "每回合正交移动一格，或放置一堵不封死任一方路径的两边墙",
    "先手：左方；最多 300 手；不限时",
    "墙：每方 5 堵；左方剩余 3，右方剩余 4"
  ]);
  assert.match(rulePanelLines({ ...base, config: { ...base.config, wallLimit: null } })[3], /墙：无限/);
});
```

- [ ] **Step 2: Run the view test and verify it fails**

Run: `node --test tests/web/state-view.test.js`

Expected: FAIL because `rulePanelLines` is not exported.

- [ ] **Step 3: Implement the browser view model from shared facts**

Modify `web/state-view.js` to import `describeMatchRules` and `describeWallBudgets` through the served `/core/` module path, and add `rulePanelLines(state)`. The function localizes display text only; it does not recalculate rule constants.

- [ ] **Step 4: Add the panel markup and render path**

Add one `#rules-panel` section to `web/index.html`. In `web/app.js`, render escaped list items from `rulePanelLines(snapshot)` whenever a snapshot is accepted, and clear it when outside a match. Do not add a second configuration read or API call.

```js
elements.rulesPanel.replaceChildren(...rulePanelLines(state).map((line) => {
  const item = document.createElement("li");
  item.textContent = line;
  return item;
}));
```

- [ ] **Step 5: Style the panel and prove the DOM hook exists**

Add compact `.rules-list` styling using existing surface, grid and text tokens. Extend `tests/web/app-flow.test.js` to assert `id="rules-panel"` and the call to `rulePanelLines`, without duplicating the exact prose in the DOM test.

- [ ] **Step 6: Run focused Web tests**

Run: `node --test tests/web/state-view.test.js tests/web/app-flow.test.js tests/web/app-state.test.js tests/web/board.test.js`

Expected: all tests PASS.

- [ ] **Step 7: Commit the frontend panel**

```powershell
git add web/state-view.js web/index.html web/app.js web/styles.css tests/web/state-view.test.js tests/web/app-flow.test.js
git commit -m "feat: show match-specific rules"
```

### Task 3: Recoverable terminal receipts

**Files:**
- Modify: `dsh/grant-store.js`
- Modify: `dsh/plugin.js`
- Test: `tests/dsh/grant-store.test.js`
- Test: `tests/dsh/plugin.test.js`
- Test: `tests/e2e/dsh-plugin.test.js`

- [ ] **Step 1: Write failing grant-store tests for the finished union member**

Add a valid non-secret receipt and assertions:

```js
const receipt = {
  kind: "finished",
  state: {
    matchId: "m_done", version: 9, status: "finished", yourPlayer: "left", yourTurn: false,
    result: { kind: "win", winner: "left", reason: "reached_goal" }
  }
};

test("finishing atomically replaces the player token with a terminal receipt", async () => {
  const store = new BallChessGrantStore(credentials);
  await store.finish("agent-1", "m_done", receipt);
  const saved = await store.read("agent-1");
  assert.equal(saved.state, "finished");
  assert.deepEqual(saved.receipt, receipt);
  assert.equal(JSON.stringify(saved).includes("seat_secret"), false);
});
```

Also assert that `beginRedemption()` may replace a finished record, while it still rejects replacing an active bound record.

- [ ] **Step 2: Run the grant tests and verify failure**

Run: `node --test tests/dsh/grant-store.test.js`

Expected: FAIL because `finish()` and the `finished` decoder branch do not exist.

- [ ] **Step 3: Implement strict receipt decoding and atomic replacement**

Extend the version-1 grant union with:

```js
{
  version: 1,
  state: "finished",
  matchId: "m_done",
  seat: "left",
  receipt: { kind: "finished", state: { /* projected public terminal state */ } }
}
```

Validate exact top-level keys, terminal status, matching match IDs, seat, integer version, result kind/reason and absence of credential-named keys. `finish(agentId, matchId, receipt)` must call `modifyRecord()`, require the current bound match to match, and replace the whole record in one write. `beginRedemption()` treats `finished` as replaceable history.

- [ ] **Step 4: Write failing plugin recovery tests**

Replace the existing “finish deletes it” expectation in `tests/dsh/plugin.test.js` with:

```js
test("finish removes the token but a new plugin instance can replay the terminal receipt", async () => {
  const first = context(credentials);
  createBallChessPlugin({ fetchImpl }).apply(first.ctx, config);
  const terminal = await first.definitions.get("get_match_state").execute({}, exec());
  assert.equal(terminal.kind, "finished");
  assert.equal(JSON.stringify(await credentials.readRecord(key)).includes("seat_secret"), false);
  first.dispose();

  const recovered = context(credentials);
  createBallChessPlugin({ fetchImpl: async () => { throw new Error("network must not be used"); } }).apply(recovered.ctx, config);
  assert.deepEqual(await recovered.definitions.get("get_match_state").execute({}, exec()), terminal);
});
```

- [ ] **Step 5: Implement terminal settlement in the DSH tool plugin**

Replace `cleanupFinished()` with `settleFinished(agentId, result)`: project the result first, persist `finished`, close and remove the authenticated client, then return the same result. `requireClient()` returns either an active client or a stored receipt. `get_match_state`, `wait_for_turn`, `set_ready` and `submit_action` short-circuit to the stored terminal receipt; `join_by_invite` may begin a new redemption from that record.

No code path deletes a bound grant merely because it observed `finished`. The atomic replacement is the token deletion and recovery checkpoint.

- [ ] **Step 6: Update the real server/plugin E2E**

Change `tests/e2e/dsh-plugin.test.js` to assert both records end in `state: "finished"`, contain no player token, survive plugin disposal, and return the same winner/reason after constructing a new harness without network access.

- [ ] **Step 7: Run lifecycle tests**

Run: `node --test tests/dsh/grant-store.test.js tests/dsh/plugin.test.js tests/e2e/dsh-plugin.test.js`

Expected: all tests PASS, including the simulated interruption between terminal observation and the next model turn.

- [ ] **Step 8: Commit terminal receipt support**

```powershell
git add dsh/grant-store.js dsh/plugin.js tests/dsh/grant-store.test.js tests/dsh/plugin.test.js tests/e2e/dsh-plugin.test.js
git commit -m "fix: preserve recoverable terminal receipts"
```

### Task 4: Portable Ball Chess DSH bundle

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `dsh/ball-chess.overlay.yml`
- Modify: `tests/dsh/overlay.test.js`

- [ ] **Step 1: Write failing bundle manifest and relative-path tests**

Update `tests/dsh/overlay.test.js`:

```js
test("the project is a portable DSH bundle", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.dsh, { bundle: { patch: "./dsh/ball-chess.overlay.yml" } });
  assert.match(manifest.engines.dsh, /0\.2\.1/);
  assert.ok(manifest.peerDependencies["@deepseek-ai/dsh-compaction-basic"]);
  assert.ok(manifest.peerDependencies["@deepseek-ai/dsh-llm"]);
});

test("bundle rows use patch-relative modules", async () => {
  const source = await readFile(new URL("../../dsh/ball-chess.overlay.yml", import.meta.url), "utf8");
  assert.match(source, /name: '\.\/plugin\.js'/);
  assert.match(source, /name: '\.\/compaction-plugin\.js'/);
  assert.doesNotMatch(source, /file:\/\/\//);
  assert.doesNotMatch(source, /E:\//);
});
```

- [ ] **Step 2: Run the overlay test and verify failure**

Run: `node --test tests/dsh/overlay.test.js`

Expected: FAIL because the manifest has no `dsh.bundle`, and the overlay still contains an absolute file URL and `compaction-basic` row.

- [ ] **Step 3: Declare the bundle and supported runtime peers**

Modify `package.json` to add:

```json
"dsh": { "bundle": { "patch": "./dsh/ball-chess.overlay.yml" } },
"engines": { "node": ">=24.9.0", "dsh": ">=0.2.1-rc.3 <0.3.0" },
"peerDependencies": {
  "@deepseek-ai/dsh-compaction-basic": ">=0.2.1-rc.3 <0.3.0",
  "@deepseek-ai/dsh-llm": ">=0.2.1-rc.3 <0.3.0"
}
```

Update the lock without installing peer packages into this application:

Run: `npm install --package-lock-only --ignore-scripts --legacy-peer-deps`

Expected: exit 0 and only manifest metadata changes in `package-lock.json`.

- [ ] **Step 4: Make the preset patch portable and dynamic**

Use `name: './plugin.js'` for the tools and `name: './compaction-plugin.js'` for the isolated compaction service. Expand the persona with the complete goal and protocol, but state that wall capacity, remaining walls, first player and timeout always come from the current tool result. Keep `complete: true`, `includeRuntimeContext: false`, and the forbidden general-purpose tools absent.

- [ ] **Step 5: Run manifest and preset tests**

Run: `node --test tests/dsh/overlay.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the bundle conversion**

```powershell
git add package.json package-lock.json dsh/ball-chess.overlay.yml tests/dsh/overlay.test.js
git commit -m "feat: package the ball chess dsh preset"
```

### Task 5: Ball Chess-specific compaction service

**Files:**
- Create: `dsh/compaction-summary.js`
- Create: `dsh/compaction-plugin.js`
- Create: `tests/dsh/compaction-summary.test.js`
- Create: `tests/dsh/compaction-plugin.test.js`
- Modify: `dsh/ball-chess.overlay.yml`

- [ ] **Step 1: Write failing pure summary-policy tests**

Create `tests/dsh/compaction-summary.test.js` with assertions for the six headings, latest-state instruction, dynamic wall wording and secret exclusions:

```js
import {
  BALL_CHESS_COMPACTION_INSTRUCTION,
  assertBallChessCheckpoint,
  resolveSummaryPolicy
} from "../../dsh/compaction-summary.js";

test("the checkpoint prompt is game-specific and configuration-driven", () => {
  for (const heading of ["Match Identity", "Rules and Configuration", "Last Observed Authoritative State", "User Instructions", "Pending Action", "Outcome"]) {
    assert.match(BALL_CHESS_COMPACTION_INSTRUCTION, new RegExp(`## ${heading}`));
  }
  assert.match(BALL_CHESS_COMPACTION_INSTRUCTION, /most recent authoritative tool result/i);
  assert.match(BALL_CHESS_COMPACTION_INSTRUCTION, /finite or unlimited/i);
  assert.doesNotMatch(BALL_CHESS_COMPACTION_INSTRUCTION, /10 walls/i);
});

test("checkpoint validation rejects incomplete output", () => {
  assert.throws(() => assertBallChessCheckpoint("## Match Identity\n- m_one"), /missing section/);
});
```

Test `resolveSummaryPolicy()` with top-level settings, an exact provider/model override, an explicit summarization target and the routed-model fallback.

- [ ] **Step 2: Run the pure test and verify missing-module failure**

Run: `node --test tests/dsh/compaction-summary.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement prompt, policy resolution and checkpoint validation**

Create `dsh/compaction-summary.js`. The instruction requires exactly six Markdown headings, terse bullets, latest authoritative tool output only, refresh on uncertainty, `wait_for_turn` when not actionable, no redeemed invite, no player token, no strategy continuation and no fixed wall count.

`resolveSummaryPolicy(config, agent)` resolves the routed target from the latest request header, then Agent options, applies the matching `config.modelPolicies` override, and returns `{ provider, model, maxTokens }`, with an explicit summarization provider/model pair taking precedence. Throw a clear error when no target exists.

`assertBallChessCheckpoint(text)` checks all headings occur exactly once in order and rejects empty text. It does not parse game facts or treat model output as authoritative.

- [ ] **Step 4: Write the DSH runtime integration test**

Create `tests/dsh/compaction-plugin.test.js` with a fake `ctx.llm.stream()` that records options and yields text plus a stop finish. Instantiate the exported class with `auto: false`, call an exposed test subclass method around protected `summarize()` through the DSH source runtime, and assert:

```js
assert.equal(call.purpose, "compaction");
assert.equal(call.maxTokens, 4096);
assert.equal(call.messages.at(-1).role, "user");
assert.match(call.messages.at(-1).content[0].text, /## Match Identity/);
assert.deepEqual(result.summary, [{ type: "text", text: checkpoint }]);
assert.equal(result.llmStreamCall, true);
```

Add cases for `max-tokens`, empty, image and provider error output. Execute this test with the DeepSeek Harness source resolver:

```powershell
pnpm --dir E:\Program\deepseek-harness exec node --import tsx/esm --test E:\My_project\ball_chess\tests\dsh\compaction-plugin.test.js
```

- [ ] **Step 5: Implement the subclass using public DSH exports**

Create `dsh/compaction-plugin.js`:

```js
import BasicCompactionEngine from "@deepseek-ai/dsh-compaction-basic";
import { BlockAssembler, contentHasImage, LlmError } from "@deepseek-ai/dsh-llm";
import {
  BALL_CHESS_COMPACTION_INSTRUCTION,
  assertBallChessCheckpoint,
  resolveSummaryPolicy
} from "./compaction-summary.js";

export default class BallChessCompactionEngine extends BasicCompactionEngine {
  async summarize(input, agent, signal) {
    const policy = resolveSummaryPolicy(this.config, agent);
    const assembler = new BlockAssembler();
    const messages = [...input.messages, {
      role: "user", content: [{ type: "text", text: BALL_CHESS_COMPACTION_INSTRUCTION }]
    }];
    const options = {
      provider: policy.provider, model: policy.model, messages,
      toolHistory: agent.session.toolHistory(),
      ...(input.tools === undefined ? {} : { tools: [...input.tools] }),
      maxTokens: policy.maxTokens, sessionId: agent.session.id,
      purpose: "compaction", ...(signal === undefined ? {} : { signal })
    };
    for await (const chunk of this.ctx.llm.stream(options)) assembler.push(chunk);
    if (assembler.finish.kind === "error" || assembler.finish.kind === "aborted") {
      throw new LlmError(
        assembler.finish.failure.message,
        assembler.finish.failure.code,
        assembler.finish.failure
      );
    }
    if (assembler.finish.kind === "max-tokens") {
      throw Object.assign(new Error("Ball Chess compaction summary was truncated"), { code: "MAX_TOKENS" });
    }
    const rawOutput = assembler.blocks();
    if (contentHasImage(rawOutput)) {
      throw new LlmError("Ball Chess compaction summary cannot contain images", "UNSUPPORTED_CONTENT");
    }
    const summary = rawOutput.filter((block) => block.type === "text");
    const text = summary.map((block) => block.text).join("");
    assertBallChessCheckpoint(text);
    return {
      summary, rawOutput, llmStreamCall: true,
      provider: options.provider, model: options.model, maxTokens: options.maxTokens,
      ...(assembler.usage === undefined ? {} : { usage: assembler.usage })
    };
  }
}
```

Use only public package exports. Do not import `@deepseek-ai/dsh-compaction-basic/src/*` or copy its pressure, region or persistence code.

- [ ] **Step 6: Run pure and DSH runtime tests**

Run: `node --test tests/dsh/compaction-summary.test.js`

Run: `pnpm --dir E:\Program\deepseek-harness exec node --import tsx/esm --test E:\My_project\ball_chess\tests\dsh\compaction-plugin.test.js`

Expected: both commands PASS; the runtime test proves the package resolves against the running DSH source tree.

- [ ] **Step 7: Commit the compaction plugin**

```powershell
git add dsh/compaction-summary.js dsh/compaction-plugin.js dsh/ball-chess.overlay.yml tests/dsh/compaction-summary.test.js tests/dsh/compaction-plugin.test.js
git commit -m "feat: compact ball chess sessions"
```

### Task 6: Documentation, bundle installation and integrated verification

**Files:**
- Modify: `dsh/README.md`
- Modify: `README.md`
- Test: `tests/e2e/dsh-plugin.test.js`

- [ ] **Step 1: Update operator documentation**

Replace the absolute-overlay launch instructions with:

```powershell
cd E:\My_project\ball_chess
dsh plugin --profile web add .
dsh web
```

Document removal with `dsh plugin --profile web remove ball-chess`, the `BALL_CHESS_URL` override, the exact compaction defaults, the distinction between normal model `maxTokens` and summary `maxTokens`, dynamic wall descriptions, finished receipts, and the fact that fork/subagent sessions do not inherit a seat.

- [ ] **Step 2: Run all Ball Chess tests**

Run: `npm test`

Expected: every `node:test` suite PASS. If the DSH runtime test is intentionally launched separately because plain npm cannot resolve profile peers, `npm test` must skip only that file with an explicit runtime guard and the next command must execute it.

- [ ] **Step 3: Run the DSH-specific test through the source runtime**

Run: `pnpm --dir E:\Program\deepseek-harness exec node --import tsx/esm --test E:\My_project\ball_chess\tests\dsh\compaction-plugin.test.js`

Expected: PASS.

- [ ] **Step 4: Install the local bundle into the current Web profile**

From `E:\My_project\ball_chess`, run:

```powershell
pnpm --dir E:\Program\deepseek-harness dsh plugin --profile web add .
```

Expected: the Web profile dependency points to the Ball Chess checkout and its bundle joins `dsh.profile.bundles`. No source branch or worktree is created.

- [ ] **Step 5: Inspect the composed profile**

Run:

```powershell
pnpm --dir E:\Program\deepseek-harness dsh web --dump-config
```

Expected: one `preset-ball-chess` row, `./plugin.js` resolved from the Ball Chess bundle layer, and `./compaction-plugin.js` as the isolated compaction provider. No `file:///E:/My_project/ball_chess` string remains in the stored patch.

- [ ] **Step 6: Start the supported Web application and smoke the preset**

Restart with `pnpm --dir E:\Program\deepseek-harness dsh web --no-open --port 7101`. In the Web UI, create a Ball Chess session and confirm the preset exposes only five game tools, the persona states the goal without a fixed wall count, and `/compact` uses the Ball Chess checkpoint headings.

- [ ] **Step 7: Run repository hygiene checks**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors; only the pre-existing untracked `quoridor-reference-20261024.png` remains outside committed changes.

- [ ] **Step 8: Commit documentation and final test adjustments**

```powershell
git add README.md dsh/README.md tests/e2e/dsh-plugin.test.js
git commit -m "docs: explain the ball chess dsh bundle"
```

- [ ] **Step 9: Record final evidence**

Capture the exact commands run, their pass counts, the installed profile name, the Web URL and the final commit range. Do not claim the browser smoke or `/compact` behavior unless it was actually observed.
