import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MatchStore } from "../../server/store.js";
import { MatchService } from "../../server/match-service.js";
import { createApp } from "../../server/app.js";

test("pre-bound stdio MCP clients recover their seats after process replacement", { timeout: 15000 }, async (t) => {
  await mkdir(path.join(process.cwd(), ".tmp"), { recursive: true });
  const directory = await mkdtemp(path.join(process.cwd(), ".tmp", "mcp-"));
  const service = await MatchService.open({ store: new MatchStore({ directory }) });
  const server = createApp({ service, webRoot: path.resolve("web"), coreRoot: path.resolve("core") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  t.after(async () => {
    await Promise.allSettled(clients.map((client) => client.close()));
    const closed = new Promise((resolve) => server.once("close", resolve));
    server.close();
    server.closeAllConnections();
    await closed;
    service.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function connectClient(name, args, env = process.env) {
    const client = new Client({ name, version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve("mcp/index.js"), "--url", baseUrl, ...args],
      env: { ...env }
    });
    try {
      await client.connect(transport);
      clients.push(client);
      return client;
    } catch (error) {
      await client.close().catch(() => {});
      throw error;
    }
  }

  const connectAgent = (name, matchId, playerToken) => connectClient(
    name,
    ["--match", matchId],
    { ...process.env, BALL_CHESS_PLAYER_TOKEN: playerToken }
  );

  const created = await fetch(`${baseUrl}/api/matches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config: { maxPlies: 40 } })
  }).then((response) => response.json());
  const setup = await fetch(`${baseUrl}/api/matches/${created.matchId}/setup`, {
    headers: { authorization: `Bearer ${created.adminToken}` }
  }).then((response) => response.json());
  const createInvitation = (seat) => fetch(`${baseUrl}/api/matches/${created.matchId}/invitations`, {
    method: "POST",
    headers: { authorization: `Bearer ${created.adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ seat })
  }).then((response) => response.json());
  const leftInvitation = await createInvitation("left");
  const manual = await connectClient("test-manual", []);
  const manualTools = await manual.listTools();
  assert.deepEqual(manualTools.tools.map((tool) => tool.name), [
    "join_by_invite", "set_ready", "get_match_state", "wait_for_turn", "submit_action"
  ]);
  const joined = await manual.callTool({ name: "join_by_invite", arguments: { code: leftInvitation.code } });
  assert.ok(!joined.content[0].text.includes(leftInvitation.code));
  assert.ok(!joined.content[0].text.includes(setup.playerTokens.left));
  const manualState = await manual.callTool({ name: "get_match_state", arguments: {} });
  assert.equal(manualState.structuredContent.state.yourPlayer, "left");
  await manual.close();
  const left = await connectAgent("test-left", created.matchId, setup.playerTokens.left);
  let right = await connectAgent("test-right", created.matchId, setup.playerTokens.right);
  const listed = await left.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name), ["set_ready", "get_match_state", "wait_for_turn", "submit_action"]);
  await left.callTool({ name: "set_ready", arguments: { ready: true } });
  await right.callTool({ name: "set_ready", arguments: { ready: true } });
  const waitingState = await right.callTool({ name: "get_match_state", arguments: {} });
  assert.equal(waitingState.structuredContent.state.status, "playing");
  assert.equal(waitingState.structuredContent.state.yourTurn, false);
  const waiting = right.callTool({ name: "wait_for_turn", arguments: {} });
  const leftBefore = await left.callTool({ name: "get_match_state", arguments: {} });
  const played = await left.callTool({
    name: "submit_action",
    arguments: { expectedVersion: leftBefore.structuredContent.state.version, action: { type: "move", direction: "up" } }
  });
  assert.equal(played.structuredContent.ok, true);
  const awakened = await waiting;
  assert.equal(awakened.structuredContent.kind, "turn");
  assert.equal(awakened.structuredContent.state.yourTurn, true);
  await right.close();
  right = await connectAgent("test-right-reconnected", created.matchId, setup.playerTokens.right);
  const viewed = await right.callTool({ name: "get_match_state", arguments: {} });
  assert.equal(viewed.structuredContent.state.yourPlayer, "right");
  assert.deepEqual(viewed.structuredContent.state.players.left.position, [2, 1]);
  assert.ok(viewed.structuredContent.state.ascii.includes("L"));
  const rejected = await right.callTool({
    name: "submit_action",
    arguments: { expectedVersion: viewed.structuredContent.state.version - 1, action: { type: "move", direction: "up" } }
  });
  assert.equal(rejected.structuredContent.ok, false);
  assert.equal(rejected.structuredContent.state.plies, 1);

  for (let turn = 0; turn < 40; turn += 1) {
    const leftState = await left.callTool({ name: "get_match_state", arguments: {} });
    if (leftState.structuredContent.state.status === "finished") break;
    const agent = leftState.structuredContent.state.yourTurn ? left : right;
    const current = leftState.structuredContent.state.yourTurn
      ? leftState
      : await right.callTool({ name: "get_match_state", arguments: {} });
    assert.ok(current.structuredContent.state.legalActions.moves.includes("up"));
    const next = await agent.callTool({
      name: "submit_action",
      arguments: { expectedVersion: current.structuredContent.state.version, action: { type: "move", direction: "up" } }
    });
    assert.equal(next.structuredContent.ok, true);
  }
  const final = await left.callTool({ name: "get_match_state", arguments: {} });
  assert.equal(final.structuredContent.state.status, "finished");
  assert.equal(final.structuredContent.state.plies, 23);
  assert.deepEqual(final.structuredContent.state.result, { kind: "win", winner: "left", reason: "reached_goal" });
});
