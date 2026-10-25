import { HEIGHT, WIDTH } from "../core/constants.js";
import { cellEdgeKey } from "../core/coordinates.js";
import { destinationFor } from "../core/movement.js";
import { describeMatchRules, describeWallBudgets } from "../core/rule-description.js";
import { otherPlayer } from "../core/state.js";
import { buildBlockedEdges } from "../core/walls.js";
import { formatActionId } from "./action-id.js";

const COORDINATES = Object.freeze({
  origin: [0, 0],
  xIncreases: "right",
  yIncreases: "up toward the goal row",
  cellBounds: { x: [0, WIDTH - 1], y: [0, HEIGHT - 1] },
  walls: {
    h: "wall:h:x:y blocks (x,y-1)<->(x,y) and (x+1,y-1)<->(x+1,y)",
    v: "wall:v:x:y blocks (x-1,y)<->(x,y) and (x-1,y+1)<->(x,y+1)"
  }
});

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
    lines.push(`${String(y).padStart(2)} ${cells}`);
    if (y > 0) lines.push(`   ${horizontal}`);
  }
  lines.push(`   ${Array.from({ length: WIDTH }, (_, x) => x).join(" ")}`);
  return lines.join("\n");
}

function actorView(state, seat, budgets) {
  const player = state.players[seat];
  return {
    seat,
    color: player.color,
    position: [...player.position],
    goal: { axis: "y", value: HEIGHT - 1 },
    walls: structuredClone(budgets[seat])
  };
}

function projectDecision(state, legalActionList, wallBudgets) {
  if (!state.yourPlayer) return null;
  const opponent = otherPlayer(state.yourPlayer);
  const moves = legalActionList.filter((action) => action.type === "move").map((action) => ({
    id: formatActionId(action),
    action: structuredClone(action),
    to: destinationFor(state.players[state.yourPlayer].position, action.direction)
  }));
  const wallCoordinates = { h: [], v: [] };
  for (const action of legalActionList) {
    if (action.type === "place_wall") wallCoordinates[action.orientation].push([action.x, action.y]);
  }
  const wallRanges = compressWallCoordinates(wallCoordinates);
  return {
    actor: {
      currentPlayer: state.currentPlayer,
      yourTurn: Boolean(state.yourTurn),
      you: actorView(state, state.yourPlayer, wallBudgets),
      opponent: actorView(state, opponent, wallBudgets)
    },
    coordinates: structuredClone(COORDINATES),
    legal: {
      moves,
      walls: {
        h: { count: wallCoordinates.h.length, idFormat: "wall:h:<x>:<y>", ranges: wallRanges.h },
        v: { count: wallCoordinates.v.length, idFormat: "wall:v:<x>:<y>", ranges: wallRanges.v }
      }
    }
  };
}

export function projectState(state) {
  const projected = structuredClone(state);
  delete projected.adminToken;
  delete projected.playerToken;
  delete projected.playerTokens;
  projected.ascii = toAscii(state);
  projected.rules = describeMatchRules(state.config);
  projected.wallBudgets = describeWallBudgets(state);
  const legalActionList = Array.isArray(state.legalActions) ? state.legalActions : (state.legalActionList || []);
  projected.decision = projectDecision(state, legalActionList, projected.wallBudgets);
  if (Array.isArray(state.legalActions)) {
    projected.legalActionList = structuredClone(legalActionList);
    const legalActions = { moves: [], walls: { h: [], v: [] } };
    for (const action of legalActionList) {
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

function actorText(decision) {
  if (!decision) return "";
  const render = (actor) => {
    const remaining = Object.hasOwn(actor.walls, "remaining") ? ` remaining=${actor.walls.remaining}` : "";
    return `${actor.seat}/${actor.color} at=(${actor.position.join(",")}) goal=y${actor.goal.value} wallsUsed=${actor.walls.used}${remaining}`;
  };
  return `you=${render(decision.actor.you)} opponent=${render(decision.actor.opponent)}`;
}

function coordinatesText(decision) {
  if (!decision) return [];
  return [
    "coordinates=origin(0,0) x->right y->goal/top",
    `${decision.coordinates.walls.h}; ${decision.coordinates.walls.v}`
  ];
}

function decisionLegalText(decision) {
  if (!decision) return "";
  const moves = decision.legal.moves.map(({ id, to }) => `${id}->(${to.join(",")})`).join(",") || "-";
  return `actionIds moves=${moves} wallFormats=${decision.legal.walls.h.idFormat}|${decision.legal.walls.v.idFormat}`;
}

function rulesText(rules) {
  if (!rules) return "";
  const timeout = rules.turnTimeoutMs === null ? "none" : rules.turnTimeoutMs;
  return `rules=${rules.board.width}x${rules.board.height} origin=${rules.board.origin} ` +
    `starts=L(${rules.starts.left.join(",")}),R(${rules.starts.right.join(",")}) goals=L:y${rules.goals.left},R:y${rules.goals.right}; ` +
    `turn=${rules.turn.actions} of ${rules.turn.choices.join("|")},pass=${rules.turn.passAllowed}; ` +
    `move=${rules.movement.distance} orthogonal (${rules.movement.directions.join("|")}),` +
    `diagonal=${rules.movement.diagonalAllowed},jump=${rules.movement.jumpAllowed},occupied=${rules.movement.occupiedCellAllowed}; ` +
    `wall=${rules.wallPlacement.edges} edges,overlap=${rules.wallPlacement.overlapAllowed},cross=${rules.wallPlacement.crossingAllowed},` +
    `endpoint=${rules.wallPlacement.endpointConnectionAllowed},T=${rules.wallPlacement.tJunctionAllowed},` +
    `paths=${rules.wallPlacement.preservePathFor.join("|")}; first=${rules.firstPlayer} ` +
    `maxPlies=${rules.maxPlies}=>${rules.outcome.maxPliesResult} timeout=${timeout}`;
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
  const actor = actorText(state.decision);
  if (actor) lines.push(actor);
  lines.push(...coordinatesText(state.decision));
  lines.push(`current=${state.currentPlayer || "none"} yourTurn=${Boolean(state.yourTurn)} deadline=${state.turnDeadlineAt ?? "none"}`);
  const seats = seatsText(state.seats);
  if (seats) lines.push(seats);
  if (state.lastAction) lines.push(`lastAction=${JSON.stringify(state.lastAction)}`);
  if (state.ascii) lines.push(state.ascii);
  const legal = legalText(state.legalActions);
  if (legal) lines.push(legal);
  const decisionLegal = decisionLegalText(state.decision);
  if (decisionLegal) lines.push(decisionLegal);
  if (state.result) {
    lines.push(`outcome=${state.result.kind} winner=${state.result.winner ?? "none"} reason=${state.result.reason}`);
    lines.push("The match is finished; do not submit more actions.");
  }
  if (result.ok === false) lines.push(`ERROR ${result.error.code}: ${result.error.message}; refresh state and retry a listed action.`);
  return lines.join("\n");
}
