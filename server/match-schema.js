import { normalizeConfig } from "../core/state.js";

function fail(field) {
  throw new Error(`Invalid match record field: ${field}`);
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(field);
  return value;
}

function finite(value, field) {
  if (!Number.isFinite(value)) fail(field);
}

function nonEmptyString(value, field) {
  if (typeof value !== "string" || value.length === 0) fail(field);
}

function nullableObject(value, field) {
  if (value !== null) object(value, field);
}

export function assertStoredMatchV1(raw, expectedId) {
  object(raw, "record");
  if (raw.schemaVersion !== 1) fail("schemaVersion");
  nonEmptyString(raw.id, "id");
  if (raw.id !== expectedId) fail("id");
  nonEmptyString(raw.adminToken, "adminToken");
  object(raw.playerTokens, "playerTokens");
  nonEmptyString(raw.playerTokens.left, "playerTokens.left");
  nonEmptyString(raw.playerTokens.right, "playerTokens.right");
  finite(raw.createdAt, "createdAt");
  finite(raw.updatedAt, "updatedAt");
  object(raw.joined, "joined");
  for (const seat of ["left", "right"]) {
    if (typeof raw.joined[seat] !== "boolean") fail(`joined.${seat}`);
  }
  object(raw.profiles, "profiles");
  nullableObject(raw.profiles.left, "profiles.left");
  nullableObject(raw.profiles.right, "profiles.right");
  if (!["waiting", "playing", "finished"].includes(raw.status)) fail("status");
  if (!Number.isSafeInteger(raw.version) || raw.version < 0) fail("version");
  if (raw.turnDeadlineAt !== null) finite(raw.turnDeadlineAt, "turnDeadlineAt");
  object(raw.config, "config");
  const normalized = normalizeConfig(raw.config);
  if (normalized.width !== raw.config.width || normalized.height !== raw.config.height) fail("config");
  if (!Array.isArray(raw.actions)) fail("actions");
  raw.actions.forEach((entry, index) => {
    object(entry, `actions[${index}]`);
    if (!["left", "right"].includes(entry.player)) fail(`actions[${index}].player`);
    if (entry.ply !== index + 1) fail(`actions[${index}].ply`);
    object(entry.action, `actions[${index}].action`);
    finite(entry.at, `actions[${index}].at`);
  });
  nullableObject(raw.result, "result");
  return raw;
}
