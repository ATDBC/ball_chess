import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export async function runBot({ baseUrl, matchId, token, strategy = "greedy", seed = 1, pollMs = 200 }) {
  if (!["greedy", "random"].includes(strategy)) throw new Error("strategy must be greedy or random");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const request = async (suffix, options = {}) => {
    const response = await fetch(`${baseUrl}${suffix}`, { ...options, headers: { ...headers, ...options.headers } });
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error.message), { code: body.error.code, state: body.state });
    return body;
  };
  await request(`/api/matches/${matchId}/join`, {
    method: "POST",
    body: JSON.stringify({ clientType: "bot", displayName: strategy })
  });
  await request(`/api/matches/${matchId}/ready`, {
    method: "POST",
    body: JSON.stringify({ ready: true })
  });
  let randomState = seed >>> 0;
  const random = () => ((randomState = (1664525 * randomState + 1013904223) >>> 0) / 0x100000000);
  for (;;) {
    const state = await request(`/api/matches/${matchId}/state`);
    if (state.status === "finished") return state;
    if (state.yourTurn) {
      let action;
      if (strategy === "greedy") action = state.legalActions.find((a) => a.type === "move" && a.direction === "up") || state.legalActions[0];
      else action = state.legalActions[Math.floor(random() * state.legalActions.length)];
      if (!action) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        continue;
      }
      try {
        await request(`/api/matches/${matchId}/actions`, {
          method: "POST",
          body: JSON.stringify({ expectedVersion: state.version, action })
        });
      } catch (error) {
        if (!["STALE_STATE", "NOT_YOUR_TURN", "MATCH_FINISHED"].includes(error.code)) throw error;
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      url: { type: "string" },
      match: { type: "string" },
      token: { type: "string" },
      strategy: { type: "string", default: "greedy" },
      seed: { type: "string", default: "1" },
      "poll-ms": { type: "string", default: "200" }
    },
    allowPositionals: false
  });
  if (!values.url || !values.match || !values.token) throw new Error("--url, --match and --token are required");
  const result = await runBot({
    baseUrl: values.url,
    matchId: values.match,
    token: values.token,
    strategy: values.strategy,
    seed: Number(values.seed),
    pollMs: Number(values["poll-ms"])
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
