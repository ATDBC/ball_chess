import test from "node:test";
import assert from "node:assert/strict";
import { MatchApi, ApiError } from "../../web/api.js";

test("submitAction forwards the bearer, version and untouched action", async () => {
  const calls = [];
  const api = new MatchApi({
    baseUrl: "http://local.test",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ version: 3 }) };
    }
  });
  const action = { type: "place_wall", orientation: "v", x: 3, y: 4 };
  await api.submitAction("m_test", "seat_secret", 2, action);
  assert.equal(calls[0].url, "http://local.test/api/matches/m_test/actions");
  assert.equal(calls[0].options.headers.authorization, "Bearer seat_secret");
  assert.deepEqual(JSON.parse(calls[0].options.body), { expectedVersion: 2, action });
});

test("API errors preserve recovery state and structured details", async () => {
  const api = new MatchApi({
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: "STALE_STATE", message: "old", details: { currentVersion: 4 } }, state: { version: 4 } })
    })
  });
  await assert.rejects(api.state("m_test", "bad"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "STALE_STATE");
    assert.deepEqual(error.details, { currentVersion: 4 });
    assert.deepEqual(error.state, { version: 4 });
    return true;
  });
});

test("events uses the injected EventSource factory", () => {
  const source = {};
  const api = new MatchApi({ eventSourceFactory: (url) => { source.url = url; return source; } });
  assert.equal(api.events("m_test"), source);
  assert.equal(source.url, "/api/matches/m_test/events");
});
