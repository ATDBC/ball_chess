import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("agent setup resolves the MCP entry independently of the launch directory", () => {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const moduleUrl = pathToFileURL(path.join(projectRoot, "server", "agent-setup.js")).href;
  const script = [
    `import { buildAgentSetup } from ${JSON.stringify(moduleUrl)};`,
    "console.log(JSON.stringify(buildAgentSetup({ request: { headers: { host: '127.0.0.1:7100' } } })));"
  ].join("\n");

  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: tmpdir(),
    encoding: "utf8"
  });

  assert.equal(child.status, 0, child.stderr);
  const setup = JSON.parse(child.stdout);
  assert.equal(setup.args[0], path.join(projectRoot, "mcp", "index.js"));
});
