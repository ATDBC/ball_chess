import { HEIGHT, WIDTH } from "../core/constants.js";
import { cellEdgeKey } from "../core/coordinates.js";
import { buildBlockedEdges } from "../core/walls.js";

export function toAscii(state) {
  const blocked = buildBlockedEdges(state.walls);
  const pawnAt = (x, y) => {
    if (state.players.left.position[0] === x && state.players.left.position[1] === y) return "L";
    if (state.players.right.position[0] === x && state.players.right.position[1] === y) return "R";
    return ".";
  };
  const lines = [];
  for (let y = HEIGHT - 1; y >= 0; y -= 1) {
    let cells = "";
    let horizontal = "";
    for (let x = 0; x < WIDTH; x += 1) {
      cells += pawnAt(x, y);
      if (y > 0) horizontal += blocked.has(cellEdgeKey([x, y - 1], [x, y])) ? "-" : " ";
      if (x < WIDTH - 1) {
        cells += blocked.has(cellEdgeKey([x, y], [x + 1, y])) ? "|" : " ";
        if (y > 0) horizontal += " ";
      }
    }
    lines.push(cells);
    if (y > 0) lines.push(horizontal);
  }
  return lines.join("\n");
}

export function projectState(state) {
  const projected = structuredClone(state);
  projected.ascii = toAscii(state);
  if (Array.isArray(state.legalActions)) {
    const legalActions = { moves: [], walls: { h: [], v: [] } };
    for (const action of state.legalActions) {
      if (action.type === "move") legalActions.moves.push(action.direction);
      if (action.type === "place_wall") legalActions.walls[action.orientation].push([action.x, action.y]);
    }
    projected.legalActions = legalActions;
  }
  return projected;
}

function legalText(legalActions) {
  if (!legalActions) return "";
  const horizontal = legalActions.walls.h.map(([x, y]) => `${x},${y}`).join(";");
  const vertical = legalActions.walls.v.map(([x, y]) => `${x},${y}`).join(";");
  return `moves=${legalActions.moves.join(",") || "-"} walls.h=${horizontal || "-"} walls.v=${vertical || "-"}`;
}

export function renderAgentResult(result) {
  const state = result.state;
  if (result.kind === "canceled") return "CANCELED: waiting stopped; the seat remains bound.";
  if (!state) return result.ok === false ? `ERROR ${result.error.code}: ${result.error.message}` : String(result.kind || "OK").toUpperCase();
  const header = result.kind === "turn"
    ? `TURN ${state.matchId} v${state.version} ${state.yourPlayer}`
    : result.kind === "finished"
      ? `FINISHED ${state.matchId} v${state.version}`
      : `${state.status.toUpperCase()} ${state.matchId} v${state.version} ${state.yourPlayer || "spectator"}`;
  const lines = [header];
  if (state.ascii) lines.push(state.ascii);
  const legal = legalText(state.legalActions);
  if (legal) lines.push(legal);
  if (result.ok === false) lines.push(`ERROR ${result.error.code}: ${result.error.message}; refresh state and retry a listed action.`);
  return lines.join("\n");
}

