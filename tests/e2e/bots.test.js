import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { MatchStore } from "../../server/store.js";
import { MatchService } from "../../server/match-service.js";
import { createApp } from "../../server/app.js";
import { runBot } from "../../examples/bot.js";

test("greedy and random clients finish one authoritative HTTP match", { timeout: 10000 }, async (t) => {
  await mkdir(path.join(process.cwd(), ".tmp"), { recursive: true });
  const directory = await mkdtemp(path.join(process.cwd(), ".tmp", "bots-"));
  const service = await MatchService.open({ store: new MatchStore({ directory }) });
  const server = createApp({ service, webRoot: path.resolve("web"), coreRoot: path.resolve("core") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    const closed = new Promise((resolve) => server.once("close", resolve));
    server.close();
    server.closeAllConnections();
    await closed;
    service.close();
    await rm(directory, { recursive: true, force: true });
  });

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
});
