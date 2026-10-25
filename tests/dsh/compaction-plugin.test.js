import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HAS_DSH_RUNTIME = typeof process.env.DSH_HARNESS_ROOT === "string" && process.env.DSH_HARNESS_ROOT.length > 0
  || process.cwd().replaceAll("\\", "/").endsWith("/deepseek-harness");
let BallChessCompactionEngine;

async function loadEngine() {
  BallChessCompactionEngine ??= (await import("../../dsh/compaction-plugin.js")).default;
  return BallChessCompactionEngine;
}

const CHECKPOINT = [
  "## Match Identity\n- m_one / left",
  "## Rules and Configuration\n- walls unlimited; left used 2; right used 1",
  "## Last Observed Authoritative State\n- v9 playing; right turn",
  "## User Instructions\n- continue the match",
  "## Pending Action\n- call wait_for_turn",
  "## Outcome\n- (none)"
].join("\n\n");

function agent() {
  return {
    options: {},
    session: {
      id: "session-one",
      requestHeader: () => ({ config: { provider: "test-provider", model: "test-model" } }),
      toolHistory: () => ({ tools: [], updates: [] })
    }
  };
}

async function summarize(chunks) {
  const Engine = await loadEngine();
  let call;
  const owner = {
    config: {
      summarizationProvider: "",
      summarizationModel: "",
      maxTokens: 4096,
      modelPolicies: []
    },
    ctx: {
      llm: {
        async * stream(options) {
          call = options;
          for (const chunk of chunks) yield chunk;
        }
      }
    }
  };
  const result = await Engine.prototype.summarize.call(owner, {
    messages: [{ role: "user", content: [{ type: "text", text: "prior" }] }],
    tools: [{ name: "get_match_state", description: "state", parameters: { type: "object" } }]
  }, agent());
  return { call, result };
}

test("summary call reuses the prefix and returns a marked text result", { skip: !HAS_DSH_RUNTIME && "requires DSH_HARNESS_ROOT" }, async () => {
  const { call, result } = await summarize([
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text: CHECKPOINT },
    { type: "usage", usage: { inputTokens: 20, outputTokens: 30 } },
    { type: "finish", reason: { kind: "stop" } }
  ]);
  assert.equal(call.purpose, "compaction");
  assert.equal(call.maxTokens, 4096);
  assert.equal(call.messages[0].content[0].text, "prior");
  assert.match(call.messages.at(-1).content[0].text, /## Match Identity/);
  assert.equal(call.sessionId, "session-one");
  assert.deepEqual(result.summary, [{ type: "text", text: CHECKPOINT }]);
  assert.equal(result.llmStreamCall, true);
  assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 30 });
});

test("summary rejects truncation, empty text, images, and provider failure", { skip: !HAS_DSH_RUNTIME && "requires DSH_HARNESS_ROOT" }, async () => {
  await assert.rejects(summarize([
    { type: "finish", reason: { kind: "max-tokens" } }
  ]), (error) => error.code === "MAX_TOKENS");
  await assert.rejects(summarize([
    { type: "finish", reason: { kind: "stop" } }
  ]), /empty/);
  await assert.rejects(summarize([
    { type: "block-start", index: 0, blockType: "image" },
    { type: "block-end", index: 0, block: { type: "image", data: "abc", mimeType: "image/png" } },
    { type: "finish", reason: { kind: "stop" } }
  ]), (error) => error.code === "UNSUPPORTED_CONTENT");
  await assert.rejects(summarize([
    { type: "finish", reason: { kind: "error", failure: { code: "UPSTREAM", message: "failed" } } }
  ]), (error) => error.code === "UPSTREAM");
  await assert.rejects(summarize([
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text: CHECKPOINT },
    { type: "finish", reason: { kind: "tool-calls" } }
  ]), (error) => error.code === "UNSUPPORTED_FINISH");
  await assert.rejects(summarize([
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text: CHECKPOINT },
    { type: "block-start", index: 1, blockType: "reasoning" },
    { type: "reasoning-delta", index: 1, text: "hidden" },
    { type: "finish", reason: { kind: "stop" } }
  ]), (error) => error.code === "UNSUPPORTED_CONTENT");
});

test("real Cordis Loader composes the Ball Chess compaction service", { skip: !HAS_DSH_RUNTIME && "requires the DSH source runtime" }, async () => {
  const [cordis, loaderModule, includeModule, llmModule, sessionModule, projectionModule, meterModule] = await Promise.all([
    import("@deepseek-ai/cordis"),
    import("@deepseek-ai/cordis-plugin-loader"),
    import("@deepseek-ai/cordis-plugin-include"),
    import("@deepseek-ai/dsh-llm"),
    import("@deepseek-ai/dsh-session"),
    import("@deepseek-ai/dsh-session-projection"),
    import("@deepseek-ai/dsh-token-meter")
  ]);
  const Engine = await loadEngine();
  const directory = await mkdtemp(path.join(tmpdir(), "ball-chess-loader-"));
  const configPath = path.join(directory, "cordis.yml");
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-token-meter'",
    "- name: '@test/ball-chess-compaction'",
    "  config:",
    "    auto: false",
    "    maxTokens: 4096",
    ""
  ].join("\n"));
  const context = new cordis.Context();
  try {
    context.baseUrl = `${pathToFileURL(directory).href}/`;
    await context.plugin(loaderModule.default);
    context.loader.builtins.include = includeModule.default;
    const modules = new Map([
      ["@deepseek-ai/dsh-llm", llmModule.default],
      ["@deepseek-ai/dsh-session", sessionModule.default],
      ["@deepseek-ai/dsh-session-projection", projectionModule.default],
      ["@deepseek-ai/dsh-token-meter", meterModule.default],
      ["@test/ball-chess-compaction", Engine]
    ]);
    context.loader.internal = {
      version: "v2",
      async import(specifier) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`);
        return modules.get(specifier);
      }
    };
    await context.loader.create({
      name: "cordis:include",
      config: { path: pathToFileURL(configPath).href }
    });
    await context.loader.await();
    assert.ok(context.get("compaction") instanceof Engine);
    assert.equal(context.get("compaction").config.maxTokens, 4096);
    assert.equal(context.get("compaction").config.auto, false);
  } finally {
    await context.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
