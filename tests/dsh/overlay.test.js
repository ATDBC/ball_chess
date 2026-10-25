import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("overlay declares a minimal Ball Chess preset", async () => {
  const source = await readFile(new URL("../../dsh/ball-chess.overlay.yml", import.meta.url), "utf8");
  assert.match(source, /name: '@deepseek-ai\/dsh-agent-preset'/);
  assert.match(source, /id: ball-chess/);
  const pluginName = source.match(/name: '([^']*ball_chess\/dsh\/plugin\.js)'/)?.[1];
  assert.ok(pluginName, "overlay must name the Ball Chess plugin");
  assert.equal(new URL(pluginName).protocol, "file:", "Windows ESM plugins require a file URL");
  assert.match(source, /name: '@deepseek-ai\/dsh-persona'/);
  assert.match(source, /complete: true/);
  assert.match(source, /name: '@deepseek-ai\/dsh-compaction-basic'/);
  for (const forbidden of ["tool-bash", "tool-pwsh", "tool-fs", "tool-browser", "tool-web", "tool-subagent", "tool-workflow", "tool-plugin-manager"]) {
    assert.ok(!source.includes(forbidden), `${forbidden} must not be mounted`);
  }
});
