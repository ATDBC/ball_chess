import { createHash } from "node:crypto";

function fail(detail = "") {
  throw new Error(`invalid Ball Chess grant record${detail}`);
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function nonempty(value) {
  return typeof value === "string" && value.length > 0;
}

function secretKeyPath(value, path = "receipt") {
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (["playerToken", "playerTokens", "adminToken", "inviteCode"].includes(key)) return childPath;
    const nested = secretKeyPath(child, childPath);
    if (nested) return nested;
  }
  return null;
}

export function decodeGrant(record) {
  if (record === undefined) return null;
  if (!exactKeys(record, ["kind", "payload"]) || record.kind !== "grant") fail();
  const payload = record.payload;
  if (payload?.state === "redeeming") {
    if (!exactKeys(payload, ["version", "state", "baseUrl", "inviteCode", "redemptionId"]) ||
        payload.version !== 1 || !nonempty(payload.baseUrl) || !nonempty(payload.inviteCode) ||
        !/^[0-9a-f]{32}$/.test(payload.redemptionId)) fail();
    return structuredClone(payload);
  }
  if (payload?.state === "bound") {
    if (!exactKeys(payload, ["version", "state", "baseUrl", "matchId", "seat", "playerToken"]) ||
        payload.version !== 1 || !nonempty(payload.baseUrl) || !nonempty(payload.matchId) ||
        !["left", "right"].includes(payload.seat) || !nonempty(payload.playerToken)) fail();
    return structuredClone(payload);
  }
  if (payload?.state === "finished") {
    const secret = secretKeyPath(payload.receipt);
    if (!exactKeys(payload, ["version", "state", "matchId", "seat", "receipt"]) ||
        payload.version !== 1 || !nonempty(payload.matchId) || !["left", "right"].includes(payload.seat) ||
        !exactKeys(payload.receipt, ["kind", "state"]) || payload.receipt.kind !== "finished" ||
        !payload.receipt.state || typeof payload.receipt.state !== "object" ||
        payload.receipt.state.matchId !== payload.matchId || payload.receipt.state.status !== "finished" ||
        !Number.isInteger(payload.receipt.state.version) || !payload.receipt.state.result) fail();
    if (secret) fail(`: secret field ${secret}`);
    return structuredClone(payload);
  }
  fail();
}

export function credentialKeyForAgent(agentId) {
  return `ball-chess/s-${createHash("sha256").update(agentId).digest("hex")}`;
}

export function inheritedSession(header = {}) {
  return header.isSeeded === true || header.origin === "subagent" || Boolean(header.parentSession);
}

export class BallChessGrantStore {
  constructor(credentials) {
    this.credentials = credentials;
  }

  async read(agentId) {
    return decodeGrant(await this.credentials.readRecord(credentialKeyForAgent(agentId)));
  }

  async beginRedemption(agentId, request) {
    const key = credentialKeyForAgent(agentId);
    const record = await this.credentials.modifyRecord(key, async (current) => {
      const grant = decodeGrant(current);
      if (grant?.state === "bound") throw Object.assign(new Error("This DSH session is already bound to a Ball Chess seat"), { code: "ALREADY_BOUND" });
      if (grant?.state === "redeeming") {
        if (grant.baseUrl !== request.baseUrl || grant.inviteCode !== request.inviteCode) {
          throw Object.assign(new Error("A different invitation redemption is already pending"), { code: "REDEMPTION_IN_PROGRESS" });
        }
        return current;
      }
      return { kind: "grant", payload: { version: 1, state: "redeeming", ...request } };
    });
    return decodeGrant(record);
  }

  async completeRedemption(agentId, redemptionId, binding) {
    const key = credentialKeyForAgent(agentId);
    const record = await this.credentials.modifyRecord(key, async (current) => {
      const grant = decodeGrant(current);
      if (grant?.state !== "redeeming" || grant.redemptionId !== redemptionId) {
        throw Object.assign(new Error("The pending invitation redemption changed"), { code: "REDEMPTION_CHANGED" });
      }
      return { kind: "grant", payload: { version: 1, state: "bound", ...binding } };
    });
    return decodeGrant(record);
  }

  async finish(agentId, matchId, receipt) {
    const key = credentialKeyForAgent(agentId);
    const record = await this.credentials.modifyRecord(key, async (current) => {
      const grant = decodeGrant(current);
      if (grant?.state === "finished" && grant.matchId === matchId) return current;
      if (grant?.state !== "bound" || grant.matchId !== matchId) {
        throw Object.assign(new Error("The Ball Chess binding changed before the terminal receipt was saved"), {
          code: "BINDING_CHANGED"
        });
      }
      const next = {
        kind: "grant",
        payload: {
          version: 1,
          state: "finished",
          matchId,
          seat: grant.seat,
          receipt: structuredClone(receipt)
        }
      };
      decodeGrant(next);
      return next;
    });
    return decodeGrant(record);
  }

  delete(agentId) {
    return this.credentials.deleteRecord(credentialKeyForAgent(agentId));
  }
}
