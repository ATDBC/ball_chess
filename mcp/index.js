import { parseArgs } from "node:util";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AgentSession } from "./session.js";
import { handleTool, TOOL_DEFINITIONS } from "./tools.js";

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      url: { type: "string" },
      match: { type: "string" }
    },
    allowPositionals: false
  });
  if (!values.url) throw new Error("--url is required");
  const endpoint = new URL(values.url);
  if (endpoint.protocol !== "http:" || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(endpoint.hostname)) {
    throw new Error("MCP adapter only connects to a local HTTP Ball Chess server");
  }

  const token = values.match ? process.env.BALL_CHESS_PLAYER_TOKEN : null;
  if (values.match && !token) throw new Error("BALL_CHESS_PLAYER_TOKEN is required with --match");
  const session = new AgentSession({ baseUrl: endpoint.href, matchId: values.match ?? null, token });
  const tools = values.match ? TOOL_DEFINITIONS.filter((tool) => tool.name !== "join_by_invite") : TOOL_DEFINITIONS;
  const toolNames = new Set(tools.map((tool) => tool.name));
  const server = new Server(
    { name: "ball-chess", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) => {
    try {
      if (!toolNames.has(params.name)) throw new Error(`Unknown tool: ${params.name}`);
      return await handleTool(params.name, params.arguments || {}, session, { signal: extra?.signal });
    } catch (error) {
      const result = { ok: false, error: { code: error.code || "MCP_ERROR", message: error.message } };
      return { isError: true, structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  });
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
