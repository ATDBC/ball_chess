import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../../core/state.js";
import { toAscii } from "../../mcp/ascii.js";
import { TOOL_DEFINITIONS } from "../../mcp/tools.js";

const DSH_SCHEMA_KEYS = new Set([
  "type", "oneOf", "properties", "required", "additionalProperties", "items",
  "enum", "const", "description", "title", "default", "examples"
]);

function assertDshSchemaSubset(schema, path = "schema") {
  for (const key of Object.keys(schema)) assert.ok(DSH_SCHEMA_KEYS.has(key), `${path}.${key} is unsupported by DSH`);
  if (Object.hasOwn(schema, "enum") || Object.hasOwn(schema, "const")) {
    assert.ok(["string", "number", "integer", "boolean", "null"].includes(schema.type), `${path} literal needs a scalar type`);
  }
  for (const [name, child] of Object.entries(schema.properties || {})) {
    assertDshSchemaSubset(child, `${path}.properties.${name}`);
  }
  for (const [index, child] of (schema.oneOf || []).entries()) {
    assertDshSchemaSubset(child, `${path}.oneOf[${index}]`);
  }
  if (schema.items) assertDshSchemaSubset(schema.items, `${path}.items`);
}

test("ascii shows both seats and never contains credentials", () => {
  const text = toAscii(createGame());
  assert.ok(text.includes("L"));
  assert.ok(text.includes("R"));
  assert.ok(!text.includes("Token"));
});

test("tool surface joins by invitation without model-visible seat credentials", () => {
  assert.deepEqual(TOOL_DEFINITIONS.map((tool) => tool.name), [
    "join_by_invite", "set_ready", "get_match_state", "wait_for_turn", "submit_action"
  ]);
  const join = TOOL_DEFINITIONS.find((tool) => tool.name === "join_by_invite");
  assert.deepEqual(join.inputSchema.required, ["code"]);
  assert.equal(JSON.stringify(join.inputSchema).includes("playerToken"), false);
  const ready = TOOL_DEFINITIONS.find((tool) => tool.name === "set_ready");
  assert.deepEqual(ready.inputSchema.required, ["ready"]);
  assert.equal(ready.inputSchema.properties.ready.type, "boolean");
  const wait = TOOL_DEFINITIONS.find((tool) => tool.name === "wait_for_turn");
  assert.deepEqual(wait.inputSchema.properties, {});
});

test("submit_action schema discriminates moves from wall placements", () => {
  const submit = TOOL_DEFINITIONS.find((tool) => tool.name === "submit_action");
  const variants = submit.inputSchema.properties.action.oneOf;
  assert.deepEqual(variants.map((variant) => ({
    type: variant.properties.type.const,
    orientation: variant.properties.orientation?.const,
    required: variant.required,
    x: variant.properties.x?.enum,
    y: variant.properties.y?.enum
  })), [
    { type: "move", orientation: undefined, required: ["type", "direction"], x: undefined, y: undefined },
    {
      type: "place_wall", orientation: "h", required: ["type", "orientation", "x", "y"],
      x: [0, 1, 2, 3, 4, 5, 6, 7],
      y: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    },
    {
      type: "place_wall", orientation: "v", required: ["type", "orientation", "x", "y"],
      x: [1, 2, 3, 4, 5, 6, 7, 8],
      y: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    }
  ]);
});

test("all advertised tool schemas stay inside the DSH-supported subset", () => {
  for (const tool of TOOL_DEFINITIONS) assertDshSchemaSubset(tool.inputSchema, tool.name);
});
