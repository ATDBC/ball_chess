# Player-colored walls implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the player who placed each wall in runtime state and render committed walls in that player's red or blue color.

**Architecture:** `applyAction()` adds `player` to a committed wall. Persisted match files remain unchanged because they already store the acting player beside each action; `restoreMatch()` rebuilds owned walls by replay. Public state carries the owned wall to the browser. The DSH terminal receipt validator accepts new owned walls and legacy ownerless receipts. The SVG renderer selects a red, blue, or neutral palette without changing wall previews.

**Tech stack:** Node.js ESM, `node:test`, pure SVG DOM construction, JSON action-log replay.

---

### Task 1: Record wall ownership during authoritative replay

**Files:**
- Modify: `tests/core/engine.test.js`
- Modify: `tests/server/match-record.test.js`
- Modify: `core/engine.js`

- [ ] **Step 1: Write the failing engine test**

Add a test which applies a legal vertical wall for `left` and expects `game.walls` to contain `{ orientation: "v", x: 3, y: 2, player: "left" }` while the input action remains unchanged.

- [ ] **Step 2: Write the failing replay test**

Create a started record, submit one wall, serialize and restore it, then assert that both `restored.game.walls[0].player` and `toPublicState(restored).walls[0].player` equal `left`. Also assert that the serialized action entry still owns the only persisted `player` field and no new top-level game snapshot is written.

- [ ] **Step 3: Run the focused tests and verify RED**

Run: `node --test tests/core/engine.test.js tests/server/match-record.test.js`

Expected: the new assertions fail because committed walls currently contain only `orientation`, `x`, and `y`.

- [ ] **Step 4: Add the owner to committed walls**

Change the wall branch in `applyAction()` to push:

```js
next.walls.push({
  orientation: action.orientation,
  x: action.x,
  y: action.y,
  player: playerId
});
```

- [ ] **Step 5: Re-run the focused tests and verify GREEN**

Run: `node --test tests/core/engine.test.js tests/server/match-record.test.js`

Expected: all focused tests pass.

### Task 2: Keep terminal receipts backward compatible

**Files:**
- Modify: `tests/dsh/grant-store.test.js`
- Modify: `dsh/grant-store.js`

- [ ] **Step 1: Write failing validator tests**

Extend the terminal receipt fixture with one owned wall and assert it decodes. Clone it, remove `player`, and assert the legacy receipt also decodes. Add invalid cases for an unknown player and for an extra wall field.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/dsh/grant-store.test.js`

Expected: the owned-wall receipt fails because `validWall()` currently requires exactly three keys.

- [ ] **Step 3: Accept exactly the new or legacy wall fields**

Update `validWall()` so geometry is validated once, then accept either exact keys `orientation,x,y` or exact keys `orientation,x,y,player` with `playerId(value.player)`.

- [ ] **Step 4: Re-run the focused test and verify GREEN**

Run: `node --test tests/dsh/grant-store.test.js`

Expected: all focused tests pass, including rejection of malformed ownership.

### Task 3: Render committed walls by player

**Files:**
- Modify: `tests/web/board.test.js`
- Modify: `web/board.js`

- [ ] **Step 1: Write the failing SVG test**

Render a state containing left, right, and ownerless walls. Assert that wall-top elements expose `data-player` values `left`, `right`, and `neutral`, and use `url(#wall-left)`, `url(#wall-right)`, and `url(#wall-neutral)` respectively. Assert the existing preview remains class-based and does not receive a player color.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/web/board.test.js`

Expected: the new gradients and `data-player` attributes are absent.

- [ ] **Step 3: Add three committed-wall palettes**

Replace the single wall gradient with red, blue, and neutral gradients. Select top fill, side fill, and stroke from a small palette keyed by `wall.player`; fall back to neutral when the value is absent. Add `data-player` to committed wall tops for accessibility and test inspection. Do not alter `.wall-preview` styling.

- [ ] **Step 4: Re-run the focused test and verify GREEN**

Run: `node --test tests/web/board.test.js`

Expected: all board tests pass.

### Task 4: Regression and browser acceptance

**Files:**
- Verify: all changed source and tests

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`

Expected: zero failures; DSH runtime-only compaction tests may retain their documented environment skips.

- [ ] **Step 2: Restart the Ball Chess server**

Restart the existing server on `127.0.0.1:7100` so the browser loads the changed module.

- [ ] **Step 3: Verify existing persisted match replay in the browser**

Open the latest completed match, confirm left walls are red, right walls are blue, and the board geometry matches the stored action history. Capture a screenshot.

- [ ] **Step 4: Inspect and commit**

Run `git diff --check`, confirm `quoridor-reference-20261024.png` remains untracked, stage only the implementation and test files, and commit with `feat(web): color walls by player`.
