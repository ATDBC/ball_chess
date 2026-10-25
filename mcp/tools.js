import { GameError } from "../core/errors.js";
import { renderAgentResult } from "../agent/projection.js";

export const TOOL_DEFINITIONS = [
  {
    name: "join_by_invite",
    description: "Redeem one Ball Chess invitation and mark the claimed seat ready",
    inputSchema: {
      type: "object",
      required: ["code"],
      properties: { code: { type: "string" }, name: { type: "string" } },
      additionalProperties: false
    }
  },
  {
    name: "set_ready",
    description: "Set or cancel readiness before the match starts",
    inputSchema: { type: "object", required: ["ready"], properties: { ready: { type: "boolean" } }, additionalProperties: false }
  },
  {
    name: "get_match_state",
    description: "Get the compact board state and legal actions",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "get_match_record",
    description: "Get the complete action record for the bound match",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "wait_for_turn",
    description: "Wait through reconnects until your turn, game end, or cancellation",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "submit_action",
    description: "Submit an expected version and one listed legal action",
    inputSchema: {
      type: "object",
      required: ["expectedVersion", "actionId"],
      properties: {
        expectedVersion: { type: "integer" },
        actionId: {
          type: "string",
          description: "Copy one id from decision.legal, such as move:up or wall:v:3:4"
        }
      },
      additionalProperties: false
    }
  }
];

function resultForState(state) {
  const kind = state.status === "finished" ? "finished" : state.status === "playing" && state.yourTurn ? "turn" : state.status;
  return { kind, state };
}

export async function handleTool(name, args, session, { signal } = {}) {
  let result;
  switch (name) {
    case "join_by_invite": result = await session.joinByInvite(args.code, args.name); break;
    case "set_ready": result = await session.setReady(args.ready); break;
    case "get_match_state": result = resultForState(await session.getState()); break;
    case "get_match_record": result = { kind: "record", record: await session.getRecord() }; break;
    case "wait_for_turn": result = await session.waitForTurn(signal); break;
    case "submit_action": result = await session.submitAction(args.expectedVersion, args.actionId); break;
    default: throw new GameError("UNKNOWN_TOOL", `Unknown tool: ${name}`);
  }
  return { structuredContent: result, content: [{ type: "text", text: renderAgentResult(result) }] };
}
