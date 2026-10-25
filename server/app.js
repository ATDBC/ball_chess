import http from "node:http";
import { buildAgentSetup } from "./agent-setup.js";
import { assertBodyKeys, getBearer, readJson, sendError, sendJson } from "./http-utils.js";
import { serveStatic } from "./static.js";
import { SseHub } from "./sse.js";

const ACTION_STATE_ERRORS = new Set(["STALE_STATE", "NOT_YOUR_TURN", "ILLEGAL_ACTION", "MATCH_FINISHED", "TURN_EXPIRED"]);

export function createApp({ service, webRoot, coreRoot }) {
  const hub = new SseHub();
  const publish = ({ matchId, state }) => hub.publish(matchId, state);
  service.on("update", publish);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const pathname = url.pathname;
      if (pathname === "/api/matches" && req.method === "POST") {
        const body = await readJson(req);
        const created = await service.create(body);
        sendJson(res, 201, created);
        return;
      }
      if (pathname === "/api/invitations/redeem" && req.method === "POST") {
        const body = await readJson(req);
        assertBodyKeys(body, ["code", "redemptionId", "profile"], ["code", "redemptionId", "profile"]);
        sendJson(res, 200, await service.redeemInvitation(body));
        return;
      }

      const route = /^\/api\/matches\/([^/]+)\/(join|ready|invitations|state|setup|actions|abort|events|record)$/.exec(pathname);
      if (route) {
        const matchId = decodeURIComponent(route[1]);
        const operation = route[2];
        if (operation === "join" && req.method === "POST") {
          const body = await readJson(req);
          assertBodyKeys(body, ["displayName", "clientType"], ["displayName", "clientType"]);
          const state = await service.join(matchId, getBearer(req), body);
          sendJson(res, 200, state);
          return;
        }
        if (operation === "ready" && req.method === "POST") {
          const body = await readJson(req);
          assertBodyKeys(body, ["ready"], ["ready"]);
          if (typeof body.ready !== "boolean") {
            throw Object.assign(new Error("ready must be a boolean"), { code: "INVALID_REQUEST", details: {} });
          }
          sendJson(res, 200, await service.setReady(matchId, getBearer(req), body.ready));
          return;
        }
        if (operation === "invitations" && req.method === "POST") {
          const body = await readJson(req);
          assertBodyKeys(body, ["seat"], ["seat"]);
          sendJson(res, 201, await service.createInvitation(matchId, getBearer(req), body.seat));
          return;
        }
        if (operation === "state" && req.method === "GET") {
          const token = getBearer(req);
          sendJson(res, 200, await service.getState(matchId, token ?? undefined));
          return;
        }
        if (operation === "setup" && req.method === "GET") {
          const setup = await service.getSetup(matchId, getBearer(req));
          sendJson(res, 200, { ...setup, mcp: buildAgentSetup({ request: req, playerTokens: setup.playerTokens }) });
          return;
        }
        if (operation === "actions" && req.method === "POST") {
          const token = getBearer(req);
          try {
            const body = await readJson(req);
            assertBodyKeys(body, ["expectedVersion", "action"], ["expectedVersion", "action"]);
            if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 0) {
              throw Object.assign(new Error("expectedVersion must be a non-negative integer"), { code: "INVALID_REQUEST", details: {} });
            }
            sendJson(res, 200, await service.submitAction(matchId, token, body.expectedVersion, body.action));
          } catch (error) {
            if (ACTION_STATE_ERRORS.has(error.code)) error.state = await service.getState(matchId, token ?? undefined);
            throw error;
          }
          return;
        }
        if (operation === "abort" && req.method === "POST") {
          sendJson(res, 200, await service.abort(matchId, getBearer(req)));
          return;
        }
        if (operation === "events" && req.method === "GET") {
          const state = await service.getState(matchId);
          hub.add(matchId, req, res, state);
          return;
        }
        if (operation === "record" && req.method === "GET") {
          sendJson(res, 200, await service.getRecord(matchId));
          return;
        }
      }

      if (pathname.startsWith("/api/")) {
        sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "API route not found", details: {} } });
        return;
      }
      if (await serveStatic(req, res, { webRoot, coreRoot, pathname })) return;
      sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "Resource not found", details: {} } });
    } catch (error) {
      sendError(res, error);
    }
  });
  server.on("close", () => {
    hub.close();
    service.off("update", publish);
  });
  return server;
}
