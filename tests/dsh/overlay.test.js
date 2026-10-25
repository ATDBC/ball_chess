import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("overlay declares a minimal Ball Chess preset", async () => {
  const source = await readFile(new URL("../../dsh/ball-chess.overlay.yml", import.meta.url), "utf8");
  assert.match(source, /name: '@deepseek-ai\/dsh-agent-preset'/);
  assert.match(source, /id: ball-chess/);
  assert.match(source, /name: '\.\/plugin\.js'/);
  assert.match(source, /name: '\.\/compaction-plugin\.js'/);
  assert.doesNotMatch(source, /file:\/\/\//);
  assert.doesNotMatch(source, /E:\//);
  assert.match(source, /name: '@deepseek-ai\/dsh-persona'/);
  assert.match(source, /complete: true/);
  assert.match(source, /rules 与 wallBudgets.*本局完整规则/);
  assert.doesNotMatch(source, /9×13|y=12/);
  for (const forbidden of ["tool-bash", "tool-pwsh", "tool-fs", "tool-browser", "tool-web", "tool-subagent", "tool-workflow", "tool-plugin-manager"]) {
    assert.ok(!source.includes(forbidden), `${forbidden} must not be mounted`);
  }
});

test("the project is a portable DSH bundle", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.dsh, { bundle: { patch: "./dsh/ball-chess.overlay.yml" } });
  assert.equal(manifest.engines.node, ">=24.9.0");
  assert.match(manifest.engines.dsh, /0\.2\.1/);
  assert.ok(manifest.peerDependencies["@deepseek-ai/dsh-compaction-basic"]);
  assert.ok(manifest.peerDependencies["@deepseek-ai/dsh-llm"]);
});
