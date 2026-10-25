import { randomBytes } from "node:crypto";
import { BallChessAgentClient } from "../agent/client.js";
import { renderAgentResult } from "../agent/projection.js";
import { GameError } from "../core/errors.js";
import { TOOL_DEFINITIONS } from "../mcp/tools.js";
import { normalizeInvitationCode } from "../server/invitations.js";
import { BallChessGrantStore, inheritedSession } from "./grant-store.js";

export const name = "ball-chess-dsh";
export const inject = ["tools", "credentials"];

const DEFINITIVE_REDEMPTION_FAILURES = new Set([
  "INVALID_REQUEST",
  "INVITE_INVALID",
  "INVITE_CONSUMED",
  "INVITE_EXPIRED",
  "MATCH_FINISHED",
  "MATCH_ALREADY_STARTED",
  "SEAT_NOT_OPEN"
]);

function validateBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError("ball-chess-dsh baseUrl must be a valid URL"); }
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
    throw new TypeError("ball-chess-dsh baseUrl must be a loopback HTTP URL");
  }
  return url.href.replace(/\/$/, "");
}

function executionAgent(exec) {
  const agent = exec?.agent;
  if (!agent || typeof agent.id !== "string" || agent.id.length === 0) {
    throw new GameError("SESSION_REQUIRED", "Ball Chess tools require a DSH agent session");
  }
  return agent;
}

function stateResult(state) {
  const kind = state.status === "finished" ? "finished" : state.status === "playing" && state.yourTurn ? "turn" : state.status;
  return { kind, state };
}

export function createBallChessPlugin({ fetchImpl = fetch, redemptionIdFactory = () => randomBytes(16).toString("hex") } = {}) {
  return {
    apply(ctx, config) {
      if (!ctx.tools || !ctx.credentials) throw new Error("ball-chess-dsh requires tools and credentials services");
      if (!config || Object.keys(config).some((key) => key !== "baseUrl")) throw new TypeError("ball-chess-dsh config accepts only baseUrl");
      const configuredBaseUrl = validateBaseUrl(config.baseUrl);
      const grants = new BallChessGrantStore(ctx.credentials);
      const clients = new Map();

      const cachedClient = (agentId, grant) => {
        const signature = `${grant.baseUrl}\0${grant.matchId}\0${grant.seat}`;
        const cached = clients.get(agentId);
        if (cached?.signature === signature) return cached.client;
        cached?.client.close();
        const client = new BallChessAgentClient({
          baseUrl: validateBaseUrl(grant.baseUrl),
          fetchImpl,
          clientType: "dsh",
          binding: { matchId: grant.matchId, seat: grant.seat, playerToken: grant.playerToken }
        });
        clients.set(agentId, { signature, client });
        return client;
      };

      const requireClient = async (exec) => {
        const agent = executionAgent(exec);
        const grant = await grants.read(agent.id);
        if (!grant) {
          if (inheritedSession(agent.session?.header)) {
            throw new GameError("BINDING_NOT_INHERITED", "Forked and subagent sessions do not inherit a Ball Chess seat; redeem a new invitation in this session");
          }
          throw new GameError("NOT_JOINED", "Join a Ball Chess invitation in this DSH session first");
        }
        if (grant.state === "unbound") {
          throw new GameError("NOT_JOINED", "Join a Ball Chess invitation in this DSH session first");
        }
        if (grant.state === "redeeming") {
          throw new GameError("REDEMPTION_PENDING", "Retry join_by_invite with the same invitation to resolve the pending redemption");
        }
        if (grant.state === "finished") return { agent, receipt: structuredClone(grant.receipt) };
        return { agent, client: cachedClient(agent.id, grant) };
      };

      const settleFinished = async (agentId, result) => {
        if (result.state?.status !== "finished") return result;
        const receipt = { kind: "finished", state: result.state };
        await grants.finish(agentId, result.state.matchId, receipt);
        clients.get(agentId)?.client.close();
        clients.delete(agentId);
        return result;
      };

      const execute = {
        async join_by_invite(args, exec) {
          const agent = executionAgent(exec);
          const code = normalizeInvitationCode(args.code);
          const pending = await grants.beginRedemption(agent.id, {
            baseUrl: configuredBaseUrl,
            inviteCode: code,
            redemptionId: redemptionIdFactory()
          });
          const signature = `redeeming\0${pending.baseUrl}\0${pending.redemptionId}`;
          let cached = clients.get(agent.id);
          if (cached?.signature !== signature) {
            cached?.client.close();
            cached = { signature, client: new BallChessAgentClient({ baseUrl: pending.baseUrl, fetchImpl, clientType: "dsh" }) };
            clients.set(agent.id, cached);
          }
          try {
            await cached.client.bindByInvite({
              code: pending.inviteCode,
              redemptionId: pending.redemptionId,
              name: args.name || "DSH agent"
            });
          } catch (error) {
            if (DEFINITIVE_REDEMPTION_FAILURES.has(error?.code)) {
              await grants.rejectRedemption(agent.id, pending.redemptionId);
              if (clients.get(agent.id) === cached) {
                cached.client.close();
                clients.delete(agent.id);
              }
            }
            throw error;
          }
          const readyResult = await cached.client.setReady(true);
          const binding = cached.client.exportBinding();
          await grants.completeRedemption(agent.id, pending.redemptionId, { baseUrl: pending.baseUrl, ...binding });
          clients.set(agent.id, { signature: `${pending.baseUrl}\0${binding.matchId}\0${binding.seat}`, client: cached.client });
          return settleFinished(agent.id, readyResult);
        },
        async set_ready(args, exec) {
          const { agent, client, receipt } = await requireClient(exec);
          if (receipt) return receipt;
          return settleFinished(agent.id, await client.setReady(args.ready));
        },
        async get_match_state(_args, exec) {
          const { agent, client, receipt } = await requireClient(exec);
          if (receipt) return receipt;
          return settleFinished(agent.id, stateResult(await client.getState()));
        },
        async wait_for_turn(_args, exec) {
          const { agent, client, receipt } = await requireClient(exec);
          if (receipt) return receipt;
          return settleFinished(agent.id, await client.waitForActionable({ signal: exec.signal }));
        },
        async submit_action(args, exec) {
          const { agent, client, receipt } = await requireClient(exec);
          if (receipt) return receipt;
          return settleFinished(agent.id, await client.submitAction(args.expectedVersion, args.action));
        }
      };

      ctx.effect(() => {
        const disposers = TOOL_DEFINITIONS.map((tool) => ctx.tools.register({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          output: {
            schema: { type: "object", additionalProperties: true },
            render: (_args, value) => [{ type: "text", text: renderAgentResult(value) }]
          },
          execute: execute[tool.name]
        }));
        return () => {
          for (const dispose of disposers.reverse()) dispose();
          for (const { client } of clients.values()) client.close();
          clients.clear();
        };
      });
    }
  };
}

const plugin = createBallChessPlugin();

export function apply(ctx, config) {
  return plugin.apply(ctx, config);
}
