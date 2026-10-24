import { GameError } from "../core/errors.js";

export const TOOL_DEFINITIONS = [
  {
    name: "join_match",
    description: "Join one Ball Chess seat",
    inputSchema: {
      type: "object",
      required: ["matchId", "playerToken"],
      properties: {
        matchId: { type: "string", minLength: 1 },
        playerToken: { type: "string", minLength: 1 },
        name: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "get_match_state",
    description: "Get JSON state, ASCII board and legal actions",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "wait_for_turn",
    description: "Wait until your turn or game end; waiting timeout is not a game error",
    inputSchema: {
      type: "object",
      properties: { timeoutSeconds: { type: "integer", minimum: 1, maximum: 15, default: 10 } },
      additionalProperties: false
    }
  },
  {
    name: "submit_action",
    description: "Submit an expected version and one legal action",
    inputSchema: {
      type: "object",
      required: ["expectedVersion", "action"],
      properties: {
        expectedVersion: { type: "integer", minimum: 0 },
        action: {
          type: "object",
          required: ["type"],
          properties: {
            type: { enum: ["move", "place_wall"] },
            direction: { enum: ["up", "down", "left", "right"] },
            orientation: { enum: ["h", "v"] },
            x: { type: "integer" },
            y: { type: "integer" }
          },
          additionalProperties: false
        }
      },
      additionalProperties: false
    }
  }
];

export async function handleTool(name, args, session) {
  let result;
  switch (name) {
    case "join_match":
      result = { ok: true, state: await session.join(args.matchId, args.playerToken, args.name) };
      break;
    case "get_match_state":
      result = await session.getState();
      break;
    case "wait_for_turn":
      result = await session.waitForTurn(args.timeoutSeconds ?? 10);
      break;
    case "submit_action":
      result = await session.submitAction(args.expectedVersion, args.action);
      break;
    default:
      throw new GameError("UNKNOWN_TOOL", `Unknown tool: ${name}`);
  }
  return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
}
