import { createHash, randomBytes } from "node:crypto";
import { GameError } from "../core/errors.js";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const NORMALIZED_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const INVITATION_TTL_MS = 10 * 60 * 1000;

export function generateInvitationCode(random = randomBytes) {
  const bytes = random(16);
  if (!Buffer.isBuffer(bytes) || bytes.length !== 16) {
    throw new TypeError("Invitation randomness must contain exactly 16 bytes");
  }
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  const characters = Array(26);
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    characters[index] = CROCKFORD_ALPHABET[Number(value & 31n)];
    value >>= 5n;
  }
  const normalized = characters.join("");
  return [
    normalized.slice(0, 5),
    normalized.slice(5, 10),
    normalized.slice(10, 15),
    normalized.slice(15, 20),
    normalized.slice(20)
  ].join("-");
}

export function normalizeInvitationCode(value) {
  if (typeof value !== "string") {
    throw new GameError("INVITE_INVALID", "Invitation code must be a string");
  }
  const normalized = value.replaceAll("-", "").toUpperCase();
  if (!NORMALIZED_PATTERN.test(normalized)) {
    throw new GameError("INVITE_INVALID", "Invitation code is invalid");
  }
  return normalized;
}

export function digestInvitationCode(value) {
  return createHash("sha256").update(normalizeInvitationCode(value), "ascii").digest("hex");
}
