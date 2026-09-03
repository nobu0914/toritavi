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
import {
  acceptAssertionCounter,
  guestAssertCounterPersisted,
  verifyGuestAssertion,
} from "../guest-assertion.ts";

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

// ============================================================================
// 🔴 **2026-09-03 に実機で見つけたバグの再発防止。**
//
// `.lt("assert_counter", n)` だけで書き戻していた。SQL の `NULL < 5` は
// **偽ではなく NULL** なので、初期値が NULL の間は一致する行が 0 件になる。
// **0 件更新はエラーではない**ので、そのまま通過していた。
//
// 結果、`assert_counter` は永久に NULL のままで、
// `acceptAssertionCounter(null, x)` が常に真を返し、
// **同じ署名を何度でも使い回せた。** 再生防御が一度も働いていない。
//
// 実機のゲスト読み取りが 2 件通っても NULL のままだったことで判明。
// **単体テストもソース検査も緑のままだった** —— どちらも
// PostgREST の NULL の意味までは見ていなかった（`CLAUDE.md` §6-1）。
// ============================================================================

test("🔴 保存されたカウンタが要求のカウンタ以上でなければ通さない", () => {
  // **NULL は「書けなかった」。** ここが true を返すと、バグが元に戻る。
  assert.equal(guestAssertCounterPersisted(null, 1), false);
  assert.equal(guestAssertCounterPersisted(undefined, 1), false);
  // 進んでいない
  assert.equal(guestAssertCounterPersisted(0, 1), false);
  // 進んだ
  assert.equal(guestAssertCounterPersisted(1, 1), true);
  // 並んだ要求が先に進めた（0 件更新だが、値としては満たしている）
  assert.equal(guestAssertCounterPersisted(5, 1), true);
});

test("🔴 書き戻しの条件に NULL が含まれている", () => {
  const src = readFileSync("src/app/api/ocr/route.ts", "utf8");
  // 🔴 `.lt()` 単独に戻っていないこと。**これがバグそのものの形。**
  assert.ok(
    /assert_counter\.is\.null,assert_counter\.lt\./.test(src),
    "🔴 NULL を含めていない。初期値が NULL の間、カウンタは一度も書かれない",
  );
  assert.ok(
    !/\.lt\("assert_counter"/.test(src),
    "🔴 `.lt(\"assert_counter\", …)` に戻っている（NULL に一致しない）",
  );
});

test("🔴 書けたことを確かめている（0 件更新を成功にしない）", () => {
  const src = readFileSync("src/app/api/ocr/route.ts", "utf8");
  assert.ok(
    src.includes("guestAssertCounterPersisted("),
    "🔴 保存の確認が無い。0 件更新はエラーにならないので、黙って通る",
  );
});

// ============================================================================
// 🔴 **カウンタの書き戻しは service client で行う。**
//
// `toritavi_guest_grants` は **利用者が読めるが書けない**設計（028 の RLS）。
// 書けたら `attested = true` を自分で立てられ、検証が無意味になるため、
// `guest/attest/route.ts` の書き込みは全て `createServiceClient()` を使う。
//
// にもかかわらず、2026-09-03 に足したカウンタの書き戻しは
// `authenticateRequest` が返す**利用者スコープ**のクライアント（RLS 適用）で
// 書いていた。**どちらに転んでも壊れる:**
//
//   - RLS が拒めば 0 件更新 → 保存確認が false → **attested なゲスト全員が 503**
//   - RLS が許していれば、匿名が PostgREST 直叩きで attested を立てられる
//
// 🔴 **注記は同じファイルにあったのに、そこへ書いてしまった。**
//    だから注記ではなく検査で止める。
// ============================================================================

test("🔴 カウンタの書き戻しに利用者スコープのクライアントを使わない", () => {
  const src = readFileSync("src/app/api/ocr/route.ts", "utf8");
  // 書き戻しの前後を切り出して、そこに `sb` の更新が無いことを見る。
  const i = src.indexOf("acceptedCounter !== null");
  assert.ok(i > 0, "書き戻しの節が見つからない");
  const block = src.slice(i, i + 2500);
  assert.ok(
    !/await\s+sb\s*\n?\s*\.from\("toritavi_guest_grants"\)\s*\n?\s*\.update\(/.test(
      block,
    ),
    "🔴 RLS が適用されるクライアントで書いている。attested なゲストが全員 503 になる",
  );
  assert.ok(
    /createServiceClient\(\)/.test(block),
    "🔴 service client を使っていない",
  );
  // 🔴 **他人の行に触れない条件を外さない。** service client は RLS を
  //    迂回するので、ここが消えると誰の行でも書ける。
  assert.ok(
    /\.eq\("user_id",\s*userId\)/.test(block),
    "🔴 user_id の絞り込みが無い。service client は RLS を迂回する",
  );
});
