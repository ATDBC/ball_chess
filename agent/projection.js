import { HEIGHT, WIDTH } from "../core/constants.js";
import { cellEdgeKey } from "../core/coordinates.js";
import { describeMatchRules, describeWallBudgets } from "../core/rule-description.js";
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
  delete projected.adminToken;
  delete projected.playerToken;
  delete projected.playerTokens;
  projected.ascii = toAscii(state);
  projected.rules = describeMatchRules(state.config);
  projected.wallBudgets = describeWallBudgets(state);
  if (Array.isArray(state.legalActions)) {
    projected.legalActionList = structuredClone(state.legalActions);
    const legalActions = { moves: [], walls: { h: [], v: [] } };
    for (const action of state.legalActions) {
      if (action.type === "move") legalActions.moves.push(action.direction);
      if (action.type === "place_wall") legalActions.walls[action.orientation].push([action.x, action.y]);
    }
    legalActions.wallRanges = compressWallCoordinates(legalActions.walls);
    projected.legalActions = legalActions;
  }
  return projected;
}

function compressOrientation(coordinates) {
  const ordered = [...coordinates].sort(([xA, yA], [xB, yB]) => yA - yB || xA - xB);
  const ranges = [];
  for (const [x, y] of ordered) {
    const current = ranges.at(-1);
    if (current && current.y === y && current.toX + 1 === x) current.toX = x;
    else ranges.push({ y, fromX: x, toX: x });
  }
  return ranges;
}

function compressWallCoordinates(walls) {
  return { h: compressOrientation(walls.h), v: compressOrientation(walls.v) };
}

export function expandWallRanges(ranges) {
  const expand = (orientation) => orientation.flatMap(({ y, fromX, toX }) => (
    Array.from({ length: toX - fromX + 1 }, (_, offset) => [fromX + offset, y])
  ));
  return { h: expand(ranges.h), v: expand(ranges.v) };
}

function rangeText(ranges) {
  if (!ranges.length) return "-";
  const rows = new Map();
  for (const { y, fromX, toX } of ranges) {
    const values = rows.get(y) || [];
    values.push(`x${fromX}${toX === fromX ? "" : `-${toX}`}`);
    rows.set(y, values);
  }
  return [...rows].map(([y, values]) => `y${y}:${values.join(",")}`).join(";");
}

function legalText(summary) {
  if (!summary) return "";
  return `moves=${summary.moves.join(",") || "-"} walls.h=${rangeText(summary.wallRanges.h)} walls.v=${rangeText(summary.wallRanges.v)}`;
}

function rulesText(rules) {
  if (!rules) return "";
  const timeout = rules.turnTimeoutMs === null ? "none" : rules.turnTimeoutMs;
  return `rules=board ${rules.board.width}x${rules.board.height} origin=${rules.board.origin} ` +
    `goals=left:y${rules.goals.left},right:y${rules.goals.right} first=${rules.firstPlayer} ` +
    `maxPlies=${rules.maxPlies} timeout=${timeout}; move=one orthogonal cell, no jump/pass; ` +
    "wall=two edges, no overlap/cross, both players keep a path";
}

function wallText(budgets) {
  if (!budgets) return "";
  if (budgets.mode === "unlimited") {
    return `walls=unlimited left used=${budgets.left.used} right used=${budgets.right.used}`;
  }
  return `walls=finite limit=${budgets.limit} left used=${budgets.left.used} remaining=${budgets.left.remaining} ` +
    `right used=${budgets.right.used} remaining=${budgets.right.remaining}`;
}

function seatsText(seats) {
  if (!seats) return "";
  return `seats=left:${seats.left.phase},right:${seats.right.phase}`;
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
  const rules = rulesText(state.rules);
  if (rules) lines.push(rules);
  const walls = wallText(state.wallBudgets);
  if (walls) lines.push(walls);
  lines.push(`current=${state.currentPlayer || "none"} yourTurn=${Boolean(state.yourTurn)} deadline=${state.turnDeadlineAt ?? "none"}`);
  const seats = seatsText(state.seats);
  if (seats) lines.push(seats);
  if (state.lastAction) lines.push(`lastAction=${JSON.stringify(state.lastAction)}`);
  if (state.ascii) lines.push(state.ascii);
  const legal = legalText(state.legalActions);
  if (legal) lines.push(legal);
  if (state.result) {
    lines.push(`outcome=${state.result.kind} winner=${state.result.winner ?? "none"} reason=${state.result.reason}`);
    lines.push("The match is finished; do not submit more actions.");
  }
  if (result.ok === false) lines.push(`ERROR ${result.error.code}: ${result.error.message}; refresh state and retry a listed action.`);
  return lines.join("\n");
}
