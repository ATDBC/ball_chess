import { describeMatchRules, describeWallBudgets } from "../core/rule-description.js";

export function shouldAcceptSnapshot(current, incoming) {
  return !current || incoming.version >= current.version;
}

export function canInteract(state) {
  return Boolean(state && state.status === "playing" && state.yourTurn && !state.result);
}

export function nextReadyValue(state) {
  if (!state || state.status !== "waiting" || !state.yourPlayer) return null;
  const phase = state.seats[state.yourPlayer]?.phase;
  if (phase === "claimed") return true;
  if (phase === "ready") return false;
  return null;
}

export function seatPhaseText(phase) {
  if (phase === "ready") return "已准备";
  if (phase === "claimed") return "已加入";
  return "等待加入";
}

export function wallsRemaining(state, seat) {
  if (state.config.wallLimit === null) return "∞";
  return String(Math.max(0, state.config.wallLimit - state.players[seat].wallsUsed));
}

export function rulePanelLines(state) {
  const rules = describeMatchRules(state.config);
  const walls = describeWallBudgets(state);
  const first = rules.firstPlayer === "left" ? "左方" : "右方";
  const timing = rules.turnTimeoutMs === null ? "不限时" : `每回合 ${rules.turnTimeoutMs / 1000} 秒`;
  const wallLine = walls.mode === "unlimited"
    ? `墙：无限；左方已用 ${walls.left.used}，右方已用 ${walls.right.used}`
    : `墙：每方 ${walls.limit} 堵；左方剩余 ${walls.left.remaining}，右方剩余 ${walls.right.remaining}`;
  const movement = rules.movement;
  const wallPlacement = rules.wallPlacement;
  const forbiddenMoves = [
    movement.diagonalAllowed ? null : "斜走",
    movement.jumpAllowed ? null : "跳跃",
    movement.occupiedCellAllowed ? null : "进入对方格"
  ].filter(Boolean);
  const moveRestrictions = forbiddenMoves.length === 0
    ? ""
    : `；不能${forbiddenMoves.join("、")}${rules.turn.passAllowed ? "" : "或跳过回合"}`;
  const wallConflicts = !wallPlacement.overlapAllowed && !wallPlacement.crossingAllowed
    ? "不得重叠或交叉"
    : `${wallPlacement.overlapAllowed ? "可以" : "不得"}重叠、${wallPlacement.crossingAllowed ? "可以" : "不得"}交叉`;
  const wallConnections = wallPlacement.endpointConnectionAllowed && wallPlacement.tJunctionAllowed
    ? "允许端点连接和 T 形连接"
    : `${wallPlacement.endpointConnectionAllowed ? "允许" : "不允许"}端点连接、${wallPlacement.tJunctionAllowed ? "允许" : "不允许"} T 形连接`;
  return [
    `棋盘 ${rules.board.width}×${rules.board.height}；双方目标均为到达 y=${rules.goals.left}`,
    `每回合只能行动${rules.turn.actions === 1 ? "一次" : ` ${rules.turn.actions} 次`}：正交移动${movement.distance === 1 ? "一格" : ` ${movement.distance} 格`}或放置一堵覆盖${wallPlacement.edges === 2 ? "两条" : ` ${wallPlacement.edges} 条`}边的墙${moveRestrictions}`,
    `墙${wallConflicts}；${wallConnections}，并且必须为${wallPlacement.preservePathFor.length === 2 ? "双方" : wallPlacement.preservePathFor.join("、")}保留到达目标行的路径`,
    `先手：${first}；最多 ${rules.maxPlies} 手；${timing}`,
    wallLine
  ];
}

export function resolveInteractionMode(state, mode, actionPending) {
  const interactive = Boolean(state && canInteract(state) && !actionPending);
  const hasWall = (state?.legalActions || []).some((action) => action.type === "place_wall");
  return interactive && !hasWall && mode === "wall" ? "move" : mode;
}
