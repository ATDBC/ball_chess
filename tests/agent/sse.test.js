import test from "node:test";
import assert from "node:assert/strict";
import { readSseData } from "../../agent/sse.js";

test("SSE parser joins fragmented data and ignores comments", async () => {
  const encoder = new TextEncoder();
  const chunks = [": keepalive\r\n\r\ndata: {\"version\":", "2}\r\n\r\n"];
  const stream = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } });
  const values = [];
  for await (const value of readSseData(stream)) values.push(JSON.parse(value));
  assert.deepEqual(values, [{ version: 2 }]);
});

test("SSE parser cancels the reader when aborted", async () => {
  let canceled = false;
  const stream = new ReadableStream({ cancel() { canceled = true; } });
  const controller = new AbortController();
  const reading = (async () => { for await (const _value of readSseData(stream, controller.signal)) {} })();
  controller.abort();
  await reading;
  assert.equal(canceled, true);
});
