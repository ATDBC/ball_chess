import { parseArgs } from "node:util";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AgentSession } from "./session.js";
import { handleTool, TOOL_DEFINITIONS } from "./tools.js";

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { url: { type: "string" } },
    allowPositionals: false
  });
  if (!values.url) throw new Error("--url is required");
  const endpoint = new URL(values.url);
  if (endpoint.protocol !== "http:" || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(endpoint.hostname)) {
    throw new Error("MCP adapter only connects to a local HTTP Ball Chess server");
  }

  const session = new AgentSession({ baseUrl: endpoint.href });
  const server = new Server(
    { name: "ball-chess", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      return await handleTool(params.name, params.arguments || {}, session);
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
