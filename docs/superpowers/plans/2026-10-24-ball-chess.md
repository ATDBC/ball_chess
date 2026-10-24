# Ball Chess Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个本地运行的 9 × 13 双人放墙竞速游戏，支持原生 SVG 人类界面、程序 bot、两个不同 agent 通过相同协议对战，以及 MCP stdio 接入。

**Architecture:** 纯 ES Module 规则核心不依赖 I/O；Node 对局服务统一负责权威状态、JSON 持久化、HTTP API 和 SSE。浏览器与 MCP 适配器都是薄客户端，MCP 不复制规则，程序 bot 与大模型 agent 使用相同行动语义。

**Tech Stack:** Node.js 22+（本机已验证 v24.15.0）、原生 JavaScript/HTML/CSS/SVG、`node:http`、`node:test`、SSE、官方 `@modelcontextprotocol/sdk@1.32.2`、JSON 文件存储。

## Global Constraints

- 设计依据：`docs/superpowers/specs/2026-10-24-ball-chess-design.md`，规则与协议以该文件为准。
- 前端第三方运行时依赖为零，不使用打包器、在线字体、图片服务或 CSS 框架。
- 后端核心只用 Node 内置模块；唯一必需第三方包是 `@modelcontextprotocol/sdk@1.32.2`。
- 棋盘固定 9 × 13；左下 `(0, 0)`，起点 `(2, 0)` 与 `(6, 0)`，到达 `y = 12` 获胜。
- 默认 `wallLimit = null`、`maxPlies = 300`、`turnTimeoutMs = null`、左侧先手。
- 无跳跃、无斜走、无主动跳过；墙长严格为两格，重叠和十字交叉非法，双方路径必须保留。
- 所有服务端行动都重新校验；非法行动不改变状态、版本、棋谱或行动计数。
- 默认监听 `127.0.0.1:7100`；`npm run dev` 必须转发 `--host` 与 `--port`。
- 本机 Git Bash 使用 `npm.cmd`；PowerShell 中可将下列命令的 `npm.cmd` 换成 `npm`。
- 测试临时文件只放在项目 `.tmp/` 下；真实对局放在 `data/matches/`，两者均不提交。
- 每个任务完成其指定测试后再提交；不得把后续任务文件提前混入提交。
- 最终浏览器验证后必须停止临时服务，不留下 npm、Node 或 MCP 子进程。

---

## File Map

| 路径 | 单一职责 |
|---|---|
| `package.json` | Node 版本、ES Module、启动与测试脚本 |
| `core/constants.js` | 棋盘、玩家和默认配置常量 |
| `core/errors.js` | 可供 HTTP/MCP 映射的 `GameError` |
| `core/state.js` | 配置校验和初始纯游戏状态 |
| `core/coordinates.js` | 格子边界、索引和邻接边键 |
| `core/walls.js` | 墙锚点、单位边、重叠/交叉和候选锚点 |
| `core/movement.js` | 四向移动与占格/墙体校验 |
| `core/paths.js` | 忽略动态棋子的顶边路径搜索 |
| `core/legal.js` | 合法行动枚举和放墙错误原因 |
| `core/engine.js` | 应用行动、切换回合和终局判定 |
| `core/index.js` | 浏览器与服务端共享的规则导出面 |
| `server/config.js` | HTTP 创建配置的未知字段检查与随机先手解析 |
| `server/store.js` | 原子 JSON 写入和启动读取，不理解棋规 |
| `server/match-record.js` | 对局记录、加入、行动、序列化与恢复 |
| `server/match-service.js` | 对局 Map、异步持久化、事件和回合计时器 |
| `server/http-utils.js` | Bearer、限量 JSON、响应与错误映射 |
| `server/sse.js` | SSE 订阅、完整快照和心跳 |
| `server/static.js` | 仅公开 `web/` 与 `core/` 的静态文件服务 |
| `server/app.js` | 可测试的 HTTP 路由装配 |
| `server/agent-setup.js` | 本机 MCP 配置与席位提示词所需数据 |
| `server/index.js` | CLI host/port 解析和进程启动 |
| `examples/bot.js` | 无依赖 HTTP bot，支持 greedy/random 两种策略 |
| `mcp/ascii.js` | JSON 局面到 ASCII 棋盘 |
| `mcp/session.js` | 单席位 HTTP 会话、SSE 等待与重连 |
| `mcp/tools.js` | 四个 MCP 工具的 JSON Schema 和调用分发 |
| `mcp/index.js` | 官方 SDK stdio 服务入口 |
| `web/board-geometry.js` | 统一格宽、球墙尺寸和 SVG 坐标 |
| `web/board.js` | SVG 棋盘、合法预览和物件渲染 |
| `web/api.js` | 浏览器 HTTP/SSE 客户端 |
| `web/state-view.js` | 版本接收、权限与倒计时等纯展示逻辑 |
| `web/agent-instructions.js` | MCP JSON 和席位提示词文本 |
| `web/app.js` | 页面事件、创建/加入、行动和重连 |
| `web/styles.css` | 现代拟物视觉与响应式布局 |
| `web/index.html` | 单页语义结构 |
| `tests/` | 与上述模块对应的 Node 测试和端到端测试 |
| `README.md` | 启动、人类、bot、MCP 和验证说明 |

---

### Task 1: 项目脚本、错误类型与初始游戏状态

**Files:**
- Create: `package.json`
- Modify: `.gitignore`
- Create: `core/constants.js`, `core/errors.js`, `core/state.js`, `core/index.js`
- Test: `tests/core/state.test.js`

**Interfaces:**
- Produces: `DEFAULT_CONFIG`, `PLAYER_IDS`, `START_POSITIONS`, `GameError`, `normalizeConfig(options)`, `createGame(options)`, `otherPlayer(playerId)`。
- `createGame` 返回 `{ config, players, walls, currentPlayer, plies, lastAction, result }`，不包含房间令牌或 SSE 状态。

- [ ] **Step 1: 写初始状态与配置校验的失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createGame, normalizeConfig } from "../../core/state.js";

test("initial game matches the confirmed board", () => {
  const game = createGame();
  assert.deepEqual(game.players.left.position, [2, 0]);
  assert.deepEqual(game.players.right.position, [6, 0]);
  assert.equal(game.currentPlayer, "left");
  assert.equal(game.plies, 0);
  assert.equal(game.config.wallLimit, null);
  assert.equal(game.config.maxPlies, 300);
  assert.equal(game.result, null);
});

test("configuration accepts finite walls and rejects invalid values", () => {
  assert.equal(normalizeConfig({ wallLimit: 0 }).wallLimit, 0);
  assert.equal(normalizeConfig({ firstPlayer: "right" }).firstPlayer, "right");
  assert.throws(() => normalizeConfig({ wallLimit: -1 }), /wallLimit/);
  assert.throws(() => normalizeConfig({ maxPlies: 0 }), /maxPlies/);
  assert.throws(() => normalizeConfig({ turnTimeoutMs: 0 }), /turnTimeoutMs/);
  assert.throws(() => normalizeConfig({ firstPlayer: "random" }), /firstPlayer/);
});
```

- [ ] **Step 2: 运行测试，确认因实现不存在而失败**

Run: `node --test tests/core/state.test.js`
Expected: FAIL，出现 `ERR_MODULE_NOT_FOUND`，不能是语法错误。

- [ ] **Step 3: 创建脚本、常量、错误类型和完整初始状态实现**

`package.json`：

```json
{
  "name": "ball-chess",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "node server/index.js",
    "start": "node server/index.js",
    "test": "node --test",
    "test:watch": "node --test --watch"
  }
}
```

在 `.gitignore` 追加 `.tmp/`。实现文件：

```js
// core/constants.js
export const WIDTH = 9;
export const HEIGHT = 13;
export const PLAYER_IDS = Object.freeze(["left", "right"]);
export const START_POSITIONS = Object.freeze({ left: [2, 0], right: [6, 0] });
export const DEFAULT_CONFIG = Object.freeze({
  width: WIDTH,
  height: HEIGHT,
  wallLimit: null,
  maxPlies: 300,
  turnTimeoutMs: null,
  firstPlayer: "left"
});

// core/errors.js
export class GameError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "GameError";
    this.code = code;
    this.details = details;
  }
}

// core/state.js
import { DEFAULT_CONFIG, PLAYER_IDS, START_POSITIONS } from "./constants.js";
import { GameError } from "./errors.js";

export function normalizeConfig(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options, width: 9, height: 13 };
  if (!(config.wallLimit === null || (Number.isInteger(config.wallLimit) && config.wallLimit >= 0))) {
    throw new GameError("INVALID_CONFIG", "wallLimit must be null or a non-negative integer");
  }
  if (!Number.isInteger(config.maxPlies) || config.maxPlies < 1) {
    throw new GameError("INVALID_CONFIG", "maxPlies must be a positive integer");
  }
  if (!(config.turnTimeoutMs === null || (Number.isInteger(config.turnTimeoutMs) && config.turnTimeoutMs > 0))) {
    throw new GameError("INVALID_CONFIG", "turnTimeoutMs must be null or a positive integer");
  }
  if (!PLAYER_IDS.includes(config.firstPlayer)) {
    throw new GameError("INVALID_CONFIG", "firstPlayer must be left or right");
  }
  return config;
}

export function otherPlayer(playerId) {
  if (!PLAYER_IDS.includes(playerId)) throw new GameError("INVALID_PLAYER", "Unknown player", { playerId });
  return playerId === "left" ? "right" : "left";
}

