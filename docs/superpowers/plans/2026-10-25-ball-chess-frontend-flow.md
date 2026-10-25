# Ball Chess Phase 3 Frontend Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. Work on the current `master`; do not create a branch or worktree.

**Goal:** Replace the token-oriented utility page with a four-stage browser experience for creating, joining, preparing, playing, and reviewing a match while preserving the server as the authority.

**Architecture:** Introduce one browser application state containing identity, snapshot, record, connection, pending operations, and UI selection. Rendering is a pure projection of `outside`, `waiting`, `playing`, or `finished`. SSE only announces possible changes; an epoch-guarded, single-flight HTTP refresh supplies authenticated state and prevents stale responses from overwriting newer state. The SVG board exposes one focus target and a cursor over legal actions instead of one tab stop per action.

**Tech Stack:** Native browser ESM, SVG, CSS, Node.js 22 `node:test`

---

## Task 1: Pure application-state and stage projection

**Files:** Create `web/app-state.js` and `tests/web/app-state.test.js`; modify `web/state-view.js` and `tests/web/state-view.test.js`.

- [ ] Write failing tests for identity normalization, the four stages, pending-operation eligibility, monotonic authenticated snapshots, epoch rejection after switching matches, and a single-flight refresh coordinator.
- [ ] Run `node --test tests/web/app-state.test.js tests/web/state-view.test.js` and confirm the new module is missing.
- [ ] Implement the top-level state `{ identity, snapshot, record, connection, pending, ui }`, pure reducers, and a refresh coordinator that coalesces simultaneous refresh requests and rejects results from an obsolete identity epoch.
- [ ] Keep local persistence limited to the current match ID, role/seat, and the current user's admin/player credential. Never persist another seat's credential.
- [ ] Run the focused tests and expect PASS.
- [ ] Commit with `feat: model browser match stages`.

## Task 2: Invitation-first HTTP client

**Files:** Modify `web/api.js` and `tests/web/api.test.js`.

- [ ] Add failing tests for invitation generation, invitation redemption with a client-generated redemption ID, public record retrieval, and request cancellation.
- [ ] Run `node --test tests/web/api.test.js` and confirm failures.
- [ ] Add `createInvitation`, `redeemInvitation`, and `record`; accept an optional `signal` in requests. Keep compatibility token join available only for the advanced browser flow.
- [ ] Run the focused test and expect PASS.
- [ ] Commit with `feat: add browser invitation client`.

## Task 3: Four-stage page structure

**Files:** Modify `web/index.html`, `web/styles.css`, and `web/app.js`; create `tests/web/app-flow.test.js`.

- [ ] Add failing DOM/source tests for stage-owned panels: create/invite/spectate outside, seat and ready controls while waiting, board-only primary controls while playing, and authoritative record/result after finish. Assert the compatibility token form is inside a collapsed advanced section.
- [ ] Run `node --test tests/web/app-flow.test.js` and confirm failures.
- [ ] Rebuild the sidebar as stage panels. Add invitation input, display name, spectate-by-match-ID, administrator invitation generation/copy/replacement, and the ready/cancel action. The copied instruction is `加入邀请码 <code> 并开始`.
- [ ] Drive all handlers through the application-state reducer. Generate one redemption ID per join attempt and reuse it for uncertain retries.
- [ ] On finish, fetch `/record`; render actions from the record rather than reconstructing history from transient SSE snapshots. Add “创建新对局”.
- [ ] Make SSE messages schedule the single-flight refresh. A heartbeat, reconnect, failed refresh, or lower-version snapshot must not replace the last trusted state.
- [ ] Run focused Web tests and expect PASS.
- [ ] Commit with `feat: add four-stage browser flow`.

## Task 4: Single-focus keyboard board

**Files:** Modify `web/board.js`, `web/board-geometry.js`, `web/styles.css`, `tests/web/board.test.js`, and `tests/web/board-geometry.test.js`.

- [ ] Add failing tests that the board SVG is the only focusable board element, has a suitable accessible label without nested interactive descendants inside `role=img`, and maintains a legal-action cursor.
- [ ] Add failing keyboard tests: arrows move the preview or change the move direction, `m` switches move/wall, `r` switches wall orientation, Enter confirms, and Escape cancels the preview.
- [ ] Run board tests and confirm failures against per-action tab stops.
- [ ] Render legal actions as pointer targets without individual tab stops. Put keyboard handling and active action description on the single SVG focus target, with a visible selected preview.
- [ ] Preserve mouse/touch activation and reduced-motion behavior.
- [ ] Run board tests and expect PASS.
- [ ] Commit with `feat: add keyboard board navigation`.

## Task 5: Phase 3 verification and documentation

**Files:** Modify `README.md` and `docs/superpowers/specs/2026-10-25-dsh-invite-ready-design.md`.

- [ ] Document invitation-first browser use, the advanced compatibility path, identity restoration, and keyboard controls.
- [ ] Run `node --test "tests/web/*.test.js" tests/server/http.test.js`.
- [ ] Run `npm.cmd test`, `node --check web/app.js`, and `git diff --check`.
- [ ] Manually smoke create → invite → redeem → ready → play → finish/review in two browser sessions.
- [ ] Commit with `docs: describe task-oriented browser flow`.
