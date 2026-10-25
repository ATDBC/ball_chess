import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentPrompt, buildInvitePrompt, buildMcpConfig } from "../../web/agent-instructions.js";

test("agent setup contains only the requested seat credential", () => {
  const prompt = buildAgentPrompt({ matchId: "m_test", seat: "left" });
  assert.ok(prompt.includes("set_ready"));
  assert.ok(prompt.indexOf("set_ready") < prompt.indexOf("wait_for_turn"));
  assert.ok(prompt.includes("wait_for_turn"));
  assert.ok(prompt.includes("left"));
  assert.ok(!prompt.includes("left_secret"));
  assert.ok(!prompt.includes("join_match"));
  assert.ok(!prompt.includes("adminToken"));
  const config = buildMcpConfig(
    { command: "node", args: ["mcp/index.js", "--url", "http://127.0.0.1:7100"] },
    { matchId: "m_test", playerToken: "left_secret" }
  );
  assert.equal(config.mcpServers["ball-chess"].command, "node");
  assert.deepEqual(config.mcpServers["ball-chess"].args, [
    "mcp/index.js", "--url", "http://127.0.0.1:7100", "--match", "m_test"
  ]);
  assert.deepEqual(config.mcpServers["ball-chess"].env, {
    BALL_CHESS_PLAYER_TOKEN: "left_secret"
  });
});

test("invitation prompt is the default agent handoff and contains no long-lived token", () => {
  const prompt = buildInvitePrompt({ code: "01234-56789-ABCDE-FGHJK-MNPQRS" });
  assert.equal(prompt, "加入邀请码 01234-56789-ABCDE-FGHJK-MNPQRS 并开始");
  assert.ok(!prompt.includes("playerToken"));
});
