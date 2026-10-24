export const CELL_SIZE = 24;
export const GRID_X = 52;
export const GRID_Y = 66;
export const BALL_RADIUS = 7.5;
export const WALL_THICKNESS = 4.5;
export const WALL_SIDE = 1.5;

export function cellCenter([x, y]) {
  return { x: GRID_X + x * CELL_SIZE + CELL_SIZE / 2, y: GRID_Y + (12 - y) * CELL_SIZE + CELL_SIZE / 2 };
}

export function wallFaces(wall) {
  if (wall.orientation === "h") {
    const x = GRID_X + wall.x * CELL_SIZE;
    const gridY = GRID_Y + (13 - wall.y) * CELL_SIZE;
    return {
      top: { x, y: gridY - WALL_THICKNESS / 2 - WALL_SIDE / 6, width: CELL_SIZE * 2, height: WALL_THICKNESS, rx: WALL_THICKNESS / 2 },
      side: { x, y: gridY - WALL_SIDE / 1.5, width: CELL_SIZE * 2, height: WALL_THICKNESS, rx: WALL_THICKNESS / 2 }
    };
  }
  const gridX = GRID_X + wall.x * CELL_SIZE;
  const y = GRID_Y + (11 - wall.y) * CELL_SIZE;
  return {
    top: { x: gridX - WALL_THICKNESS / 2 - WALL_SIDE / 6, y, width: WALL_THICKNESS, height: CELL_SIZE * 2, rx: WALL_THICKNESS / 2 },
    side: { x: gridX - WALL_SIDE / 1.5, y, width: WALL_THICKNESS, height: CELL_SIZE * 2, rx: WALL_THICKNESS / 2 }
  };
}
