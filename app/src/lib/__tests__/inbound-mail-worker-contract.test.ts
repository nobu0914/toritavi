// ============================================================================
// 🔴 **Email Worker（workers/inbound-mail）とサーバの取り決めがずれていないこと。**
//
// 2 つは別々に出る（Worker は wrangler、サーバは Vercel）。署名の対象や宛先の
// 判定がずれると、**全部のメールが 401 か「宛先不明」で落ちる。** どちらの
// テストも単独では緑のまま —— 互いの実物を呼び合って初めて見える。
// ============================================================================
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_RAW_BYTES,
  shouldAccept,
  signInbound as workerSign,
} from "../../../workers/inbound-mail/src/lib.ts";
import { INBOUND_MAX_BYTES, extractAliasToken, verifyInboundSignature } from "../inbound-mail.ts";

test("🔴 Worker の署名をサーバの検証が通す", async () => {
  const ts = Math.floor(Date.now() / 1000).toString();
  const to = "trips-abcdefghijkmnpqr@junros.com";
  for (const from of ["sender@example.com", ""]) {
    const sig = await workerSign("contract-secret", ts, to, from, 123_456);
    assert.deepEqual(
      verifyInboundSignature({
        secret: "contract-secret",
        timestamp: ts,
        to,
        from,
        signature: sig,
        bodyByteLength: 123_456,
      }),
      { ok: true },
    );
  }
});

test("🔴 宛先の判定が同じ（Worker が通すものだけをサーバも通す）", () => {
  const cases = [
    "trips-abcdefghijkmnpqr@junros.com",
    "trips-abcdefghijkmnpqr@JUNROS.com",
    "trips-ABCDEFGHIJKMNPQR@junros.com",
    "trips-abcdefghijklmnpq@junros.com",
    "trips-abcdefghijkmnpq@junros.com",
    "trips-abcdefghijkmnpqr@evil.example",
    "hello@junros.com",
    "",
  ];
  for (const to of cases) {
    const worker = shouldAccept(to, 10, "junros.com") === "ok";
    const server = extractAliasToken(to, "junros.com") !== null;
    assert.equal(worker, server, `判定がずれている: ${to}`);
  }
});

test("🔴 サーバの上限は Worker の上限以上（Worker を通った正規のメールを 413 で捨てない）", () => {
  assert.ok(INBOUND_MAX_BYTES >= MAX_RAW_BYTES);
});
