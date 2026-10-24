import test from "node:test";
import assert from "node:assert/strict";
import { CELL_SIZE, cellCenter, wallFaces } from "../../web/board-geometry.js";

test("board coordinates put starts and goal in the right cells", () => {
  assert.equal(CELL_SIZE, 24);
  assert.deepEqual(cellCenter([2, 0]), { x: 112, y: 366 });
  assert.deepEqual(cellCenter([8, 12]), { x: 256, y: 78 });
});

test("smaller pieces keep a visible gap beside walls", () => {
  const wall = { orientation: "h", x: 5, y: 8 };
  const { top, side } = wallFaces(wall);
  assert.deepEqual({ width: top.width, height: top.height }, { width: 48, height: 4.5 });
  const ballCenter = cellCenter([5, 7]);
  const ballTop = ballCenter.y - 7.5;
  const wallBottom = Math.max(top.y + top.height, side.y + side.height);
  assert.equal(ballTop - wallBottom, 1);
});

test("vertical walls preserve length and reduce thickness", () => {
  const { top } = wallFaces({ orientation: "v", x: 4, y: 2 });
  assert.equal(top.width, 4.5);
  assert.equal(top.height, 48);
});
