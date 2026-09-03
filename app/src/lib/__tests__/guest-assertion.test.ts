// ============================================================================
// 🔴 **assertion のカウンタ判定。** 署名の検証だけでは、正しい署名の
//    **古い 1 通**を使い回せる（再生攻撃）。
//
// 2026-08-31 の外部レビュー P1（`guest-mode-spec.md` §23）——
// 「assertion を要求ごとに検証していない。保存した公開鍵が使われていない」。
//
// 署名そのものの検証は端末が要る（実機の App Attest）ので、ここでは
// **境界の判定**を固定する。**そこが緩むと、検証を足した意味が消える。**
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { acceptAssertionCounter, verifyGuestAssertion } from "../guest-assertion.ts";

test("初回（保存値なし）は受ける", () => {
  assert.equal(acceptAssertionCounter(null, 0), true);
  assert.equal(acceptAssertionCounter(undefined, 1), true);
});

test("🔴 増えていれば受ける・同値は拒む（再生）", () => {
  assert.equal(acceptAssertionCounter(1, 2), true);
  assert.equal(
    acceptAssertionCounter(1, 1),
    false,
    "同じカウンタは同じ assertion。通すと 1 通を無限に使い回せる",
  );
});

test("🔴 戻っているものは拒む", () => {
  assert.equal(acceptAssertionCounter(5, 4), false);
  assert.equal(acceptAssertionCounter(5, 0), false);
});

test("整数でない・負の値は拒む", () => {
  assert.equal(acceptAssertionCounter(null, -1), false);
  assert.equal(acceptAssertionCounter(null, 1.5), false);
  assert.equal(acceptAssertionCounter(null, Number.NaN), false);
});

test("🔴 公開鍵が無ければ通さない（「確かめられない」ではなく「資格が無い」）", () => {
  const r = verifyGuestAssertion({
    assertion: "AAAA",
    payload: "req-1",
    publicKey: null,
    previousCounter: null,
    teamId: "TEAMID1234",
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "no_public_key");
});

test("teamId が無ければ通さない", () => {
  const r = verifyGuestAssertion({
    assertion: "AAAA",
    payload: "req-1",
    publicKey: "pk",
    previousCounter: null,
    teamId: "",
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "no_team_id");
});

test("壊れた assertion は verify_failed（例外を漏らさない）", () => {
  const r = verifyGuestAssertion({
    assertion: "bm90LWFuLWFzc2VydGlvbg==",
    payload: "req-1",
    publicKey: "not-a-key",
    previousCounter: null,
    teamId: "TEAMID1234",
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "verify_failed");
});

test("🔴 端末側が署名する対象と、サーバが渡す payload が揃っている", () => {
  // Swift は `SHA256(challenge)` を clientDataHash として署名し、
  // ライブラリは `sha256(payload)` を計算する。**こちらでハッシュしない。**
  // 片方だけ変えると検証が必ず落ちる（しかも理由は「invalid assertion」だけ）。
  // 🔴 **リポジトリを跨ぐ検査。** アプリ側（`~/Dev/toritavi_app`）が
  //    隣に無いと落ちる。**落ちてよい** —— 端末とサーバで署名の対象が
  //    揃っているかは、片方だけ見ても確かめられない。
  //    （落ちたら、まずこのパスを疑うこと。2026-09-03 に一度間違えた）
  const SWIFT = "../../toritavi_app/ios/Runner/AppAttestChannel.swift";
  const swift = readFileSync(SWIFT, "utf8");
  assert.ok(
    /generateAssertion/.test(swift),
    "端末側に generateAssertion が無い。サーバだけ作っても誰も通れない",
  );
  assert.ok(
    /let assertionHash = Data\(SHA256\.hash\(data: challenge\)\)/.test(swift),
    "端末側のハッシュの取り方が変わっている。サーバの payload と揃わなくなる",
  );
  const src = readFileSync("src/lib/guest-assertion.ts", "utf8");
  assert.ok(
    !/createHash\("sha256"\)/.test(src),
    "🔴 サーバ側で二重にハッシュしている。ライブラリが内部で取るので不要",
  );
});
