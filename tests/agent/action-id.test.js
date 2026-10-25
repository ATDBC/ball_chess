import test from "node:test";
import assert from "node:assert/strict";
import { formatActionId, parseActionId } from "../../agent/action-id.js";

test("action ids round-trip every move direction", () => {
  for (const direction of ["up", "down", "left", "right"]) {
    const action = { type: "move", direction };
    assert.deepEqual(parseActionId(formatActionId(action)), action);
  }
});

test("action ids round-trip horizontal and vertical walls", () => {
  for (const action of [
    { type: "place_wall", orientation: "h", x: 0, y: 12 },
    { type: "place_wall", orientation: "v", x: 8, y: 0 }
  ]) {
    assert.deepEqual(parseActionId(formatActionId(action)), action);
  }
  assert.equal(formatActionId({ type: "place_wall", orientation: "v", x: 3, y: 4 }), "wall:v:3:4");
});

test("action id parsing rejects non-canonical or malformed input", () => {
  for (const value of [
    null, "", "move:north", "move:up:extra", "wall:x:1:2", "wall:v:-1:2",
    "wall:v:03:4", "wall:v:3.0:4", "wall:v:3:4:5"
  ]) {
    assert.throws(() => parseActionId(value), (error) => error.code === "INVALID_ACTION_ID");
  }
});

test("action id formatting rejects unsupported structured actions", () => {
  assert.throws(
    () => formatActionId({ type: "place_wall", orientation: "v", x: -1, y: 2 }),
    (error) => error.code === "INVALID_ACTION_ID"
  );
  assert.throws(
    () => formatActionId({ type: "resign" }),
    (error) => error.code === "INVALID_ACTION_ID"
  );
});
