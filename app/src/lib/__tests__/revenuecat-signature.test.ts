// RevenueCat の webhook 署名検証。
//
// 🔴 **共有シークレットだけでは足りない。** 漏れた時点で本文を自由に作れ、
// `INITIAL_PURCHASE` と任意の `app_user_id` を送るだけで
// **一円も払わずに Pro になれる**（2026-08-29 のレーン 8 検査）。
//
// ここで固定するのは 4 つ:
//   1. 正しい署名は通る
//   2. 本文を 1 バイト変えたら落ちる（改ざん）
//   3. 古い署名は落ちる（再送）
//   4. 鍵が未設定のときは通すが、**enforced=false を返して呼び出し側に知らせる**
//      （黙って弱いまま動かさないため）

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  SIGNATURE_TOLERANCE_MS,
  verifyRevenueCatSignature,
} from "../revenuecat-signature.ts";

const SECRET = "whsec-test-1234567890";
const NOW = 1_787_992_400_000; // 固定。Date.now() を使うとテストが時計に依存する

function sign(raw: string, atMs: number, secret = SECRET): string {
  const t = Math.floor(atMs / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

const BODY = JSON.stringify({
  event: { type: "INITIAL_PURCHASE", app_user_id: "u-1", entitlement_ids: ["pro"] },
});

test("正しい署名は通り、強制されたと分かる", () => {
  const r = verifyRevenueCatSignature(BODY, sign(BODY, NOW), SECRET, NOW);
  assert.deepEqual(r, { ok: true, enforced: true });
});

test("本文を 1 文字変えたら落ちる", () => {
  const header = sign(BODY, NOW);
  const tampered = BODY.replace('"pro"', '"pro "');
  const r = verifyRevenueCatSignature(tampered, header, SECRET, NOW);
  assert.equal(r.ok, false);
  assert.equal((r as { reason: string }).reason, "signature_mismatch");
});

test("別の鍵で作った署名は落ちる", () => {
  const r = verifyRevenueCatSignature(BODY, sign(BODY, NOW, "other"), SECRET, NOW);
  assert.equal(r.ok, false);
});

test("古い署名は落ちる（再送）", () => {
  const old = NOW - SIGNATURE_TOLERANCE_MS - 1000;
  const r = verifyRevenueCatSignature(BODY, sign(BODY, old), SECRET, NOW);
  assert.equal(r.ok, false);
  assert.equal((r as { reason: string }).reason, "signature_stale");
});

test("許容範囲内のずれは通る", () => {
  const recent = NOW - SIGNATURE_TOLERANCE_MS + 1000;
  assert.equal(verifyRevenueCatSignature(BODY, sign(BODY, recent), SECRET, NOW).ok, true);
});

test("ヘッダが無い / 壊れている", () => {
  assert.equal(verifyRevenueCatSignature(BODY, null, SECRET, NOW).ok, false);
  assert.equal(verifyRevenueCatSignature(BODY, "garbage", SECRET, NOW).ok, false);
  assert.equal(verifyRevenueCatSignature(BODY, "t=1", SECRET, NOW).ok, false);
});

test("鍵が未設定なら通すが、enforced=false で知らせる", () => {
  // 🔴 ここが `true` に変わったら、**黙って弱いまま動く**ようになる。
  // 呼び出し側はこの値を見てログを出している。
  const r = verifyRevenueCatSignature(BODY, null, undefined, NOW);
  assert.deepEqual(r, { ok: true, enforced: false });
});
