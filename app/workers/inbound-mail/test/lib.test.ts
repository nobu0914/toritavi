// Worker の純粋な部品の検査（node --test・追加の依存なし）。
//   cd workers/inbound-mail && npm test
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { MAX_RAW_BYTES, shouldAccept, signInbound, upstreamOutcome } from "../src/lib.ts";

const D = "junros.com";

test("宛先: 正しい形だけ受け取る", () => {
  assert.equal(shouldAccept("trips-abcdefghijkmnpqr@junros.com", 1000, D), "ok");
  assert.equal(shouldAccept("trips-abcdefghijkmnpqr@JUNROS.COM", 1000, D), "ok");
  for (const bad of [
    "trips-ABCDEFGHIJKMNPQR@junros.com",
    "trips-abcdefghijklmnpq@junros.com",
    "trips-abcdefghijkmnpq@junros.com",
    "trips-abcdefghijkmnpqr@evil.example",
    "info@junros.com",
    "",
  ]) {
    assert.equal(shouldAccept(bad, 1000, D), "bad_recipient", bad);
  }
});

test("大きさ: 4,000,000 バイトまで", () => {
  assert.equal(shouldAccept("trips-abcdefghijkmnpqr@junros.com", MAX_RAW_BYTES, D), "ok");
  assert.equal(shouldAccept("trips-abcdefghijkmnpqr@junros.com", MAX_RAW_BYTES + 1, D), "too_large");
});

test("署名: Node の HMAC と同じ値になる", async () => {
  const got = await signInbound("s3cret", "1800000000", "trips-a@x", "f@y", 42);
  const want = createHmac("sha256", "s3cret").update("1800000000.trips-a@x.f@y.42").digest("hex");
  assert.equal(got, want);
});

test("応答: 401 と 5xx は再送、それ以外は終わり", () => {
  assert.equal(upstreamOutcome(200), "done");
  assert.equal(upstreamOutcome(413), "done");
  assert.equal(upstreamOutcome(400), "done");
  assert.equal(upstreamOutcome(401), "retry");
  assert.equal(upstreamOutcome(500), "retry");
  assert.equal(upstreamOutcome(503), "retry");
});
