import path from "node:path";

export function buildAgentSetup({ request }) {
  return {
    command: process.execPath,
    args: [path.resolve("mcp/index.js"), "--url", `http://${request.headers.host}`]
  };
}
