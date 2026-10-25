# Ball Chess Phase 5 DSH Plugin and Preset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. Work on the current `master`; do not create a branch or worktree.

**Goal:** Let one DSH conversation join and play one Ball Chess seat from the instruction `加入邀请码 <code> 并开始`, with durable session-scoped credentials and no MCP subprocess or DSH core changes.

**Architecture:** A pure ESM Cordis plugin in `dsh/` registers raw DSH tool definitions through `ctx.tools` and uses `ctx.credentials` for a grant keyed by `ball-chess/s-<sha256(agent.id)>`. It directly reuses `BallChessAgentClient`. A local overlay declares a minimal `ball-chess` agent preset containing only its persona, compaction, and the Ball Chess plugin. The model sees neither invitation redemption credentials nor long-lived seat tokens.

**Tech Stack:** DSH Cordis plugin API, DSH credentials service, Node.js 22 ESM/crypto, YAML overlay, `node:test`

---

## Task 1: Session credential state machine

**Files:** Create `dsh/grant-store.js` and `tests/dsh/grant-store.test.js`.

- [ ] Write failing tests for the SHA-256 session key, strict `redeeming`/`bound` grant decoding, serialized record modification, successful replacement of redeeming with bound, deletion on finished match, and preservation on cancellation/archive.
- [ ] Assert different agent IDs, seeded forks, and subagent sessions never read the parent binding. A child without its own grant reports `BINDING_NOT_INHERITED` instead of searching parent credentials.
- [ ] Run `node --test tests/dsh/grant-store.test.js` and confirm the module is missing.
- [ ] Implement grant storage using `ctx.credentials.modifyRecord`, `readRecord`, and `deleteRecord`. The `kind: grant` payload is exactly one of `{ version: 1, state: "redeeming", baseUrl, inviteCode, redemptionId }` or `{ version: 1, state: "bound", baseUrl, matchId, seat, playerToken }`.
- [ ] Save `redeeming` before network redemption and reuse its redemption ID after an unknown outcome. Replace it atomically with `bound` and remove the invitation code after success.
- [ ] Run the focused tests and expect PASS.
- [ ] Commit with `feat: persist dsh ball chess bindings`.

## Task 2: Cordis tool plugin

**Files:** Create `dsh/plugin.js` and `tests/dsh/plugin.test.js`.

- [ ] Build a fake Cordis context and add failing tests for plugin load validation, registration disposal, raw DSH output schemas, session identity lookup from `exec.agent.id`, invite join/ready, state, wait, action, cancellation, resume, and final credential deletion.
- [ ] Assert all definitions and rendered content exclude `playerToken`, invitation code after redemption, bearer headers, and credential records.
- [ ] Run `node --test tests/dsh/plugin.test.js` and confirm failures.
- [ ] Export a Cordis `apply(ctx, config)` plugin that validates a configurable loopback HTTP `baseUrl` at load, registers the five Ball Chess tools, and creates clients per DSH agent binding.
- [ ] Use `exec.signal` for waits. Do not keep process-global seat state; any client cache is keyed by the current agent ID and disposed through `ctx.effect`.
- [ ] On a finished state delete the bound grant. On cancellation close the active wait and retain the grant. After DSH restart, reconstruct the client from the bound grant only when a later user turn invokes a Ball Chess tool.
- [ ] Run focused tests and expect PASS.
- [ ] Commit with `feat: add dsh ball chess tools`.

## Task 3: Minimal DSH agent preset

**Files:** Create `dsh/ball-chess.overlay.yml`, `dsh/README.md`, and `tests/dsh/overlay.test.js`.

- [ ] Add failing source/parse tests that the overlay inserts one `@deepseek-ai/dsh-agent-preset` with `config.id: ball-chess`, a complete persona, compaction, and the local plugin; reject shell, filesystem, browser, web, subagent, workflow, and plugin-management tools.
- [ ] Run `node --test tests/dsh/overlay.test.js` and confirm the overlay is absent.
- [ ] Add the preset overlay with the local plugin path and the exact Windows launch example `pnpm dsh web --patch E:\\My_project\\ball_chess\\dsh\\ball-chess.overlay.yml`.
- [ ] Keep the persona concise: join by invitation when asked, ready after joining, wait when not actionable, submit only listed legal actions, recover from stale state, and stop after finish.
- [ ] Document setup, selection, restart/resume, fork isolation, cancellation, and credential deletion behavior.
- [ ] Run the overlay test and expect PASS.
- [ ] Commit with `feat: add ball chess dsh preset`.

## Task 4: DSH integration and secrecy acceptance

**Files:** Create `tests/e2e/dsh-plugin.test.js`; modify `README.md` and the approved design spec.

- [ ] Add an integration harness with two distinct fake DSH agent sessions using the real HTTP server and credentials implementation. Prove independent invitation redemption, both-ready start, alternating wait/action, cancellation cleanup, cold client reconstruction, fork isolation, and final credential deletion.
- [ ] Capture model-visible tool content and ordinary logs; assert no player token, bearer header, persisted grant payload, or consumed invitation appears.
- [ ] Run `node --test "tests/dsh/*.test.js" tests/e2e/dsh-plugin.test.js`.
- [ ] Validate the overlay against the local DSH source launcher. If a live model key is unavailable, verify profile boot/tool registration without sending a model request and record that limit explicitly.
- [ ] Run `npm.cmd test`, syntax checks for every new ESM entry, and `git diff --check`.
- [ ] Update the approved design status and README with the final supported workflow.
- [ ] Commit with `docs: describe dsh ball chess preset`.
