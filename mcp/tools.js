import { GameError } from "../core/errors.js";
import { HEIGHT, WIDTH } from "../core/constants.js";

function integerRange(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export const TOOL_DEFINITIONS = [
  {
    name: "join_match",
    description: "Join one Ball Chess seat",
    inputSchema: {
      type: "object",
      required: ["matchId", "playerToken"],
      properties: {
        matchId: { type: "string" },
        playerToken: { type: "string" },
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
      properties: { timeoutSeconds: { type: "integer", enum: integerRange(1, 15), default: 10 } },
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
        expectedVersion: { type: "integer" },
        action: {
          oneOf: [
            {
              type: "object",
              required: ["type", "direction"],
              properties: {
                type: { type: "string", const: "move" },
                direction: { type: "string", enum: ["up", "down", "left", "right"] }
              },
              additionalProperties: false
            },
            {
              type: "object",
              required: ["type", "orientation", "x", "y"],
              properties: {
                type: { type: "string", const: "place_wall" },
                orientation: { type: "string", const: "h" },
                x: { type: "integer", enum: integerRange(0, WIDTH - 2) },
                y: { type: "integer", enum: integerRange(1, HEIGHT - 1) }
              },
              additionalProperties: false
            },
            {
              type: "object",
              required: ["type", "orientation", "x", "y"],
              properties: {
                type: { type: "string", const: "place_wall" },
                orientation: { type: "string", const: "v" },
                x: { type: "integer", enum: integerRange(1, WIDTH - 1) },
                y: { type: "integer", enum: integerRange(0, HEIGHT - 2) }
              },
              additionalProperties: false
            }
          ]
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
