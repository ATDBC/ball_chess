import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("page owns controls by outside, waiting, playing, and finished stages", async () => {
  const html = await readFile(new URL("../../web/index.html", import.meta.url), "utf8");
  for (const stage of ["outside", "waiting", "playing", "finished"]) {
    assert.match(html, new RegExp(`data-stage-panel=["']${stage}["']`));
  }
  assert.match(html, /id="invite-code"/);
  assert.match(html, /id="spectate-id"/);
  assert.match(html, /<details[^>]*id="compatibility-join"/);
  assert.match(html, /id="finished-record"/);
});
