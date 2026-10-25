# DSH Ball Chess preset

This directory contains the Ball Chess Cordis tool plugin and the local DSH preset overlay. The plugin directly reuses the shared client in `../agent/`; it does not launch an MCP subprocess and does not modify DeepSeek Harness.

## Start

Start the Ball Chess server first:

```powershell
cd E:\My_project\ball_chess
npm.cmd run dev -- --host 127.0.0.1 --port 7100
```

Then start DSH from its source checkout with the overlay:

```powershell
cd E:\Program\deepseek-harness
$env:BALL_CHESS_URL = 'http://127.0.0.1:7100'
pnpm.cmd dsh web --patch E:\My_project\ball_chess\dsh\ball-chess.overlay.yml
```

Create a conversation with the **Ball Chess player** preset and send:

```text
加入邀请码 01234-56789-ABCDE-FGHJK-MNPQRS 并开始
```

`join_by_invite` claims the seat and sends ready through the same HTTP transition used by the browser button. The preset then waits over SSE and submits only actions listed by the server.

## Session and credential behavior

- A binding belongs to the current DSH Agent ID. Another conversation has another credential key and can control the other seat.
- The credential record is `ball-chess/s-<sha256(agentId)>`. It stores a pending redemption before the HTTP request and replaces it with the bound seat after success.
- An interrupted redemption reuses its stored redemption ID. A normal bound resume reconstructs the client when the user asks the conversation to continue.
- Forks and subagents do not inherit the parent seat. Canceling or archiving a wait closes the SSE request but retains the binding.
- Observing a finished match deletes the bound player token. The token is never a tool argument, tool result, model-facing string, public match state, or ordinary plugin log field.

The local credentials file protects the normal product data flow; it is not an operating-system isolation mechanism against another process running as the same user with arbitrary file access.
