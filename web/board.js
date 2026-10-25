import { destinationFor } from "../core/movement.js";
import { BALL_RADIUS, CELL_SIZE, GRID_X, GRID_Y, WALL_SIDE, cellCenter, wallFaces } from "./board-geometry.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function node(document, tag, attributes = {}, text = null) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (text !== null) element.textContent = text;
  return element;
}

function rect(document, geometry, attributes = {}) {
  return node(document, "rect", { ...geometry, ...attributes });
}

function addGradientStops(document, gradient, stops) {
  for (const [offset, color] of stops) gradient.append(node(document, "stop", { offset, "stop-color": color }));
}

function actionTarget(document, action, label, interactive, onAction) {
  const group = node(document, "g", {
    "data-action": JSON.stringify(action),
    class: "board-action",
    "aria-label": label
  });
  if (interactive) {
    group.addEventListener("click", () => onAction(action));
  }
  return group;
}

export function renderBoard(container, state, options = {}) {
  const {
    legalActions = [],
    mode = "move",
    orientation = "h",
    interactive = false,
    onAction = () => {},
    onModeChange = () => {},
    onOrientationChange = () => {},
    onCancel = () => {}
  } = options;
  const document = container.ownerDocument;
  const svg = node(document, "svg", {
    viewBox: "0 0 320 420",
    role: "application",
    tabindex: interactive ? 0 : -1,
    "aria-label": "9 乘 13 Ball Chess 棋盘。方向键选择行动，回车确认，M 切换行动，R 旋转墙，Escape 取消。"
  });
  const visibleActions = legalActions.filter((action) => (
    (mode === "move" && action.type === "move") ||
    (mode === "wall" && action.type === "place_wall" && action.orientation === orientation)
  ));
  let selectedIndex = 0;
  const selectAction = (step) => {
    if (!visibleActions.length) return;
    selectedIndex = (selectedIndex + step + visibleActions.length) % visibleActions.length;
    for (const target of previews.children) {
      const selected = target.attributes["data-action"] === JSON.stringify(visibleActions[selectedIndex]);
      target.setAttribute("data-selected", String(selected));
    }
  };
  if (interactive) {
    svg.addEventListener("keydown", (event) => {
      if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.key)) {
        event.preventDefault?.();
        selectAction(["ArrowUp", "ArrowRight"].includes(event.key) ? 1 : -1);
      } else if (event.key === "Enter" || event.key === " ") {
        if (!visibleActions.length) return;
        event.preventDefault?.();
        onAction(visibleActions[selectedIndex]);
      } else if (event.key.toLowerCase?.() === "m") {
        event.preventDefault?.();
        onModeChange(mode === "move" ? "wall" : "move");
      } else if (event.key.toLowerCase?.() === "r") {
        event.preventDefault?.();
        onOrientationChange(orientation === "h" ? "v" : "h");
      } else if (event.key === "Escape") {
        event.preventDefault?.();
        onCancel();
      }
    });
  }

  const defs = node(document, "defs");
  const red = node(document, "radialGradient", { id: "ball-red", cx: "32%", cy: "26%", r: "78%" });
  addGradientStops(document, red, [["0%", "#e89296"], ["42%", "#d45a62"], ["100%", "#a83d47"]]);
  const blue = node(document, "radialGradient", { id: "ball-blue", cx: "32%", cy: "26%", r: "78%" });
  addGradientStops(document, blue, [["0%", "#91b6d3"], ["42%", "#5689b6"], ["100%", "#315e88"]]);
  const wallTop = node(document, "linearGradient", { id: "wall-top", x1: "0%", y1: "0%", x2: "0%", y2: "100%" });
  addGradientStops(document, wallTop, [["0%", "#98a29d"], ["55%", "#7e8984"], ["100%", "#727d78"]]);
  defs.append(red, blue, wallTop);
  svg.append(defs);

  const grid = node(document, "g", { class: "board-grid" });
  grid.append(
    rect(document, { x: 34, y: 44, width: 252, height: 356, rx: 20 }, { fill: "#f5f7f4", stroke: "#d4dbd6" }),
    rect(document, { x: 43, y: 53, width: 234, height: 338, rx: 14 }, { fill: "#edf1ed", stroke: "#e0e6e1" }),
    rect(document, { x: GRID_X, y: GRID_Y, width: CELL_SIZE * 9, height: CELL_SIZE, fill: "#b9e5d1", opacity: 0.34 }),
    node(document, "text", { x: 160, y: 59, class: "goal-label", "text-anchor": "middle" }, "TOP EDGE · 胜利区域")
  );
  for (let x = 0; x <= 9; x += 1) {
    grid.append(node(document, "line", {
      x1: GRID_X + x * CELL_SIZE, y1: GRID_Y, x2: GRID_X + x * CELL_SIZE, y2: GRID_Y + CELL_SIZE * 13,
      class: "grid-line"
    }));
  }
  for (let y = 0; y <= 13; y += 1) {
    grid.append(node(document, "line", {
      x1: GRID_X, y1: GRID_Y + y * CELL_SIZE, x2: GRID_X + CELL_SIZE * 9, y2: GRID_Y + y * CELL_SIZE,
      class: "grid-line"
    }));
  }
  grid.append(node(document, "text", { x: 160, y: 412, class: "start-label", "text-anchor": "middle" }, "START · 第三格 / 第七格"));
  svg.append(grid);

  const wallShadows = node(document, "g", { class: "wall-shadows" });
  const wallSides = node(document, "g", { class: "wall-sides" });
  const wallTops = node(document, "g", { class: "wall-tops" });
  for (const wall of state.walls) {
    const { top, side } = wallFaces(wall);
    wallShadows.append(rect(document, top, { fill: "#303736", opacity: 0.1 }));
    wallSides.append(rect(document, side, { fill: "#525d58" }));
    wallTops.append(rect(document, top, { fill: "url(#wall-top)", stroke: "#68736e", "stroke-width": 0.35 }));
  }
  svg.append(wallShadows, wallSides, wallTops);

  const pawnShadows = node(document, "g");
  const pawns = node(document, "g");
  for (const seat of ["left", "right"]) {
    const center = cellCenter(state.players[seat].position);
    pawnShadows.append(node(document, "ellipse", {
      cx: center.x, cy: center.y + BALL_RADIUS * 0.65, rx: BALL_RADIUS * 0.82, ry: BALL_RADIUS * 0.25,
      fill: "#303736", opacity: 0.16
    }));
    pawns.append(node(document, "circle", {
      cx: center.x, cy: center.y, r: BALL_RADIUS,
      fill: `url(#ball-${seat === "left" ? "red" : "blue"})`,
      stroke: seat === "left" ? "#a83d47" : "#315e88", "stroke-width": 0.45,
      "data-player": seat, "aria-label": seat === "left" ? "左侧红球" : "右侧蓝球"
    }));
  }
  svg.append(pawnShadows, pawns);

  const previews = node(document, "g", { class: "action-previews" });
  for (const action of legalActions) {
    if (mode === "move" && action.type === "move") {
      const destination = destinationFor(state.players[state.yourPlayer || state.currentPlayer].position, action.direction);
      const center = cellCenter(destination);
      const target = actionTarget(document, action, `向${action.direction}移动`, interactive, onAction);
      target.setAttribute("data-selected", String(action === visibleActions[selectedIndex]));
      target.append(
        node(document, "circle", { cx: center.x, cy: center.y, r: CELL_SIZE / 2, fill: "transparent" }),
        node(document, "circle", { cx: center.x, cy: center.y, r: 3, class: "move-preview" })
      );
      previews.append(target);
    }
    if (mode === "wall" && action.type === "place_wall" && action.orientation === orientation) {
      const { top } = wallFaces(action);
      const target = actionTarget(document, action, `放置${orientation === "h" ? "横" : "竖"}墙 ${action.x},${action.y}`, interactive, onAction);
      target.setAttribute("data-selected", String(action === visibleActions[selectedIndex]));
      target.append(rect(document, top, { class: "wall-preview" }));
      const hit = orientation === "h"
        ? { x: top.x, y: top.y + top.height / 2 - CELL_SIZE / 4, width: top.width, height: CELL_SIZE / 2 }
        : { x: top.x + top.width / 2 - CELL_SIZE / 4, y: top.y, width: CELL_SIZE / 2, height: top.height };
      target.append(rect(document, hit, { fill: "transparent" }));
      previews.append(target);
    }
  }
  svg.append(previews);
  container.replaceChildren(svg);
}
