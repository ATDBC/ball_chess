import { GameError } from "../core/errors.js";

const STATUS_BY_CODE = {
  INVALID_CONFIG: 400,
  INVALID_JSON: 400,
  INVALID_REQUEST: 400,
  INVALID_PLAYER: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  MATCH_NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  STALE_STATE: 409,
  NOT_YOUR_TURN: 409,
  MATCH_FINISHED: 409,
  MATCH_ALREADY_STARTED: 409,
  MATCH_NOT_READY: 409,
  SEAT_NOT_CLAIMED: 409,
  SEAT_NOT_OPEN: 409,
  TURN_EXPIRED: 409,
  ILLEGAL_ACTION: 422,
  STORAGE_ERROR: 500,
  MATCH_UNAVAILABLE: 503
};

export function getBearer(req) {
  const value = req.headers.authorization;
  if (value === undefined) return null;
  if (Array.isArray(value)) throw new GameError("UNAUTHORIZED", "Exactly one Bearer token is required");
  const match = /^Bearer ([^\s]+)$/.exec(value);
  if (!match) throw new GameError("UNAUTHORIZED", "Authorization must use Bearer authentication");
  return match[1];
}

export async function readJson(req) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) {
      tooLarge = true;
      chunks.length = 0;
    } else if (!tooLarge) {
      chunks.push(chunk);
    }
  }
  if (tooLarge) throw new GameError("PAYLOAD_TOO_LARGE", "JSON body exceeds 16 KiB");
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new GameError("INVALID_JSON", "Request body is not valid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GameError("INVALID_JSON", "JSON body must be an object");
  }
  return body;
}

export function assertBodyKeys(body, allowed, required = []) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(body)) {
    if (!allowedSet.has(key)) throw new GameError("INVALID_REQUEST", `Unknown request field: ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(body, key)) throw new GameError("INVALID_REQUEST", `Missing request field: ${key}`);
  }
}

export function sendJson(res, status, body) {
  if (res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

export function sendError(res, error) {
  const status = STATUS_BY_CODE[error.code] || 500;
  const body = {
    ok: false,
    error: {
      code: status === 500 && error.code !== "STORAGE_ERROR" ? "INTERNAL_ERROR" : error.code || "INTERNAL_ERROR",
      message: status === 500 && error.code !== "STORAGE_ERROR" ? "Internal server error" : error.message,
      details: error.details || {}
    }
  };
  if (error.state) body.state = error.state;
  sendJson(res, status, body);
}
