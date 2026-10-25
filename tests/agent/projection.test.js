import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../../core/state.js";
import { describeMatchRules, describeWallBudgets } from "../../core/rule-description.js";
import { expandWallRanges, projectState, renderAgentResult } from "../../agent/projection.js";

test("rule facts preserve the actual match configuration", () => {
  const game = createGame({ wallLimit: 6, maxPlies: 80, turnTimeoutMs: 30_000, firstPlayer: "right" });
  assert.deepEqual(describeMatchRules(game.config), {
    board: { width: 9, height: 13, origin: "bottom-left" },
    starts: { left: [2, 0], right: [6, 0] },
    goals: { left: 12, right: 12 },
    turn: { actions: 1, choices: ["move", "place_wall"], passAllowed: false },
    movement: {
      directions: ["up", "down", "left", "right"],
      distance: 1,
      diagonalAllowed: false,
      jumpAllowed: false,
      occupiedCellAllowed: false
    },
    wallPlacement: {
      edges: 2,
      overlapAllowed: false,
      crossingAllowed: false,
      endpointConnectionAllowed: true,
      tJunctionAllowed: true,
      preservePathFor: ["left", "right"]
    },
    outcome: { maxPliesResult: "draw" },
    firstPlayer: "right",
    maxPlies: 80,
    turnTimeoutMs: 30_000,
    wallLimit: 6
  });
  assert.deepEqual(describeWallBudgets(game), {
    mode: "finite",
    limit: 6,
    left: { used: 0, remaining: 6 },
    right: { used: 0, remaining: 6 }
  });
});

test("unlimited walls expose usage without invented remaining counts", () => {
  const game = createGame({ wallLimit: null });
  game.players.left.wallsUsed = 3;
  assert.deepEqual(describeWallBudgets(game), {
    mode: "unlimited",
    left: { used: 3 },
    right: { used: 0 }
  });
});

test("projection preserves actions, adds a compact summary, and never adds credentials", () => {
  const legalActions = [
    { type: "move", direction: "up" },
    { type: "place_wall", orientation: "h", x: 1, y: 2 }
  ];
  const projected = projectState({
    ...createGame(), matchId: "m_test", version: 3, status: "playing", yourPlayer: "left", yourTurn: true,
    legalActions
  });
  assert.deepEqual(projected.legalActionList, legalActions);
  assert.deepEqual(projected.legalActions, {
    moves: ["up"],
    walls: { h: [[1, 2]], v: [] },
    wallRanges: { h: [{ y: 2, fromX: 1, toX: 1 }], v: [] }
  });
  assert.match(projected.ascii, /L/);
  assert.ok(!JSON.stringify(projected).includes("playerToken"));
});

test("decision projection uses perspective aliases without rotating absolute coordinates", () => {
  const base = {
    ...createGame({ wallLimit: 6 }), matchId: "m_perspective", version: 3, status: "playing",
    yourTurn: true, legalActions: [
      { type: "move", direction: "up" },
      { type: "move", direction: "right" },
      { type: "place_wall", orientation: "h", x: 1, y: 2 },
      { type: "place_wall", orientation: "v", x: 3, y: 4 }
    ]
  };
  const left = projectState({ ...base, yourPlayer: "left" });
  assert.deepEqual(left.decision.actor.you, {
    seat: "left", color: "red", position: [2, 0], goal: { axis: "y", value: 12 },
    walls: { used: 0, remaining: 6 }
  });
  assert.equal(left.decision.actor.opponent.seat, "right");
  assert.deepEqual(left.decision.legal.moves, [
    { id: "move:up", action: { type: "move", direction: "up" }, to: [2, 1] },
    { id: "move:right", action: { type: "move", direction: "right" }, to: [3, 0] }
  ]);
  assert.deepEqual(left.decision.legal.walls.h, {
    count: 1,
    idFormat: "wall:h:<x>:<y>",
    ranges: [{ y: 2, fromX: 1, toX: 1 }]
  });
  assert.deepEqual(left.decision.legal.walls.v, {
    count: 1,
    idFormat: "wall:v:<x>:<y>",
    ranges: [{ y: 4, fromX: 3, toX: 3 }]
  });

  const right = projectState({ ...base, yourPlayer: "right" });
  assert.equal(right.decision.actor.you.seat, "right");
  assert.deepEqual(right.decision.actor.you.position, [6, 0]);
  assert.equal(right.decision.actor.opponent.seat, "left");
  assert.deepEqual(right.decision.legal.moves[0].to, [6, 1]);
});

