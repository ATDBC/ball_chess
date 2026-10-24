import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createApp } from "./app.js";
import { MatchService } from "./match-service.js";
import { MatchStore } from "./store.js";

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "7100" }
    },
    allowPositionals: false
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || String(port) !== values.port) {
    throw new Error("port must be an integer from 1 to 65535");
  }
  const directory = fileURLToPath(new URL("../data/matches/", import.meta.url));
  const service = await MatchService.open({ store: new MatchStore({ directory }) });
  const server = createApp({
    service,
    webRoot: fileURLToPath(new URL("../web/", import.meta.url)),
    coreRoot: fileURLToPath(new URL("../core/", import.meta.url))
  });
  const shutdown = () => {
    service.close();
    server.close();
    server.closeAllConnections();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.on("error", (error) => {
    console.error(error.message);
    service.close();
    process.exitCode = 1;
  });
  server.listen(port, values.host, () => {
    console.log(`Ball Chess listening on http://${values.host}:${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
