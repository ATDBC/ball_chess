import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

test("overlay declares a minimal Ball Chess preset", async () => {
  const source = await readFile(new URL("../../dsh/ball-chess.overlay.yml", import.meta.url), "utf8");
  assert.match(source, /name: '@deepseek-ai\/dsh-agent-preset'/);
  assert.match(source, /id: ball-chess/);
  assert.match(source, /name: 'ball-chess\/dsh\/plugin'/);
  assert.match(source, /name: 'ball-chess\/dsh\/compaction-plugin'/);
  assert.doesNotMatch(source, /name: '\.\//);
  assert.doesNotMatch(source, /file:\/\/\//);
  assert.doesNotMatch(source, /E:\//);
  assert.match(source, /name: '@deepseek-ai\/dsh-persona'/);
  assert.match(source, /complete: true/);
  assert.match(source, /rules 与 wallBudgets.*本局完整规则/);
  assert.match(source, /actionId/);
  assert.match(source, /get_match_record/);
  assert.doesNotMatch(source, /最短路径|胜率|推荐行动/);
  assert.doesNotMatch(source, /9×13|y=12/);
  for (const forbidden of ["tool-bash", "tool-pwsh", "tool-fs", "tool-browser", "tool-web", "tool-subagent", "tool-workflow", "tool-plugin-manager"]) {
    assert.ok(!source.includes(forbidden), `${forbidden} must not be mounted`);
  }
});

test("the project is a portable DSH bundle", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.dsh, { bundle: { patch: "./dsh/ball-chess.overlay.yml" } });
  assert.deepEqual(manifest.exports, {
    "./dsh/plugin": "./dsh/plugin.js",
    "./dsh/compaction-plugin": "./dsh/compaction-plugin.js"
  });
  assert.equal(manifest.engines.node, ">=24.9.0");
  assert.match(manifest.engines.dsh, /0\.2\.1/);
  assert.ok(manifest.peerDependencies["@deepseek-ai/dsh-compaction-basic"]);
  assert.ok(manifest.peerDependencies["@deepseek-ai/dsh-llm"]);
});

test("the preset plugin subpaths resolve through the installed package exports", async () => {
  const toolsUrl = import.meta.resolve("ball-chess/dsh/plugin");
  const compactionUrl = import.meta.resolve("ball-chess/dsh/compaction-plugin");
  const [toolsFile, compactionFile, toolsPlugin] = await Promise.all([
    stat(fileURLToPath(toolsUrl)),
    stat(fileURLToPath(compactionUrl)),
    import("ball-chess/dsh/plugin")
  ]);

  assert.equal(toolsFile.isFile(), true);
  assert.equal(compactionFile.isFile(), true);
  assert.equal(typeof toolsPlugin.apply, "function");
});
