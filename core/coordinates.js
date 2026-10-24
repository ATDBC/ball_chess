import { WIDTH, HEIGHT } from "./constants.js";

export function inBounds(x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
}

export function cellIndex(position) {
  return position[1] * WIDTH + position[0];
}

export function cellEdgeKey(a, b) {
  const ai = cellIndex(a);
  const bi = cellIndex(b);
  return ai < bi ? `${ai}:${bi}` : `${bi}:${ai}`;
}
