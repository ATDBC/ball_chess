import test from "node:test";
import assert from "node:assert/strict";
import { wallAnchorError, wallCellEdges, wallConflict, buildBlockedEdges, listAllWallAnchors } from "../../core/walls.js";

test("wall anchors cover exactly two cell edges", () => {
  assert.deepEqual(wallCellEdges({ orientation: "h", x: 1, y: 5 }), [
    [[1, 4], [1, 5]], [[2, 4], [2, 5]]
  ]);
  assert.deepEqual(wallCellEdges({ orientation: "v", x: 4, y: 2 }), [
    [[3, 2], [4, 2]], [[3, 3], [4, 3]]
  ]);
  assert.equal(listAllWallAnchors().length, 192);
});

test("connected, overlapping, crossing and T walls are distinguished", () => {
  const h1 = { orientation: "h", x: 1, y: 5 };
  const h2 = { orientation: "h", x: 3, y: 5 };
  const overlap = { orientation: "h", x: 2, y: 5 };
  const cross = { orientation: "v", x: 2, y: 4 };
  const touch = { orientation: "v", x: 1, y: 4 };
  assert.equal(wallConflict(h1, h2), null);
  assert.equal(wallConflict(h1, overlap), "WALL_OVERLAP");
  assert.equal(wallConflict(h1, cross), "WALL_CROSS");
  assert.equal(wallConflict(h1, touch), null);
  assert.equal(wallAnchorError({ orientation: "h", x: 8, y: 5 }), "INVALID_WALL");
});

test("blocked edges are symmetric", () => {
  const edges = buildBlockedEdges([{ orientation: "h", x: 2, y: 1 }]);
  assert.equal(edges.size, 2);
});
