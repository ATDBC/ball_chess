import { HEIGHT, WIDTH } from "./constants.js";
import { cellEdgeKey } from "./coordinates.js";
import { buildBlockedEdges } from "./walls.js";

export function hasPathToGoal(game, position) {
  const blocked = buildBlockedEdges(game.walls);
  const queue = [position];
  const seen = new Set([`${position[0]},${position[1]}`]);
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current[1] === HEIGHT - 1) return true;
    for (const [dx, dy] of [[0, 1], [0, -1], [-1, 0], [1, 0]]) {
      const next = [current[0] + dx, current[1] + dy];
      if (next[0] < 0 || next[0] >= WIDTH || next[1] < 0 || next[1] >= HEIGHT) continue;
      const key = `${next[0]},${next[1]}`;
      if (seen.has(key) || blocked.has(cellEdgeKey(current, next))) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return false;
}

export function pathsRemainAfterWall(game, wall) {
  const candidate = { ...game, walls: [...game.walls, wall] };
  return hasPathToGoal(candidate, game.players.left.position) && hasPathToGoal(candidate, game.players.right.position);
}