test("decision projection defines coordinates and both wall directions exactly", () => {
  const projected = projectState({
    ...createGame(), matchId: "m_coordinates", version: 2, status: "playing",
    yourPlayer: "left", yourTurn: true, legalActions: []
  });
  assert.deepEqual(projected.decision.coordinates, {
    origin: [0, 0],
    xIncreases: "right",
    yIncreases: "up toward the goal row",
    cellBounds: { x: [0, 8], y: [0, 12] },
    walls: {
      h: "wall:h:x:y blocks (x,y-1)<->(x,y) and (x+1,y-1)<->(x+1,y)",
      v: "wall:v:x:y blocks (x-1,y)<->(x,y) and (x-1,y+1)<->(x,y+1)"
    }
  });
  assert.match(projected.ascii, /12\s/);
  assert.match(projected.ascii, /0 1 2 3 4 5 6 7 8/);
});

test("wall range compression is lossless across gaps and orientations", () => {
  const legalActions = [
    { type: "place_wall", orientation: "h", x: 0, y: 1 },
    { type: "place_wall", orientation: "h", x: 1, y: 1 },
    { type: "place_wall", orientation: "h", x: 3, y: 1 },
    { type: "place_wall", orientation: "v", x: 1, y: 0 }
  ];
  const projected = projectState({
    ...createGame({ wallLimit: 4, turnTimeoutMs: 30_000 }),
    matchId: "m_range", version: 7, status: "playing", yourPlayer: "left", yourTurn: true,
    turnDeadlineAt: 40_000, legalActions
  });
  assert.deepEqual(expandWallRanges(projected.legalActions.wallRanges), {
    h: [[0, 1], [1, 1], [3, 1]],
    v: [[1, 0]]
  });
  const text = renderAgentResult({ kind: "turn", state: projected });
  assert.match(text, /walls=finite limit=4 left used=0 remaining=4 right used=0 remaining=4/);
  assert.match(text, /deadline=40000/);
  assert.match(text, /walls\.h=y1:x0-1,x3/);
  assert.match(text, /wall:v:x:y blocks \(x-1,y\)<->\(x,y\)/);
});

test("agent text is compact and action-oriented", () => {
  const text = renderAgentResult({ kind: "turn", state: projectState({
    ...createGame(), matchId: "m_test", version: 4, status: "playing", yourPlayer: "left", yourTurn: true,
    turnDeadlineAt: null, legalActions: [{ type: "move", direction: "up" }]
  }) });
  assert.match(text, /TURN m_test v4 left/);
  assert.match(text, /moves=up/);
  assert.match(text, /move:up->\(2,1\)/);
  assert.match(text, /walls=unlimited left used=0 right used=0/);
  assert.ok(text.length < 1400);
});

test("finished text carries the authoritative outcome and forbids more actions", () => {
  const state = projectState({
    ...createGame(), matchId: "m_done", version: 12, status: "finished",
    yourPlayer: "left", yourTurn: false, turnDeadlineAt: null, legalActions: [],
    result: { kind: "win", winner: "left", reason: "reached_goal" }
  });
  const text = renderAgentResult({ kind: "finished", state });
  assert.match(text, /winner=left reason=reached_goal/);
  assert.match(text, /do not submit more actions/i);
});
