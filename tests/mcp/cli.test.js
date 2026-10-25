import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

test("pre-bound MCP startup rejects a missing seat credential", () => {
  const env = { ...process.env };
  delete env.BALL_CHESS_PLAYER_TOKEN;
  const child = spawnSync(process.execPath, [
    path.resolve("mcp/index.js"),
    "--url", "http://127.0.0.1:7100",
    "--match", "m_test"
  ], {
    env,
    input: "",
    encoding: "utf8",
    timeout: 2000
  });

  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /BALL_CHESS_PLAYER_TOKEN is required with --match/);
});