export function createGame(options = {}) {
  const config = normalizeConfig(options);
  return {
    config,
    players: {
      left: { color: "red", position: [...START_POSITIONS.left], wallsUsed: 0 },
      right: { color: "blue", position: [...START_POSITIONS.right], wallsUsed: 0 }
    },
    walls: [],
    currentPlayer: config.firstPlayer,
    plies: 0,
    lastAction: null,
    result: null
  };
}
```

`core/index.js` 当前只导出 `./constants.js`、`./errors.js` 和 `./state.js`，后续任务逐步增加导出，不改变已有导入路径。

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test tests/core/state.test.js`
Expected: 2 个测试 PASS，`npm.cmd test` 也不应存在其他失败。

- [ ] **Step 5: 提交**

```bash
git add package.json .gitignore core tests/core/state.test.js
git commit -m "feat: add initial game state"
```

---

### Task 2: 墙坐标、单位边与冲突判定

**Files:**
- Create: `core/coordinates.js`, `core/walls.js`
- Modify: `core/index.js`
- Test: `tests/core/walls.test.js`

**Interfaces:**
- Consumes: `WIDTH`, `HEIGHT`, `GameError`。
- Produces: `inBounds(x, y)`, `cellEdgeKey(a, b)`, `wallAnchorError(wall)`, `wallCellEdges(wall)`, `wallConflict(a, b)`, `buildBlockedEdges(walls)`, `listAllWallAnchors()`。
- `wallAnchorError` 返回 `null | "INVALID_WALL"`；`wallConflict` 返回 `null | "WALL_OVERLAP" | "WALL_CROSS"`。

- [ ] **Step 1: 写墙几何表驱动失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { wallAnchorError, wallCellEdges, wallConflict, buildBlockedEdges, listAllWallAnchors } from "../../core/walls.js";

test("wall anchors cover exactly two cell edges", () => {
  assert.deepEqual(wallCellEdges({ orientation: "h", x: 1, y: 5 }), [
    [[1, 4], [1, 5]], [[2, 4], [2, 5]]
  ]);
  assert.deepEqual(wallCellEdges({ orientation: "v", x: 4, y: 2 }), [
    [[3, 2], [4, 2]], [[3, 3], [4, 3]]
  ]);
  assert.equal(listAllWallAnchors().length, 192);
});

test("connected, overlapping, crossing and T walls are distinguished", () => {
  const h1 = { orientation: "h", x: 1, y: 5 };
  const h2 = { orientation: "h", x: 3, y: 5 };
  const overlap = { orientation: "h", x: 2, y: 5 };
  const cross = { orientation: "v", x: 2, y: 4 };
  const touch = { orientation: "v", x: 1, y: 4 };
  assert.equal(wallConflict(h1, h2), null);
  assert.equal(wallConflict(h1, overlap), "WALL_OVERLAP");
  assert.equal(wallConflict(h1, cross), "WALL_CROSS");
  assert.equal(wallConflict(h1, touch), null);
  assert.equal(wallAnchorError({ orientation: "h", x: 8, y: 5 }), "INVALID_WALL");
});

test("blocked edges are symmetric", () => {
  const edges = buildBlockedEdges([{ orientation: "h", x: 2, y: 1 }]);
  assert.equal(edges.size, 2);
});
```

- [ ] **Step 2: 验证失败**

Run: `node --test tests/core/walls.test.js`
Expected: FAIL，提示无法加载 `core/walls.js`。

- [ ] **Step 3: 实现坐标和墙几何**

```js
// core/coordinates.js
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

// core/walls.js
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
```

在 `core/index.js` 增加 `export * from "./coordinates.js";` 和 `export * from "./walls.js";`。

- [ ] **Step 4: 验证通过**

Run: `node --test tests/core/walls.test.js`
Expected: 3 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add core tests/core/walls.test.js
git commit -m "feat: add wall geometry"
```

---

### Task 3: 四向移动与动态棋子阻挡

**Files:**
- Create: `core/movement.js`
- Modify: `core/index.js`
- Test: `tests/core/movement.test.js`

**Interfaces:**
- Consumes: `buildBlockedEdges`, `cellEdgeKey`, `inBounds`, `createGame`。
- Produces: `DIRECTIONS`, `destinationFor(position, direction)`, `listLegalMoves(game, playerId)`。
- `listLegalMoves` 只计算几何移动，不检查回合；它返回 `{ type: "move", direction }` 数组。

- [ ] **Step 1: 写移动失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../../core/state.js";
import { listLegalMoves } from "../../core/movement.js";

test("bottom starts cannot move down", () => {
  const game = createGame();
  assert.deepEqual(listLegalMoves(game, "left").map((a) => a.direction), ["up", "left", "right"]);
});

test("pawn occupancy and walls independently block movement without jumping", () => {
  const occupied = createGame();
  occupied.players.right.position = [2, 1];
  assert.ok(!listLegalMoves(occupied, "left").some((a) => a.direction === "up"));
  assert.ok(listLegalMoves(occupied, "left").some((a) => a.direction === "left"));
  const walled = createGame();
  walled.walls.push({ orientation: "h", x: 1, y: 1 });
  assert.ok(!listLegalMoves(walled, "left").some((a) => a.direction === "up"));
  assert.ok(listLegalMoves(walled, "left").some((a) => a.direction === "right"));
});

test("wall blocks only its two exact edges", () => {
  const game = createGame();
  game.walls.push({ orientation: "h", x: 2, y: 1 });
  assert.ok(!listLegalMoves(game, "left").some((a) => a.direction === "up"));
  assert.ok(listLegalMoves(game, "right").some((a) => a.direction === "up"));
});
```

- [ ] **Step 2: 验证失败**

Run: `node --test tests/core/movement.test.js`
Expected: FAIL，提示无法加载 `core/movement.js`。

- [ ] **Step 3: 实现移动**

```js
// core/movement.js
import { inBounds, cellEdgeKey } from "./coordinates.js";
import { buildBlockedEdges } from "./walls.js";

export const DIRECTIONS = Object.freeze({
  up: [0, 1],
  down: [0, -1],
  left: [-1, 0],
  right: [1, 0]
});

export function destinationFor(position, direction) {
  const delta = DIRECTIONS[direction];
  if (!delta) return null;
  return [position[0] + delta[0], position[1] + delta[1]];
}

export function listLegalMoves(game, playerId) {
  const blocked = buildBlockedEdges(game.walls);
  const origin = game.players[playerId].position;
  const opponentId = playerId === "left" ? "right" : "left";
  const opponent = game.players[opponentId].position;
  const result = [];
  for (const direction of ["up", "down", "left", "right"]) {
    const destination = destinationFor(origin, direction);
    if (!inBounds(destination[0], destination[1])) continue;
    if (destination[0] === opponent[0] && destination[1] === opponent[1]) continue;
    if (blocked.has(cellEdgeKey(origin, destination))) continue;
    result.push({ type: "move", direction });
  }
  return result;
}
```

在 `core/index.js` 增加 `export * from "./movement.js";`。

- [ ] **Step 4: 验证通过及回归**

Run: `node --test tests/core/movement.test.js tests/core/walls.test.js tests/core/state.test.js`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add core tests/core/movement.test.js
git commit -m "feat: add legal movement"
```

---

### Task 4: 顶边路径、放墙路径约束与合法行动枚举

**Files:**
- Create: `core/paths.js`, `core/legal.js`
- Modify: `core/index.js`
- Test: `tests/core/legal.test.js`

**Interfaces:**
- Consumes: 所有墙与移动接口。
- Produces: `hasPathToGoal(game, position)`, `pathsRemainAfterWall(game, wall)`, `wallPlacementError(game, playerId, wall)`, `listLegalActions(game, playerId)`, `actionEquals(a, b)`。
- `wallPlacementError` 返回 `null | "INVALID_WALL" | "WALL_OVERLAP" | "WALL_CROSS" | "WALL_LIMIT_REACHED" | "PATH_BLOCKED"`。
- `listLegalActions` 在终局或非指定玩家回合返回空数组。

- [ ] **Step 1: 写路径和行动枚举失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../../core/state.js";
import { hasPathToGoal, pathsRemainAfterWall } from "../../core/paths.js";
import { listLegalActions, wallPlacementError } from "../../core/legal.js";

test("path search treats pawns as temporary but walls as permanent", () => {
  const game = createGame();
  game.players.right.position = [2, 1];
  assert.equal(hasPathToGoal(game, game.players.left.position), true);
  game.walls.push({ orientation: "h", x: 0, y: 1 }, { orientation: "v", x: 1, y: 0 });
  assert.equal(hasPathToGoal(game, [0, 0]), false);
});

test("candidate that closes the last path is detected", () => {
  const game = createGame();
  game.players.left.position = [0, 0];
  game.walls.push({ orientation: "h", x: 0, y: 1 });
  assert.equal(pathsRemainAfterWall(game, { orientation: "v", x: 1, y: 0 }), false);
});

