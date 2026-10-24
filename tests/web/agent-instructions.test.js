import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentPrompt, buildMcpConfig } from "../../web/agent-instructions.js";

test("agent setup contains only the requested seat credential", () => {
  const prompt = buildAgentPrompt({ matchId: "m_test", token: "left_secret", seat: "left" });
  assert.ok(prompt.includes("wait_for_turn"));
  assert.ok(prompt.includes("left_secret"));
  assert.ok(!prompt.includes("adminToken"));
  const config = buildMcpConfig({ command: "node", args: ["mcp/index.js", "--url", "http://127.0.0.1:7100"] });
  assert.equal(config.mcpServers["ball-chess"].command, "node");
});
