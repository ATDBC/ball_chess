import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MatchStore } from "../../server/store.js";
import { MatchService } from "../../server/match-service.js";
import { createApp } from "../../server/app.js";

test("two independent stdio MCP clients share a match and recover from stale actions", { timeout: 15000 }, async (t) => {
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

  async function connectAgent(name) {
    const client = new Client({ name, version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve("mcp/index.js"), "--url", baseUrl],
      env: { ...process.env }
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

  const created = await fetch(`${baseUrl}/api/matches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maxPlies: 40 })
  }).then((response) => response.json());
  const left = await connectAgent("test-left");
  const right = await connectAgent("test-right");
  const listed = await left.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name), ["join_match", "get_match_state", "wait_for_turn", "submit_action"]);
  await left.callTool({ name: "join_match", arguments: { matchId: created.matchId, playerToken: created.playerTokens.left } });
  await right.callTool({ name: "join_match", arguments: { matchId: created.matchId, playerToken: created.playerTokens.right } });
  const waiting = right.callTool({ name: "wait_for_turn", arguments: { timeoutSeconds: 3 } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const played = await left.callTool({
    name: "submit_action",
    arguments: { expectedVersion: 2, action: { type: "move", direction: "up" } }
  });
  assert.equal(played.structuredContent.ok, true);
  const awakened = await waiting;
  assert.equal(awakened.structuredContent.waiting, false);
  assert.equal(awakened.structuredContent.state.yourTurn, true);
  const viewed = await right.callTool({ name: "get_match_state", arguments: {} });
  assert.deepEqual(viewed.structuredContent.players.left.position, [2, 1]);
  assert.ok(viewed.structuredContent.ascii.includes("L"));
  const rejected = await right.callTool({
    name: "submit_action",
    arguments: { expectedVersion: 2, action: { type: "move", direction: "up" } }
  });
  assert.equal(rejected.structuredContent.ok, false);
  assert.equal(rejected.structuredContent.state.plies, 1);
});