test("legal actions honor wall limits and preserve paths", () => {
  const unlimited = createGame();
  assert.equal(listLegalActions(unlimited, "right").length, 0);
  assert.equal(listLegalActions(unlimited, "left").length, 195);
  for (const action of listLegalActions(unlimited, "left")) {
    if (action.type === "place_wall") assert.equal(pathsRemainAfterWall(unlimited, action), true);
  }
  const exhausted = createGame({ wallLimit: 1 });
  exhausted.players.left.wallsUsed = 1;
  assert.equal(wallPlacementError(exhausted, "left", { orientation: "h", x: 0, y: 5 }), "WALL_LIMIT_REACHED");
  const zeroWalls = createGame({ wallLimit: 0 });
  assert.deepEqual(listLegalActions(zeroWalls, "left").map((a) => a.direction), ["up", "left", "right"]);
  assert.equal(wallPlacementError(unlimited, "left", { orientation: "h", x: 2, y: 5 }), null);
  unlimited.walls.push({ orientation: "h", x: 2, y: 5 });
  assert.equal(wallPlacementError(unlimited, "left", { orientation: "h", x: 2, y: 5 }), "WALL_OVERLAP");
});
```

- [ ] **Step 2: 验证失败**

Run: `node --test tests/core/legal.test.js`
Expected: FAIL，提示无法加载路径或合法行动模块。

- [ ] **Step 3: 实现 BFS 与放墙检查**

```js
// core/paths.js
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

// core/legal.js
import { listAllWallAnchors, wallAnchorError, wallConflict } from "./walls.js";
import { listLegalMoves } from "./movement.js";
import { pathsRemainAfterWall } from "./paths.js";

export function wallPlacementError(game, playerId, wall) {
  const anchorError = wallAnchorError(wall);
  if (anchorError) return anchorError;
  if (game.config.wallLimit !== null && game.players[playerId].wallsUsed >= game.config.wallLimit) return "WALL_LIMIT_REACHED";
  for (const existing of game.walls) {
    const conflict = wallConflict(existing, wall);
    if (conflict) return conflict;
  }
  return pathsRemainAfterWall(game, wall) ? null : "PATH_BLOCKED";
}

export function listLegalActions(game, playerId) {
  if (game.result || game.currentPlayer !== playerId) return [];
  const actions = listLegalMoves(game, playerId);
  if (game.config.wallLimit !== null && game.players[playerId].wallsUsed >= game.config.wallLimit) return actions;
  for (const wall of listAllWallAnchors()) {
    if (wallPlacementError(game, playerId, wall) === null) actions.push({ type: "place_wall", ...wall });
  }
  return actions;
}

export function actionEquals(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === "move") return a.direction === b.direction;
  if (a.type === "place_wall") return a.orientation === b.orientation && a.x === b.x && a.y === b.y;
  return false;
}
```

在 `core/index.js` 增加 `export * from "./paths.js";` 和 `export * from "./legal.js";`。

- [ ] **Step 4: 验证通过及全量核心回归**

Run: `npm.cmd test`
Expected: 所有现有测试 PASS；初始左侧行动数为 3 个移动 + 192 个放墙，共 195。

- [ ] **Step 5: 提交**

```bash
git add core tests/core/legal.test.js
git commit -m "feat: enumerate legal game actions"
```

---

### Task 5: 应用行动与全部终局结果

**Files:**
- Create: `core/engine.js`
- Modify: `core/index.js`
- Test: `tests/core/engine.test.js`

**Interfaces:**
- Consumes: `listLegalActions`, `actionEquals`, `wallPlacementError`, `otherPlayer`。
- Produces: `getActionError(game, playerId, action)`, `applyAction(game, playerId, action)`, `settleCurrentTurn(game)`。
- `applyAction` 返回新对象，不修改输入；获胜/和棋时保留当前玩家字段，由 `result` 表示终局。无合法行动时 `currentPlayer` 是无法行动的一方。

- [ ] **Step 1: 写完整行动结算失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../../core/state.js";
import { applyAction, settleCurrentTurn } from "../../core/engine.js";

test("left wins on ply 23 when both players only advance", () => {
  let game = createGame();
  for (let i = 0; i < 11; i += 1) {
    game = applyAction(game, "left", { type: "move", direction: "up" });
    game = applyAction(game, "right", { type: "move", direction: "up" });
  }
  game = applyAction(game, "left", { type: "move", direction: "up" });
  assert.equal(game.plies, 23);
  assert.deepEqual(game.result, { kind: "win", winner: "left", reason: "reached_goal" });
});

test("ply 300 draws and rejected actions leave the input immutable", () => {
  const drawGame = createGame({ maxPlies: 300 });
  drawGame.plies = 299;
  const draw = applyAction(drawGame, "left", { type: "move", direction: "up" });
  assert.equal(draw.plies, 300);
  assert.equal(draw.result.kind, "draw");
  assert.equal(drawGame.plies, 299);
  assert.throws(() => applyAction(drawGame, "right", { type: "move", direction: "up" }), (error) => error.code === "NOT_YOUR_TURN");
});

test("reaching the goal on ply 300 wins before the draw check", () => {
  const game = createGame({ maxPlies: 300 });
  game.plies = 299;
  game.players.left.position = [2, 11];
  const won = applyAction(game, "left", { type: "move", direction: "up" });
  assert.equal(won.plies, 300);
  assert.deepEqual(won.result, { kind: "win", winner: "left", reason: "reached_goal" });
});

test("actions reject unknown fields without changing state", () => {
  const game = createGame();
  assert.throws(
    () => applyAction(game, "left", { type: "move", direction: "up", unexpected: true }),
    (error) => error.code === "ILLEGAL_ACTION" && error.details.reason === "INVALID_ACTION"
  );
  assert.equal(game.plies, 0);
});

test("no legal action loses instead of deadlocking", () => {
  const game = createGame({ wallLimit: 0 });
  game.players.left.position = [0, 0];
  game.players.right.position = [1, 0];
  game.walls.push({ orientation: "h", x: 0, y: 1 });
  const settled = settleCurrentTurn(game);
  assert.deepEqual(settled.result, { kind: "win", winner: "right", reason: "no_legal_action" });
});
```

- [ ] **Step 2: 验证失败**

Run: `node --test tests/core/engine.test.js`
Expected: FAIL，提示无法加载 `core/engine.js`。

- [ ] **Step 3: 实现行动校验和状态迁移**

```js
// core/engine.js
import { HEIGHT } from "./constants.js";
import { GameError } from "./errors.js";
import { otherPlayer } from "./state.js";
import { destinationFor } from "./movement.js";
import { actionEquals, listLegalActions, wallPlacementError } from "./legal.js";

export function getActionError(game, playerId, action) {
  if (game.result) return new GameError("MATCH_FINISHED", "Match is finished", { result: game.result });
  if (game.currentPlayer !== playerId) return new GameError("NOT_YOUR_TURN", "Not your turn", { currentPlayer: game.currentPlayer });
  if (!action || !["move", "place_wall"].includes(action.type)) {
    return new GameError("ILLEGAL_ACTION", "Unknown action", { reason: "INVALID_ACTION" });
  }
  const expectedKeys = action.type === "move" ? ["type", "direction"] : ["type", "orientation", "x", "y"];
  const actualKeys = Object.keys(action);
  if (actualKeys.length !== expectedKeys.length || expectedKeys.some((key) => !Object.hasOwn(action, key))) {
    return new GameError("ILLEGAL_ACTION", "Action has missing or unknown fields", { reason: "INVALID_ACTION" });
  }
  if (listLegalActions(game, playerId).some((candidate) => actionEquals(candidate, action))) return null;
  const reason = action.type === "place_wall" ? wallPlacementError(game, playerId, action) || "ILLEGAL_MOVE" : "ILLEGAL_MOVE";
  return new GameError("ILLEGAL_ACTION", "Action is not legal", { reason });
}

export function settleCurrentTurn(game) {
  if (game.result || listLegalActions(game, game.currentPlayer).length > 0) return game;
  const next = structuredClone(game);
  const loser = next.currentPlayer;
  next.result = { kind: "win", winner: otherPlayer(loser), reason: "no_legal_action" };
  return next;
}

export function applyAction(game, playerId, action) {
  const error = getActionError(game, playerId, action);
  if (error) throw error;
  const next = structuredClone(game);
  if (action.type === "move") {
    next.players[playerId].position = destinationFor(next.players[playerId].position, action.direction);
  } else {
    next.walls.push({ orientation: action.orientation, x: action.x, y: action.y });
    next.players[playerId].wallsUsed += 1;
  }
  next.plies += 1;
  next.lastAction = { player: playerId, ply: next.plies, action: structuredClone(action) };
  if (action.type === "move" && next.players[playerId].position[1] === HEIGHT - 1) {
    next.result = { kind: "win", winner: playerId, reason: "reached_goal" };
    return next;
  }
  if (next.plies >= next.config.maxPlies) {
    next.result = { kind: "draw", winner: null, reason: "max_plies" };
    return next;
  }
  next.currentPlayer = otherPlayer(playerId);
  return settleCurrentTurn(next);
}
```

在 `core/index.js` 增加 `export * from "./engine.js";`。

- [ ] **Step 4: 运行核心全量测试**

Run: `npm.cmd test`
Expected: 全部 PASS，包括“到达顶边优先于行动上限判和”以及完整 23 手胜利测试。

- [ ] **Step 5: 提交**

```bash
git add core tests/core/engine.test.js
git commit -m "feat: apply actions and settle games"
```

---

### Task 6: 原子 JSON 存储与损坏记录隔离

**Files:**
- Create: `server/store.js`
- Test: `tests/server/store.test.js`

**Interfaces:**
- Produces: `class MatchStore`，构造 `new MatchStore({ directory })`；方法 `save(record)`, `loadAll()`。
- `save` 接受纯 JSON 对象；`loadAll()` 返回 `{ records, failures }`，`failures` 项为 `{ matchId, file, message }`。

- [ ] **Step 1: 写存储失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { MatchStore } from "../../server/store.js";

