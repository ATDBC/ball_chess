import { GameError } from "./errors.js";
import { cellEdgeKey } from "./coordinates.js";

export function wallAnchorError(wall) {
  if (!wall || typeof wall !== "object") return "INVALID_WALL";
  const { orientation, x, y } = wall;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return "INVALID_WALL";
  if (orientation === "h" && x >= 0 && x <= 7 && y >= 1 && y <= 12) return null;
  if (orientation === "v" && x >= 1 && x <= 8 && y >= 0 && y <= 11) return null;
  return "INVALID_WALL";
}

export function wallCellEdges(wall) {
  if (wallAnchorError(wall)) throw new GameError("ILLEGAL_ACTION", "Invalid wall", { reason: "INVALID_WALL" });
  if (wall.orientation === "h") {
    return [0, 1].map((i) => [[wall.x + i, wall.y - 1], [wall.x + i, wall.y]]);
  }
  return [0, 1].map((i) => [[wall.x - 1, wall.y + i], [wall.x, wall.y + i]]);
}

export function wallConflict(a, b) {
  if (a.orientation === b.orientation) {
    const bEdges = new Set(wallCellEdges(b).map(([p, q]) => cellEdgeKey(p, q)));
    if (wallCellEdges(a).some(([p, q]) => bEdges.has(cellEdgeKey(p, q)))) return "WALL_OVERLAP";
    return null;
  }
  const h = a.orientation === "h" ? a : b;
  const v = a.orientation === "v" ? a : b;
  return h.x < v.x && v.x < h.x + 2 && v.y < h.y && h.y < v.y + 2 ? "WALL_CROSS" : null;
}

export function buildBlockedEdges(walls) {
  const result = new Set();
  for (const wall of walls) {
    for (const [a, b] of wallCellEdges(wall)) result.add(cellEdgeKey(a, b));
  }
  return result;
}

export function listAllWallAnchors() {
  const walls = [];
  for (let x = 0; x <= 7; x += 1) for (let y = 1; y <= 12; y += 1) walls.push({ orientation: "h", x, y });
  for (let x = 1; x <= 8; x += 1) for (let y = 0; y <= 11; y += 1) walls.push({ orientation: "v", x, y });
  return walls;
}
