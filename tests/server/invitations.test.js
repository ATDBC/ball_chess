import test from "node:test";
import assert from "node:assert/strict";
import {
  digestInvitationCode,
  generateInvitationCode,
  normalizeInvitationCode
} from "../../server/invitations.js";

test("invitation codes encode exactly 128 random bits as Crockford Base32", () => {
  let requested;
  const zeros = generateInvitationCode((size) => {
    requested = size;
    return Buffer.alloc(size);
  });
  assert.equal(requested, 16);
  assert.equal(zeros, "00000-00000-00000-00000-000000");
  assert.equal(normalizeInvitationCode(zeros).length, 26);

  const ones = generateInvitationCode((size) => Buffer.alloc(size, 0xff));
  assert.equal(ones, "7ZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZZ");
});

test("normalization accepts lowercase and hyphens but rejects invalid codes", () => {
  assert.equal(
    normalizeInvitationCode("abcde-fghjk-mnpqr-stvwx-yz0123"),
    "ABCDEFGHJKMNPQRSTVWXYZ0123"
  );
  assert.throws(
    () => normalizeInvitationCode("ABCDE-FGHJI-MNPQR-STVWX-YZ0123"),
    (error) => error.code === "INVITE_INVALID"
  );
  assert.throws(
    () => normalizeInvitationCode("ABC"),
    (error) => error.code === "INVITE_INVALID"
  );
});

test("digests use the normalized code and never contain the code", () => {
  const formatted = "00000-00000-00000-00000-000000";
  const digest = digestInvitationCode(formatted.toLowerCase());
  assert.equal(digest, digestInvitationCode(normalizeInvitationCode(formatted)));
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.notEqual(digest, normalizeInvitationCode(formatted));
});