async function tempStore(t) {
  await mkdir(path.join(process.cwd(), ".tmp"), { recursive: true });
  const directory = await mkdtemp(path.join(process.cwd(), ".tmp", "store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new MatchStore({ directory });
}

test("records round trip with tokens confined to storage", async (t) => {
  const store = await tempStore(t);
  await store.save({ schemaVersion: 1, id: "m_test", playerTokens: { left: "secret" }, actions: [] });
  const loaded = await store.loadAll();
  assert.equal(loaded.records[0].playerTokens.left, "secret");
  assert.equal(loaded.failures.length, 0);
});

test("one corrupt record does not block valid records", async (t) => {
  const store = await tempStore(t);
  await store.save({ schemaVersion: 1, id: "m_valid", actions: [] });
  await writeFile(path.join(store.directory, "broken.json"), "{bad", "utf8");
  const loaded = await store.loadAll();
  assert.equal(loaded.records.length, 1);
  assert.equal(loaded.failures[0].matchId, "broken");
});
```

- [ ] **Step 2: 验证失败**

Run: `node --test tests/server/store.test.js`
Expected: FAIL，提示无法加载 `server/store.js`。

- [ ] **Step 3: 实现原子保存和容错读取**

```js
// server/store.js
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export class MatchStore {
  constructor({ directory }) {
    this.directory = directory;
  }

  async save(record) {
    await mkdir(this.directory, { recursive: true });
    const target = path.join(this.directory, `${record.id}.json`);
    const temporary = path.join(this.directory, `.${record.id}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async loadAll() {
    await mkdir(this.directory, { recursive: true });
    const records = [];
    const failures = [];
    for (const file of (await readdir(this.directory)).filter((name) => name.endsWith(".json"))) {
      const matchId = path.basename(file, ".json");
      try {
        const record = JSON.parse(await readFile(path.join(this.directory, file), "utf8"));
        if (record.schemaVersion !== 1 || record.id !== matchId || !Array.isArray(record.actions)) throw new Error("Invalid match record schema");
        records.push(record);
      } catch (error) {
        failures.push({ matchId, file, message: error.message });
      }
    }
    return { records, failures };
  }
}
```

- [ ] **Step 4: 验证通过**

Run: `node --test tests/server/store.test.js`
Expected: 2 个测试 PASS，`.tmp/` 在清理后无遗留测试目录。

- [ ] **Step 5: 提交**

```bash
git add server/store.js tests/server/store.test.js
git commit -m "feat: add atomic match storage"
```

---

### Task 7: 房间生命周期、权威对局服务与恢复

**Files:**
- Create: `server/config.js`, `server/match-record.js`, `server/match-service.js`
- Test: `tests/server/match-service.test.js`

**Interfaces:**
- Consumes: `createGame`, `applyAction`, `settleCurrentTurn`, `listLegalActions`, `MatchStore`。
- Produces: `resolveMatchConfig(options)`, `class MatchService`。
- `MatchService.open({ store })` 异步恢复；其他方法为 `create`, `join`, `getState`, `submitAction`, `getSetup`, `abort`, `getRecord`。
- `create(options)` 返回 `{ matchId, adminToken, playerTokens: { left, right }, state }`；`join(id, token, profile)` 与 `submitAction(id, token, expectedVersion, action)` 返回该玩家视角状态。
- 服务继承 `EventEmitter`，每次成功持久化后发出 `update`，载荷 `{ matchId, state }`。

- [ ] **Step 1: 写房间、过期版本与恢复失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { MatchStore } from "../../server/store.js";
import { MatchService } from "../../server/match-service.js";

async function fixture(t, options = {}) {
  await mkdir(path.join(process.cwd(), ".tmp"), { recursive: true });
  const directory = await mkdtemp(path.join(process.cwd(), ".tmp", "matches-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new MatchStore({ directory });
  const service = await MatchService.open({ store });
  const created = await service.create({ maxPlies: 40, ...options });
  await service.join(created.matchId, created.playerTokens.left, { name: "L", clientKind: "test" });
  await service.join(created.matchId, created.playerTokens.right, { name: "R", clientKind: "test" });
  return { store, service, created };
}

test("two seats start at version 2 and stale retries do not apply twice", async (t) => {
  const { service, created } = await fixture(t);
  const accepted = await service.submitAction(created.matchId, created.playerTokens.left, 2, { type: "move", direction: "up" });
  assert.equal(accepted.version, 3);
  await assert.rejects(
    service.submitAction(created.matchId, created.playerTokens.left, 2, { type: "move", direction: "up" }),
    (error) => error.code === "STALE_STATE"
  );
  const state = await service.getState(created.matchId, created.playerTokens.left);
  assert.deepEqual(state.players.left.position, [2, 1]);
  assert.equal(state.plies, 1);
});

test("restart rebuilds game from accepted actions and hides exported tokens", async (t) => {
  const { store, service, created } = await fixture(t);
  await service.submitAction(created.matchId, created.playerTokens.left, 2, { type: "move", direction: "up" });
  const restored = await MatchService.open({ store });
  const state = await restored.getState(created.matchId, created.playerTokens.left);
  assert.deepEqual(state.players.left.position, [2, 1]);
  const record = await restored.getRecord(created.matchId);
  assert.equal(JSON.stringify(record).includes("playerTokens"), false);
  assert.equal(JSON.stringify(record).includes(created.adminToken), false);
});

test("expired current player loses without advancing plies", async (t) => {
  const { service, created } = await fixture(t, { turnTimeoutMs: 20 });
  await new Promise((resolve) => setTimeout(resolve, 35));
  const state = await service.getState(created.matchId);
  assert.equal(state.result.reason, "turn_timeout");
  assert.equal(state.result.winner, "right");
  assert.equal(state.plies, 0);
});

test("only admin can abort and aborted games reject later actions", async (t) => {
  const { service, created } = await fixture(t);
  await assert.rejects(service.abort(created.matchId, created.playerTokens.left), (error) => error.code === "FORBIDDEN");
  const aborted = await service.abort(created.matchId, created.adminToken);
  assert.deepEqual(aborted.result, { kind: "aborted", winner: null, reason: "admin_abort" });
  assert.equal(aborted.plies, 0);
  await assert.rejects(
    service.submitAction(created.matchId, created.playerTokens.left, aborted.version, { type: "move", direction: "up" }),
    (error) => error.code === "MATCH_FINISHED"
  );
});

test("random first player is resolved once into the public config", async (t) => {
  const { service, created } = await fixture(t, { firstPlayer: "random" });
  const state = await service.getState(created.matchId);
  assert.ok(["left", "right"].includes(state.config.firstPlayer));
  assert.equal(state.currentPlayer, state.config.firstPlayer);
});
```

- [ ] **Step 2: 验证失败**

Run: `node --test tests/server/match-service.test.js`
Expected: FAIL，提示房间模块不存在。

- [ ] **Step 3: 实现创建配置和纯记录转换**

`resolveMatchConfig` 只接受 `wallLimit`, `maxPlies`, `turnTimeoutMs`, `firstPlayer` 四个键；遇到其他键抛 `INVALID_CONFIG`。`firstPlayer = "random"` 时用 `crypto.randomInt(2)` 解析成左/右，再调用 `normalizeConfig`。

记录形状固定为：

```js
const recordShape = {
  schemaVersion: 1,
  id: "m_example",
  adminToken: "admin_secret",
  playerTokens: { left: "left_secret", right: "right_secret" },
  createdAt: 0,
  updatedAt: 0,
  joined: { left: false, right: false },
  profiles: { left: null, right: null },
  status: "waiting",
  version: 0,
  turnDeadlineAt: null,
  config: { width: 9, height: 13, wallLimit: null, maxPlies: 300, turnTimeoutMs: null, firstPlayer: "left" },
  actions: [],
  result: null
};
```

在 `match-record.js` 实现并导出以下纯函数；所有返回新记录的函数先 `structuredClone(record)`，不修改输入：

```js
export function toPublicState(record, seat = null) {
  const yourTurn = seat !== null && record.status === "playing" && record.game.currentPlayer === seat && !record.game.result;
  return {
    matchId: record.id,
    version: record.version,
    status: record.status,
    ...record.game,
    turnDeadlineAt: record.turnDeadlineAt,
    seats: {
      left: { joined: record.joined.left, profile: record.profiles.left },
      right: { joined: record.joined.right, profile: record.profiles.right }
    },
    ...(seat ? { yourPlayer: seat, yourTurn, legalActions: yourTurn ? listLegalActions(record.game, seat) : [] } : {})
  };
}

export function serializeMatch(record) {
  return {
    schemaVersion: 1,
    id: record.id,
    adminToken: record.adminToken,
    playerTokens: record.playerTokens,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    joined: record.joined,
    profiles: record.profiles,
    status: record.status,
    version: record.version,
    turnDeadlineAt: record.turnDeadlineAt,
    config: record.config,
    actions: record.actions,
    result: record.game.result
  };
}

export function restoreMatch(raw) {
  let game = createGame(raw.config);
  for (const entry of raw.actions) game = applyAction(game, entry.player, entry.action);
  game.result = raw.result;
  return { ...raw, game };
}
```

`joinMatchRecord`：相同令牌重复加入直接返回原记录；首次加入设置席位和 profile，`version + 1`。第二席位加入的同一次转换把状态改为 `playing`、设置 deadline，并调用 `settleCurrentTurn`；若立即终局则状态为 `finished`。

`submitMatchAction`：依次检查席位、状态、版本，再调用 `applyAction`。成功后追加 `{ player, ply, action, at }`，`version + 1`，并依据 `game.result` 设置状态和下一回合 deadline。

`expireMatchRecord` 与 `abortMatchRecord`：只改变结果、状态、版本和 deadline，不改变 `plies`。超时胜者是 `otherPlayer(game.currentPlayer)`；中止结果为 `{ kind: "aborted", winner: null, reason: "admin_abort" }`。

- [ ] **Step 4: 实现异步服务和回合计时器**

`MatchService` 的每个写方法遵循同一顺序：读取旧记录 → 纯函数生成候选记录 → `store.save(serializeMatch(candidate))` → 更新 Map → 重设计时器 → 发出 `update`。保存失败时抛 `GameError("STORAGE_ERROR", ...)`，Map 不变。

构造与恢复接口：

```js
export class MatchService extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.matches = new Map();
    this.timers = new Map();
    this.unavailable = new Map();
  }

  static async open({ store }) {
    const service = new MatchService(store);
    const { records, failures } = await store.loadAll();
    for (const failure of failures) service.unavailable.set(failure.matchId, failure);
    for (const raw of records) {
      try {
        const record = restoreMatch(raw);
        service.matches.set(record.id, record);
        service.armTimer(record);
      } catch (error) {
        service.unavailable.set(raw.id, { message: error.message });
      }
    }
    return service;
  }
}
```

`create` 使用 `randomBytes(16).toString("base64url")` 生成三个令牌，使用 9 个随机字节生成 `m_` 前缀房间 ID。`getSetup` 只接受管理员令牌并返回两个玩家令牌，不返回管理员令牌。`getRecord` 只返回 `{ schemaVersion, matchId, config, actions, result, createdAt, updatedAt }`。

`armTimer` 在 `turnDeadlineAt` 非空时设置 `setTimeout`，调用 `unref()`；回调只在该对局版本仍匹配时执行超时转换。每次行动、中止和恢复都先清理旧计时器。

- [ ] **Step 5: 运行房间测试**

Run: `node --test tests/server/match-service.test.js tests/server/store.test.js`
Expected: 全部 PASS；测试结束后计时器不会阻止 Node 退出。

- [ ] **Step 6: 提交**

```bash
git add server/config.js server/match-record.js server/match-service.js tests/server/match-service.test.js
git commit -m "feat: manage persistent matches"
```

---

### Task 8: HTTP API、SSE、静态服务与启动参数

**Files:**
- Create: `server/http-utils.js`, `server/sse.js`, `server/static.js`, `server/app.js`, `server/agent-setup.js`, `server/index.js`
- Test: `tests/server/http.test.js`

**Interfaces:**
- Consumes: `MatchService` 全部公共方法。
- Produces: `createApp({ service, webRoot, coreRoot })` 返回未监听的 `http.Server`；`SseHub`；`buildAgentSetup({ request, playerTokens })`。
- `server/index.js` 解析 `--host`, `--port`，默认 `127.0.0.1:7100`。

- [ ] **Step 1: 写真实 HTTP 失败测试**

测试在 `.tmp/` 创建 store，通过 `createApp` 监听 `127.0.0.1:0`，使用 Node 原生 `fetch`。完整覆盖：

```js
const created = await fetch(`${base}/api/matches`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ maxPlies: 40 })
}).then((r) => r.json());
const leftAuth = { authorization: `Bearer ${created.playerTokens.left}` };
const rightAuth = { authorization: `Bearer ${created.playerTokens.right}` };
await fetch(`${base}/api/matches/${created.matchId}/join`, { method: "POST", headers: { ...leftAuth, "content-type": "application/json" }, body: "{}" });
await fetch(`${base}/api/matches/${created.matchId}/join`, { method: "POST", headers: { ...rightAuth, "content-type": "application/json" }, body: "{}" });
const response = await fetch(`${base}/api/matches/${created.matchId}/actions`, {
  method: "POST",
  headers: { ...leftAuth, "content-type": "application/json" },
  body: JSON.stringify({ expectedVersion: 2, action: { type: "move", direction: "up" } })
});
assert.equal(response.status, 200);
```

继续在 HTTP 测试中加入错误、导出和 SSE 断言：

```js
const badAuth = await fetch(`${base}/api/matches/${created.matchId}/state`, { headers: { authorization: "Bearer wrong" } });
assert.equal(badAuth.status, 401);
const stale = await fetch(`${base}/api/matches/${created.matchId}/actions`, {
  method: "POST",
  headers: { ...leftAuth, "content-type": "application/json" },
  body: JSON.stringify({ expectedVersion: 2, action: { type: "move", direction: "up" } })
});
assert.equal(stale.status, 409);
assert.equal((await stale.json()).state.plies, 1);
const recordText = await fetch(`${base}/api/matches/${created.matchId}/record`).then((r) => r.text());
assert.ok(!recordText.includes(created.adminToken));
assert.ok(!recordText.includes(created.playerTokens.left));
assert.ok(!recordText.includes(created.playerTokens.right));
const traversal = await fetch(`${base}/..%2Fdata%2Fmatches%2Fsecret.json`);
assert.notEqual(traversal.status, 200);
assert.ok(!(await traversal.text()).includes("secret"));

const sseResponse = await fetch(`${base}/api/matches/${created.matchId}/events`);
const reader = sseResponse.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
async function nextSse() {
  for (;;) {
    const end = buffer.indexOf("\n\n");
    if (end >= 0) {
      const packet = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = packet.split("\n").find((line) => line.startsWith("data:"));
      if (data) return JSON.parse(data.slice(5).trim());
    }
    const { done, value } = await reader.read();
    if (done) throw new Error("SSE closed before the expected event");
    buffer += decoder.decode(value, { stream: true });
  }
}
assert.equal((await nextSse()).version, 3);
await fetch(`${base}/api/matches/${created.matchId}/actions`, {
  method: "POST",
  headers: { ...rightAuth, "content-type": "application/json" },
  body: JSON.stringify({ expectedVersion: 3, action: { type: "move", direction: "up" } })
});
assert.equal((await nextSse()).version, 4);
await reader.cancel();
```

- [ ] **Step 2: 验证失败**

Run: `node --test tests/server/http.test.js`
Expected: FAIL，提示 `server/app.js` 不存在。

- [ ] **Step 3: 实现限量请求、错误映射与 SSE**

`http-utils.js` 固定 `readJson(req)` 上限 16 KiB，超限抛 `PAYLOAD_TOO_LARGE`；`getBearer(req)` 只接受一个 `Bearer <token>`；`sendJson` 默认不缓存。错误状态映射：`INVALID_CONFIG/INVALID_JSON → 400`，认证缺失或错误 → 401，权限错误 → 403，房间不存在 → 404，`STALE_STATE/NOT_YOUR_TURN/MATCH_FINISHED → 409`，`ILLEGAL_ACTION → 422`，存储错误 → 500。统一错误 envelope 为 `{ ok: false, error: { code, message, details } }`。行动路由对 `STALE_STATE/NOT_YOUR_TURN/ILLEGAL_ACTION/MATCH_FINISHED` 额外调用 `getState(id, playerToken)`，在响应中加入最新 `state`，使 MCP 和 bot 无需猜测如何恢复。

```js
// server/sse.js
export class SseHub {
  constructor() { this.clients = new Map(); }
  add(matchId, req, res, initialState) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    res.write(`id: ${initialState.version}\ndata: ${JSON.stringify(initialState)}\n\n`);
    if (!this.clients.has(matchId)) this.clients.set(matchId, new Set());
    this.clients.get(matchId).add(res);
    req.on("close", () => this.clients.get(matchId)?.delete(res));
  }
  publish(matchId, state) {
    for (const res of this.clients.get(matchId) || []) res.write(`id: ${state.version}\ndata: ${JSON.stringify(state)}\n\n`);
  }
}
```

心跳每 15 秒向所有客户端写 `: ping\n\n`，计时器 `unref()`，关闭 app 时清理。

- [ ] **Step 4: 实现全部路由、静态白名单与 CLI**

路由必须精确实现：

| 方法与路径 | 调用和返回 |
|---|---|
| `POST /api/matches` | `resolveMatchConfig` → `service.create` → 201 |
| `POST /api/matches/:id/join` | 玩家 Bearer + `{ name?, clientKind? }` → 玩家视角状态 |
| `GET /api/matches/:id/state` | 可选玩家 Bearer → 公共或玩家视角状态 |
| `GET /api/matches/:id/setup` | 管理员 Bearer → `matchId + playerTokens + mcp`，其中 `mcp` 由 `buildAgentSetup` 生成 |
| `POST /api/matches/:id/actions` | 玩家 Bearer + `expectedVersion/action` → 新玩家视角状态 |
| `POST /api/matches/:id/abort` | 管理员 Bearer → 最终状态 |
| `GET /api/matches/:id/events` | `SseHub.add` |
| `GET /api/matches/:id/record` | `service.getRecord`，不含令牌 |

请求体采用白名单：join 只允许 `name/clientKind`，actions 外层只允许 `expectedVersion/action`，且 `expectedVersion` 必须是非负整数；多余字段返回 400。行动对象内部的精确形状由 Task 5 再次校验。

`buildAgentSetup` 返回：

```js
{
  command: process.execPath,
  args: [path.resolve("mcp/index.js"), "--url", `http://${request.headers.host}`]
}
```

因此 `setup` 响应的 `mcp` 字段直接传给 `buildMcpConfig(setup.mcp)`；`playerTokens` 只用于对应席位提示词，不能把管理员令牌放入 MCP 配置。

静态服务仅允许 `/`（映射 `web/index.html`）、`/web/*.js|css|html` 和 `/core/*.js`；拒绝解码后的 `..`、反斜杠、目录访问和其他扩展。MIME 至少覆盖 HTML、JS、CSS、SVG、PNG。

`server/index.js` 使用 `util.parseArgs`，支持：

```bash
npm.cmd run dev -- --host 127.0.0.1 --port 7100
```

端口必须是 `1..65535` 的整数；启动成功输出 `Ball Chess listening on http://<host>:<port>`。`createApp` 将 `service.update` 事件转发给 `SseHub.publish`。

- [ ] **Step 5: 运行 HTTP 与全量回归**

Run: `npm.cmd test`
Expected: 全部 PASS；每个测试在 `t.after` 关闭 server 和 SSE，无句柄导致测试挂起。

- [ ] **Step 6: 提交**

```bash
git add server tests/server/http.test.js
git commit -m "feat: expose local match API"
```

---

### Task 9: 无依赖程序 bot 与双客户端端到端对战

**Files:**
- Create: `examples/bot.js`
- Test: `tests/e2e/bots.test.js`

**Interfaces:**
- Consumes: Task 8 的真实 HTTP API。
- Produces: `runBot({ baseUrl, matchId, token, strategy, seed, pollMs })`；CLI 支持 `--url --match --token --strategy --seed --poll-ms`。
- `strategy` 为 `greedy | random`；返回最终公共状态。

- [ ] **Step 1: 写两个不同策略客户端的失败端到端测试**

启动真实 app 和房间，两个客户端都使用 `maxPlies = 40`：

```js
const created = await fetch(`${baseUrl}/api/matches`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ maxPlies: 40 })
}).then(async (response) => {
  assert.equal(response.status, 201);
  return response.json();
});
const [leftResult, rightResult] = await Promise.all([
  runBot({ baseUrl, matchId: created.matchId, token: created.playerTokens.left, strategy: "greedy", seed: 1, pollMs: 5 }),
  runBot({ baseUrl, matchId: created.matchId, token: created.playerTokens.right, strategy: "random", seed: 2, pollMs: 5 })
]);
assert.equal(leftResult.status, "finished");
assert.equal(rightResult.status, "finished");
assert.ok(leftResult.plies > 0);
assert.ok(leftResult.plies <= 40);
assert.deepEqual(leftResult.result, rightResult.result);
```

测试超时设为 10 秒，并在 `t.after` 关闭服务器。

- [ ] **Step 2: 验证失败**

Run: `node --test tests/e2e/bots.test.js`
Expected: FAIL，提示 `examples/bot.js` 不存在。

- [ ] **Step 3: 实现可导入也可命令行运行的 bot**

核心循环必须直接复用服务端 `legalActions`，不自行判断墙或路径：

```js
export async function runBot({ baseUrl, matchId, token, strategy = "greedy", seed = 1, pollMs = 200 }) {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const request = async (suffix, options = {}) => {
    const response = await fetch(`${baseUrl}${suffix}`, { ...options, headers: { ...headers, ...options.headers } });
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error.message), { code: body.error.code });
    return body;
  };
  await request(`/api/matches/${matchId}/join`, { method: "POST", body: JSON.stringify({ clientKind: "bot", name: strategy }) });
  let randomState = seed >>> 0;
  const random = () => ((randomState = (1664525 * randomState + 1013904223) >>> 0) / 0x100000000);
  for (;;) {
    const state = await request(`/api/matches/${matchId}/state`);
    if (state.status === "finished") return state;
    if (state.yourTurn) {
      let action;
      if (strategy === "greedy") action = state.legalActions.find((a) => a.type === "move" && a.direction === "up") || state.legalActions[0];
      else action = state.legalActions[Math.floor(random() * state.legalActions.length)];
      if (!action) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        continue;
      }
      try {
        await request(`/api/matches/${matchId}/actions`, {
          method: "POST",
          body: JSON.stringify({ expectedVersion: state.version, action })
        });
      } catch (error) {
        if (!["STALE_STATE", "NOT_YOUR_TURN", "MATCH_FINISHED"].includes(error.code)) throw error;
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}
```

CLI 使用 `util.parseArgs` 读取参数，主模块判断采用 `import.meta.url === pathToFileURL(process.argv[1]).href`；结束时 `console.log(JSON.stringify(result))`，异常时写 stderr 并设 `process.exitCode = 1`。

- [ ] **Step 4: 运行端到端测试**

Run: `node --test tests/e2e/bots.test.js`
Expected: 两个独立客户端完成同一局，结果一致，PASS 且不超时。

- [ ] **Step 5: 提交**

```bash
git add examples/bot.js tests/e2e/bots.test.js
git commit -m "feat: add programmatic battle client"
```

---

### Task 10: MCP stdio 四工具与两个独立客户端

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `mcp/ascii.js`, `mcp/session.js`, `mcp/tools.js`, `mcp/index.js`
- Test: `tests/mcp/ascii.test.js`, `tests/mcp/mcp.test.js`

**Interfaces:**
- Consumes: Task 8 API、`listLegalActions` 产生的公共/玩家状态。
- Produces: `toAscii(state)`, `class AgentSession`, `TOOL_DEFINITIONS`, `handleTool(name, args, session)`。
- MCP 工具名固定为 `join_match`, `get_match_state`, `wait_for_turn`, `submit_action`。

- [ ] **Step 1: 写 ASCII 与工具 schema 失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../../core/state.js";
import { toAscii } from "../../mcp/ascii.js";
import { TOOL_DEFINITIONS } from "../../mcp/tools.js";

test("ascii shows both seats and never contains credentials", () => {
  const text = toAscii(createGame());
  assert.ok(text.includes("L"));
  assert.ok(text.includes("R"));
  assert.ok(!text.includes("Token"));
});

test("tool surface stays at the approved four tools", () => {
  assert.deepEqual(TOOL_DEFINITIONS.map((tool) => tool.name), [
    "join_match", "get_match_state", "wait_for_turn", "submit_action"
  ]);
  const wait = TOOL_DEFINITIONS.find((tool) => tool.name === "wait_for_turn");
  assert.equal(wait.inputSchema.properties.timeoutSeconds.maximum, 15);
});
```

- [ ] **Step 2: 验证失败**

Run: `node --test tests/mcp/ascii.test.js`
Expected: FAIL，提示 MCP 模块不存在。

- [ ] **Step 3: 实现 ASCII、HTTP/SSE 会话和工具分发**

`toAscii` 从顶行到底行输出，`L/R` 表示席位，`.` 表示空格；使用 `buildBlockedEdges` 在相邻格之间输出 `|` 或 `-`。它只读取公共棋盘字段。

`AgentSession` 固定一个 `baseUrl`，`join(matchId, token, name)` 后保存会话；不同房间或席位再次加入抛 `ALREADY_JOINED`，相同凭据重复加入允许。`getState` 返回带 `ascii` 的玩家状态。`submitAction(expectedVersion, action)` 把 HTTP 错误转换为 `{ ok: false, error, state }`，成功返回 `{ ok: true, state }`。

`waitForTurn(timeoutSeconds = 10)`：先读取状态，若已轮到或已结束立即返回；否则打开该房间 SSE，逐条解析 `data:` 快照，再用玩家令牌读取私有状态。单次等待最多 `Math.min(15, timeoutSeconds)` 秒，SSE 提前断开时在剩余时间内重连；到期返回 `{ waiting: true, state }`，轮到或结束返回 `{ waiting: false, state }`。 AbortController 和 reader 必须在 `finally` 中清理。

四个工具的 JSON Schema：

```js
export const TOOL_DEFINITIONS = [
  {
    name: "join_match",
    description: "Join one Ball Chess seat",
    inputSchema: {
      type: "object",
      required: ["matchId", "playerToken"],
      properties: {
        matchId: { type: "string", minLength: 1 },
        playerToken: { type: "string", minLength: 1 },
        name: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "get_match_state",
    description: "Get JSON state, ASCII board and legal actions",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "wait_for_turn",
    description: "Wait until your turn or game end; waiting timeout is not a game error",
    inputSchema: {
      type: "object",
      properties: { timeoutSeconds: { type: "integer", minimum: 1, maximum: 15, default: 10 } },
      additionalProperties: false
    }
  },
  {
    name: "submit_action",
    description: "Submit an expected version and one legal action",
    inputSchema: {
      type: "object",
      required: ["expectedVersion", "action"],
      properties: {
        expectedVersion: { type: "integer", minimum: 0 },
        action: {
          type: "object",
          required: ["type"],
          properties: {
            type: { enum: ["move", "place_wall"] },
            direction: { enum: ["up", "down", "left", "right"] },
            orientation: { enum: ["h", "v"] },
            x: { type: "integer" },
            y: { type: "integer" }
          },
          additionalProperties: false
        }
      },
      additionalProperties: false
    }
  }
];
```

`handleTool` 用 `switch (name)` 精确映射四个工具，未知工具抛 `UNKNOWN_TOOL`。每个结果同时返回 `structuredContent` 和 `content: [{ type: "text", text: JSON.stringify(result) }]`，使大模型和测试客户端都能读取。

- [ ] **Step 4: 运行纯模块测试**

Run: `node --test tests/mcp/ascii.test.js`
Expected: 2 个测试 PASS。

- [ ] **Step 5: 安装锁定版本 SDK 并写 stdio 失败测试**

Run: `npm.cmd install --save-exact @modelcontextprotocol/sdk@1.32.2`
Expected: `package.json` 只新增这一项直接依赖，生成 `package-lock.json`。

使用官方 `Client` 与 `StdioClientTransport` 启动 `mcp/index.js`，连接真实 HTTP app。核心调用如下，`created` 来自与 Task 9 相同的真实创建请求：

```js
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function connectAgent(name) {
  const client = new Client({ name, version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("mcp/index.js"), "--url", baseUrl],
    env: { ...process.env }
  });
  await client.connect(transport);
  return client;
}
const left = await connectAgent("test-left");
const right = await connectAgent("test-right");
await left.callTool({ name: "join_match", arguments: { matchId: created.matchId, playerToken: created.playerTokens.left } });
await right.callTool({ name: "join_match", arguments: { matchId: created.matchId, playerToken: created.playerTokens.right } });
const played = await left.callTool({
  name: "submit_action",
  arguments: { expectedVersion: 2, action: { type: "move", direction: "up" } }
});
assert.equal(played.structuredContent.ok, true);
const viewed = await right.callTool({ name: "get_match_state", arguments: {} });
assert.deepEqual(viewed.structuredContent.players.left.position, [2, 1]);
const rejected = await right.callTool({
  name: "submit_action",
  arguments: { expectedVersion: 2, action: { type: "move", direction: "up" } }
});
assert.equal(rejected.structuredContent.ok, false);
assert.equal(rejected.structuredContent.state.plies, 1);
await left.close();
await right.close();
```

测试在 `t.after` 中确保两个 client 和 HTTP server 都关闭，避免失败时遗留子进程。

- [ ] **Step 6: 运行 stdio 测试，确认入口尚未实现**

Run: `node --test tests/mcp/mcp.test.js`
Expected: FAIL，提示 `mcp/index.js` 不存在或无法连接。

- [ ] **Step 7: 实现官方低层 Server 入口**

使用以下 SDK 接口，不额外导入 zod：

```js
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "ball-chess", version: "0.1.0" },
  { capabilities: { tools: {} } }
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    return await handleTool(params.name, params.arguments || {}, session);
  } catch (error) {
    const result = { ok: false, error: { code: error.code || "MCP_ERROR", message: error.message } };
    return { isError: true, structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
  }
});
await server.connect(new StdioServerTransport());
```

`--url` 为必填参数，默认不允许连接非本机 HTTP 地址；会话只在内存保存，日志不得打印令牌。

- [ ] **Step 8: 运行 MCP 与全量测试**

Run: `npm.cmd test`
Expected: 两个独立 stdio 客户端成功对战并处理错误，其他测试无回归。

- [ ] **Step 9: 提交**

```bash
git add package.json package-lock.json mcp tests/mcp
git commit -m "feat: add MCP agent adapter"
```

---

### Task 11: SVG 棋盘几何、现代拟物渲染与页面骨架

**Files:**
- Create: `web/board-geometry.js`, `web/board.js`, `web/index.html`, `web/styles.css`
- Test: `tests/web/board-geometry.test.js`

**Interfaces:**
- Consumes: 公共状态与 `legalActions`。
- Produces: `CELL_SIZE = 24`, `cellCenter(position)`, `wallFaces(wall)`, `renderBoard(container, state, options)`。
- `wallFaces` 返回 `{ top, side }` 两个 SVG rect 几何；`renderBoard` 的 options 为 `{ legalActions, mode, orientation, interactive, onAction }`。

- [ ] **Step 1: 写坐标和最小净空失败测试**

```js
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
```

- [ ] **Step 2: 验证失败**

Run: `node --test tests/web/board-geometry.test.js`
Expected: FAIL，提示几何模块不存在。

- [ ] **Step 3: 实现统一 SVG 几何**

```js
// web/board-geometry.js
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
      top: { x, y: gridY - 2.5, width: 48, height: 4.5, rx: 2.25 },
      side: { x, y: gridY - 1, width: 48, height: 4.5, rx: 2.25 }
    };
  }
  const gridX = GRID_X + wall.x * CELL_SIZE;
  const y = GRID_Y + (11 - wall.y) * CELL_SIZE;
  return {
    top: { x: gridX - 2.5, y, width: 4.5, height: 48, rx: 2.25 },
    side: { x: gridX - 1, y, width: 4.5, height: 48, rx: 2.25 }
  };
}
```

所有球、墙、阴影都从上述常量计算，禁止在渲染器中另写球径或墙厚。

- [ ] **Step 4: 运行几何测试**

Run: `node --test tests/web/board-geometry.test.js`
Expected: 3 个测试 PASS，横墙相邻净空明确为 `1px`。

- [ ] **Step 5: 实现 SVG 渲染、语义页面和现代材质**

`renderBoard` 使用 `document.createElementNS("http://www.w3.org/2000/svg", tag)`，按网格 → 目标区 → 墙影 → 墙侧面 → 墙顶面 → 球影 → 球 → 合法预览的顺序重绘。每个 wall 使用 `wallFaces`，每个 pawn 使用 `cellCenter` 和 `BALL_RADIUS`。

合法移动显示可点击圆点；合法墙预览使用半透明 rect。点击时分别产生 `{ type: "move", direction }` 或 `{ type: "place_wall", orientation, x, y }`。`interactive = false` 时不注册行动 handler。

`index.html` 固定这些后续控制 ID：`create-form`, `match-id`, `board`, `status`, `sidebar`, `agent-setup`, `mode-move`, `mode-wall`, `wall-orientation`, `action-log`, `result`, `error`, `copy-mcp`, `copy-prompt`。加载 `<script type="module" src="/web/app.js"></script>`。

CSS 变量直接使用确认值：

```css
:root {
  --page: #e9edea;
  --surface: #f5f7f4;
  --grid: #d4dbd6;
  --red: #d45a62;
  --red-dark: #a83d47;
  --blue: #5689b6;
  --blue-dark: #315e88;
  --mint: #b9e5d1;
  --ink: #303736;
  --ball-radius: 7.5;
  --wall-thickness: 4.5;
}
```

实现近白哑光棋盘、缎面球、圆角漆面墙、极淡薄荷目标区。侧栏和按钮保持平面；动画限制在 160–220ms，并在 `@media (prefers-reduced-motion: reduce)` 中取消非必要动画。桌面为棋盘+侧栏，窄于 760px 时侧栏移到下方。

- [ ] **Step 6: 做静态检查并提交**

Run: `node --check web/board.js && node --check web/board-geometry.js && npm.cmd test`
Expected: 无语法错误，所有自动测试 PASS；此任务不进行最终浏览器验收，因为 `app.js` 在下一任务完成。

```bash
git add web tests/web/board-geometry.test.js
git commit -m "feat: render modern tactile board"
```

---

### Task 12: 浏览器对局控制、观战和 Agent 接入信息

**Files:**
- Create: `web/api.js`, `web/state-view.js`, `web/agent-instructions.js`, `web/app.js`
- Test: `tests/web/api.test.js`, `tests/web/state-view.test.js`, `tests/web/agent-instructions.test.js`

**Interfaces:**
- Consumes: Task 8 API、Task 11 页面 ID 和 `renderBoard`。
- Produces: `class MatchApi`, `shouldAcceptSnapshot(current, incoming)`, `canInteract(state)`, `buildMcpConfig(setup)`, `buildAgentPrompt({ matchId, token, seat })`。

- [ ] **Step 1: 写 API、版本和提示词失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { shouldAcceptSnapshot, canInteract, wallsRemaining } from "../../web/state-view.js";
import { buildAgentPrompt, buildMcpConfig } from "../../web/agent-instructions.js";

test("snapshots cannot roll the board backward", () => {
  assert.equal(shouldAcceptSnapshot({ version: 4 }, { version: 3 }), false);
  assert.equal(shouldAcceptSnapshot({ version: 4 }, { version: 4 }), true);
  assert.equal(shouldAcceptSnapshot(null, { version: 0 }), true);
});

test("spectators cannot act and unlimited walls display infinity", () => {
  assert.equal(canInteract({ status: "playing", yourTurn: false }), false);
  assert.equal(wallsRemaining({ config: { wallLimit: null }, players: { left: { wallsUsed: 9 } } }, "left"), "∞");
});

test("agent setup contains only the requested seat credential", () => {
  const prompt = buildAgentPrompt({ matchId: "m_test", token: "left_secret", seat: "left" });
  assert.ok(prompt.includes("wait_for_turn"));
  assert.ok(prompt.includes("left_secret"));
  assert.ok(!prompt.includes("adminToken"));
  const config = buildMcpConfig({ command: "node", args: ["mcp/index.js", "--url", "http://127.0.0.1:7100"] });
  assert.equal(config.mcpServers["ball-chess"].command, "node");
});
```

`api.test.js` 注入 fake `fetch`，断言 `submitAction` 发送 Bearer、`expectedVersion` 和原始 action；非 2xx 时抛出带 `code`, `details`, `state` 的 `ApiError`。

- [ ] **Step 2: 验证失败**

Run: `node --test tests/web/api.test.js tests/web/state-view.test.js tests/web/agent-instructions.test.js`
Expected: FAIL，提示对应浏览器纯模块不存在。

- [ ] **Step 3: 实现浏览器纯模块**

```js
// web/state-view.js
export function shouldAcceptSnapshot(current, incoming) {
  return !current || incoming.version >= current.version;
}
export function canInteract(state) {
  return Boolean(state && state.status === "playing" && state.yourTurn && !state.result);
}
export function wallsRemaining(state, seat) {
  if (state.config.wallLimit === null) return "∞";
  return String(Math.max(0, state.config.wallLimit - state.players[seat].wallsUsed));
}

// web/agent-instructions.js
export function buildMcpConfig(setup) {
  return { mcpServers: { "ball-chess": { command: setup.command, args: [...setup.args] } } };
}
export function buildAgentPrompt({ matchId, token, seat }) {
  return [
    `Join Ball Chess match ${matchId} as ${seat} using playerToken ${token}.`,
    "Use join_match once, then repeat wait_for_turn until yourTurn or finished.",
    "Choose only from legalActions and call submit_action with the latest version.",
    "On STALE_STATE or ILLEGAL_ACTION, read the returned state and choose again.",
    "Continue until result is not null; do not try to act for the other seat."
  ].join("\n");
}
```

`MatchApi` 提供 `create(config)`, `join(id, token, profile)`, `state(id, token?)`, `setup(id, adminToken)`, `submitAction(id, token, expectedVersion, action)`, `abort(id, adminToken)`, `events(id)`。`events` 返回注入的 `eventSourceFactory` 创建的 EventSource，便于测试；浏览器默认使用原生 EventSource。

- [ ] **Step 4: 运行纯模块测试**

Run: `node --test tests/web/api.test.js tests/web/state-view.test.js tests/web/agent-instructions.test.js`
Expected: 全部 PASS。

- [ ] **Step 5: 实现页面控制器**

`app.js` 按以下明确数据流连接已有模块：

```js
const api = new MatchApi({ baseUrl: "", eventSourceFactory: (url) => new EventSource(url) });
const boardElement = document.getElementById("board");
const statusElement = document.getElementById("status");
const sidebarElement = document.getElementById("sidebar");
const actionLogElement = document.getElementById("action-log");
const resultElement = document.getElementById("result");
const errorElement = document.getElementById("error");
let activeMatchId = null;
let activePlayerToken = null;
let currentState = null;
let interactionMode = "move";
let wallOrientation = "h";
let actionPending = false;

function renderStatus(state) {
  statusElement.textContent = `${state.status} · ${state.currentPlayer} · ${state.plies}/${state.config.maxPlies}`;
  resultElement.textContent = state.result ? `${state.result.kind}: ${state.result.reason}` : "";
}
function renderSidebar(state) {
  sidebarElement.dataset.status = state.status;
  actionLogElement.textContent = state.lastAction ? `${state.lastAction.player}: ${state.lastAction.action.type}` : "No actions";
}
function showError(message) {
  errorElement.textContent = message;
}

async function refreshState() {
  const next = await api.state(activeMatchId, activePlayerToken || undefined);
  if (shouldAcceptSnapshot(currentState, next)) {
    currentState = next;
    renderBoard(boardElement, currentState, {
      legalActions: currentState.legalActions || [],
      mode: interactionMode,
      orientation: wallOrientation,
      interactive: canInteract(currentState) && !actionPending,
      onAction: submitBoardAction
    });
    renderStatus(currentState);
    renderSidebar(currentState);
  }
}

async function submitBoardAction(action) {
  if (!canInteract(currentState) || actionPending) return;
  actionPending = true;
  try {
    const next = await api.submitAction(activeMatchId, activePlayerToken, currentState.version, action);
    currentState = next;
    await refreshState();
  } catch (error) {
    showError(error.message);
    if (["STALE_STATE", "NOT_YOUR_TURN", "ILLEGAL_ACTION"].includes(error.code)) await refreshState();
  } finally {
    actionPending = false;
    await refreshState();
  }
}
```

创建表单支持 `left | right | spectate`、有限/无限墙、maxPlies、turnTimeoutMs 和先手。创建后把非敏感席位选择与凭据 `{ matchId, adminToken, seat }` 保存到 `localStorage["ballChess.activeMatch"]`；人类席位使用对应玩家令牌 join，观战不持有玩家令牌。页面加载时若存在本地管理凭据，通过 `setup` 恢复两个 agent 的接入信息；若 `seat` 是人类席位，再用返回的对应玩家令牌重连，不请求公网。

SSE `onmessage` 解析公共快照；若版本更新，人类席位再拉取私有状态以取得合法行动。`onerror` 时立即 `refreshState`，并依赖 EventSource 自动重连。倒计时每 250ms 根据 `turnDeadlineAt` 更新，不自行修改权威结果。

复制按钮分别输出 `buildMcpConfig(setup.mcp)` 的格式化 JSON 和当前席位的 `buildAgentPrompt`；切换席位只切换展示令牌，不把另一席位令牌用于行动。管理员中止使用独立确认按钮。所有玩家显示名和错误文本通过 `textContent` 写入 DOM，不使用 `innerHTML`。

- [ ] **Step 6: 做浏览器联调前的全量检查**

Run: `npm.cmd test && node --check web/app.js && node --check web/api.js`
Expected: 自动测试全部 PASS，无语法错误。

- [ ] **Step 7: 提交**

```bash
git add web tests/web
git commit -m "feat: connect browser matches and agents"
```

---

### Task 13: 使用文档、真实浏览器验收与最终清理

**Files:**
- Create: `README.md`
- Modify: 仅当验证发现明确缺陷时修改对应实现和测试
- Test: 全量自动测试、真实浏览器和临时服务验证

**Interfaces:**
- Consumes: 前 12 个任务的全部交付。
- Produces: 可启动、可预览、可接入 bot/MCP 的完整首版。

- [ ] **Step 1: 编写启动与三种客户端使用说明**

README 必须包含：

1. Node 22+、`npm.cmd install`、测试和启动命令。
2. 默认地址 `http://127.0.0.1:7100`，以及 `npm.cmd run dev -- --host 127.0.0.1 --port 7100`。
3. 人类创建/加入/观战流程。
4. bot 命令：

```bash
node examples/bot.js --url http://127.0.0.1:7100 --match "$MATCH_ID" --token "$LEFT_TOKEN" --strategy greedy
```

5. 从页面复制的 MCP 配置示例，明确每个 agent 使用独立 stdio 进程和独立席位令牌。
6. 默认无限墙、300 手和可选回合超时；非法行动不消耗回合。
7. `data/matches/` 含私密令牌，不能分享；导出 record 已去令牌。
8. 未验证所有第三方 agent 厂商，只承诺标准 MCP 和本文测试过的客户端。

- [ ] **Step 2: 运行全部自动检查**

```bash
npm.cmd test
node --check server/index.js
node --check mcp/index.js
node --check web/app.js
git diff --check
```

Expected: 测试为 `0 fail`，四个语法检查无输出，`git diff --check` 无空白错误。

- [ ] **Step 3: 启动临时服务做真实浏览器验证**

Run: `npm.cmd run dev -- --host 127.0.0.1 --port 7100`
Expected: 控制台输出 `Ball Chess listening on http://127.0.0.1:7100`。

按顺序验证并记录结果：

- 创建人类对左侧局，起点为 `(2,0)/(6,0)`，顶边任意格获胜。
- 四向移动、占格不可进入、无跳跃、横竖墙预览、两块连续墙和非法交叉提示。
- 放墙后双方路径校验；无限墙显示 `∞`，有限墙用完后不再出现放墙行动。
- 双方为 bot 时页面只能观战，SSE 能持续更新；刷新后状态一致。
- 关闭并重启服务后恢复对局；导出 record 不含令牌。
- 两个 stdio MCP client 加入不同席位并完成一局，错误版本不会重复行动。
- 球和墙保持 Task 11 的尺寸，相邻时看到明确空隙；连续墙仍能辨认接缝。
- 页面没有木纹、厚黑阴影、镜面大高光或立体按钮；窄屏下侧栏移到棋盘下方。
- `prefers-reduced-motion` 下无多余动画；操作状态不只靠红蓝颜色表达。

若发现缺陷，回到对应模块先添加失败测试，再修复并重跑本步骤；不得只改视觉效果而不检查几何净空。

- [ ] **Step 4: 停止临时服务并确认没有遗留进程**

在启动终端按 Ctrl+C。确认 7100 不再响应，且没有测试启动的 MCP/bot 子进程。不得使用 `nohup`、`disown`、`setsid`、后台 `&` 或其他独立驻留方式。

最终交付预览时给出项目根目录 `E:\My_project\ball_chess` 和 `[Ball Chess](http://localhost:7100/)`，由 Kimi Work 按预览生命周期重新启动服务。

- [ ] **Step 5: 提交文档与最终验证修正**

```bash
git add README.md
git commit -m "docs: add local and agent usage"
git status --short
```

若验证有实现修正，把对应实现和测试一并加入该提交前的独立修复提交。`git status` 可以保留用户参考截图 `quoridor-reference-20261024.png` 为未跟踪文件，但不得有其他未提交实现、测试、临时对局或 `.tmp/` 内容。

---

## Execution Notes

- 任务顺序就是依赖顺序；不要在核心规则未通过时并行写 MCP 或前端。
- 每个任务先运行该任务测试，再运行全量 `npm.cmd test`，最后做该任务提交。
- 真实 Kimi/Claude/Codex 的可用性取决于本机安装和配置；它们不是自动测试的替代条件。首版用标准 MCP 和两个独立测试客户端验证协议。
- 若官方 SDK 的已锁定版本 `1.32.2` 与本机 Node 24 出现兼容错误，先记录错误并停在 Task 10，不静默升级或更换协议。
