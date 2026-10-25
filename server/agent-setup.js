import { fileURLToPath } from "node:url";

const MCP_ENTRYPOINT = fileURLToPath(new URL("../mcp/index.js", import.meta.url));

export function buildAgentSetup({ request }) {
  return {
    command: process.execPath,
    args: [MCP_ENTRYPOINT, "--url", `http://${request.headers.host}`]
  };
}
