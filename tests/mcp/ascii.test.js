import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../../core/state.js";
import { toAscii } from "../../mcp/ascii.js";
import { TOOL_DEFINITIONS } from "../../mcp/tools.js";

test("ascii shows both seats and never contains credentials", () => {
  const text = toAscii(createGame());
  assert.ok(text.includes("L"));
  assert.ok(text.includes("R"));
  assert.ok(!text.includes("Token"));
});

test("tool surface stays at the approved four tools", () => {
  assert.deepEqual(TOOL_DEFINITIONS.map((tool) => tool.name), [
    "join_match", "get_match_state", "wait_for_turn", "submit_action"
  ]);
  const wait = TOOL_DEFINITIONS.find((tool) => tool.name === "wait_for_turn");
  assert.equal(wait.inputSchema.properties.timeoutSeconds.maximum, 15);
});
