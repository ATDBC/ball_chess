# DSH Ball Chess preset

This directory contains the Ball Chess Cordis tool plugin, game-specific compaction service, and preset bundle layer. The tools directly reuse the shared client in `../agent/`; they do not launch an MCP subprocess or modify DeepSeek Harness.

## Start

Start the Ball Chess server first:

```powershell
cd E:\My_project\ball_chess
npm.cmd run dev -- --host 127.0.0.1 --port 7100
```

Install this checkout as a local bundle in the Web profile, then start DSH:

```powershell
$env:BALL_CHESS_URL = 'http://127.0.0.1:7100'
pnpm.cmd --dir E:\Program\deepseek-harness dsh plugin --profile web add E:\My_project\ball_chess
pnpm.cmd --dir E:\Program\deepseek-harness dsh web
```

The profile stores a link to the checkout. Preset child rows use the exported package subpaths `ball-chess/dsh/plugin` and `ball-chess/dsh/compaction-plugin`; nested preset rows are not resolved relative to the bundle patch file. Moving the project only requires reinstalling the link, and the YAML contains no machine-specific absolute module URL. Remove it with `pnpm.cmd --dir E:\Program\deepseek-harness dsh plugin --profile web remove ball-chess`.

Create a conversation with the **Ball Chess player** preset and send:

```text
加入邀请码 01234-56789-ABCDE-FGHJK-MNPQRS 并开始
```

`join_by_invite` claims the seat and sends ready through the same HTTP transition used by the browser button. The preset then waits over SSE, copies an `actionId` from the current `decision.legal` projection, and submits that ID with the observed version. `get_match_record` reads the complete public action history only when requested.

## Session and credential behavior

- A binding belongs to the current DSH Agent ID. Another conversation has another credential key and can control the other seat.
- The credential record is `ball-chess/s-<sha256(agentId)>`. It stores a pending redemption before the HTTP request and replaces it with the bound seat after success. A definitive server rejection replaces that pending record with an unbound marker so another invitation can be used; transport and server failures with an unknown outcome retain it for an idempotent retry.
- An interrupted redemption reuses its stored redemption ID. A normal bound resume reconstructs the client when the user asks the conversation to continue.
- Forks and subagents do not inherit the parent seat. Canceling or archiving a wait closes the SSE request but retains the binding.
- Observing a finished match atomically replaces the bound player token with a non-secret terminal receipt. A restart before the model reports the result can replay that receipt without network access. The token is never a tool argument, tool result, model-facing string, public match state, or ordinary plugin log field.

The local credentials file protects the normal product data flow; it is not an operating-system isolation mechanism against another process running as the same user with arbitrary file access.

## Rules and compaction

The first successful game tool result supplies the complete movement, goal, wall-placement, and outcome rules from the shared rule descriptor; the persona does not carry a second fixed rule copy. Match-dependent values—including finite or unlimited walls, used and remaining walls, first player, maximum plies, and timeout—come from the current server state. MCP, DSH, and the browser consume the same configuration-derived rule facts.

Structured Agent state retains the complete action array as `legalActionList`, preserves the grouped `legalActions`, and adds a `decision` projection. That projection names `you` and `opponent` without rotating absolute coordinates, gives every legal move its destination and canonical ID, and defines the exact edges blocked by `wall:h:x:y` and `wall:v:x:y`. `submit_action` accepts only a copied canonical ID plus the observed version. This presentation does not expose shortest paths, evaluations, win probabilities, search trees, or recommended moves.

`compaction-plugin.js` extends DSH's `BasicCompactionEngine`. It keeps the base engine's automatic pressure checks, `/compact`, model-switch protection, overflow recovery, durable replacement, and retry behavior; only the summary instruction changes. The checkpoint records match identity, actual rules/configuration, the last observed authoritative state, user instructions, the next tool, and the outcome. It never treats a summarized version as current authority and directs the Agent to refresh when uncertain. A checkpoint is accepted only after a normal text-only stop with exactly the six required sections and no authentication field or redeemed invitation code.

The preset configures:

```yaml
auto: true
thresholdRatio: 0.8
headroomTokens: 65536
retainTokens: 8192
maxTokens: 4096
compactionRetries: 1
maxOverflowRetries: 1
```

The checkpoint may preserve an already selected `actionId`, but it never invents or recommends one. It refers to `get_match_record` only when the full history is required instead of copying the growing record into every checkpoint.

The 4,096-token cap applies only to the auxiliary summary request. It does not change the gameplay model's normal maximum output. The normal request's configured output reservation still participates in the base engine's pressure calculation.
