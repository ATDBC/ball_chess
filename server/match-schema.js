import { normalizeConfig } from "../core/state.js";

const SEATS = ["left", "right"];
const PHASES = ["open", "claimed", "ready"];

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

function nullableFinite(value, field) {
  if (value !== null) finite(value, field);
}

function validateCommon(raw, expectedId) {
  object(raw, "record");
  nonEmptyString(raw.id, "id");
  if (raw.id !== expectedId) fail("id");
  nonEmptyString(raw.adminToken, "adminToken");
  object(raw.playerTokens, "playerTokens");
  nonEmptyString(raw.playerTokens.left, "playerTokens.left");
  nonEmptyString(raw.playerTokens.right, "playerTokens.right");
  finite(raw.createdAt, "createdAt");
  finite(raw.updatedAt, "updatedAt");
  if (!Number.isSafeInteger(raw.version) || raw.version < 0) fail("version");
  nullableFinite(raw.turnDeadlineAt, "turnDeadlineAt");
  object(raw.config, "config");
  const normalized = normalizeConfig(raw.config);
  for (const field of ["width", "height", "wallLimit", "maxPlies", "turnTimeoutMs", "firstPlayer"]) {
    if (normalized[field] !== raw.config[field]) fail("config");
  }
  if (!Array.isArray(raw.actions)) fail("actions");
  raw.actions.forEach((entry, index) => {
    object(entry, `actions[${index}]`);
    if (!SEATS.includes(entry.player)) fail(`actions[${index}].player`);
    if (entry.ply !== index + 1) fail(`actions[${index}].ply`);
    object(entry.action, `actions[${index}].action`);
    finite(entry.at, `actions[${index}].at`);
  });
  nullableObject(raw.result, "result");
}

function validateInvitation(invitation, field) {
  if (invitation === null) return;
  object(invitation, field);
  if (!Number.isSafeInteger(invitation.generation) || invitation.generation < 1) {
    fail(`${field}.generation`);
  }
  if (typeof invitation.digest !== "string" || !/^[0-9a-f]{64}$/.test(invitation.digest)) {
    fail(`${field}.digest`);
  }
  finite(invitation.expiresAt, `${field}.expiresAt`);
  nullableFinite(invitation.consumedAt, `${field}.consumedAt`);
  if (invitation.redemptionId !== null && (
    typeof invitation.redemptionId !== "string"
    || !/^[0-9a-f]{32}$/i.test(invitation.redemptionId)
  )) {
    fail(`${field}.redemptionId`);
  }
  if ((invitation.consumedAt === null) !== (invitation.redemptionId === null)) {
    fail(`${field}.consumption`);
  }
}

export function assertStoredMatchV1(raw, expectedId) {
  if (raw?.schemaVersion !== 1) fail("schemaVersion");
  validateCommon(raw, expectedId);
  object(raw.joined, "joined");
  for (const seat of SEATS) {
    if (typeof raw.joined[seat] !== "boolean") fail(`joined.${seat}`);
  }
  object(raw.profiles, "profiles");
  nullableObject(raw.profiles.left, "profiles.left");
  nullableObject(raw.profiles.right, "profiles.right");
  if (!["waiting", "playing", "finished"].includes(raw.status)) fail("status");
  return raw;
}

export function assertStoredMatchV2(raw, expectedId) {
  if (raw?.schemaVersion !== 2) fail("schemaVersion");
  validateCommon(raw, expectedId);
  nullableFinite(raw.startedAt, "startedAt");
  object(raw.seats, "seats");
  for (const seat of SEATS) {
    const value = object(raw.seats[seat], `seats.${seat}`);
    if (!PHASES.includes(value.phase)) fail(`seats.${seat}.phase`);
    nullableObject(value.profile, `seats.${seat}.profile`);
  }
  object(raw.invitations, "invitations");
  for (const seat of SEATS) validateInvitation(raw.invitations[seat], `invitations.${seat}`);
  return raw;
}

export function assertStoredMatch(raw, expectedId) {
  if (raw?.schemaVersion === 1) return assertStoredMatchV1(raw, expectedId);
  if (raw?.schemaVersion === 2) return assertStoredMatchV2(raw, expectedId);
  fail("schemaVersion");
}
