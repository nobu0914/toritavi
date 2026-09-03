// ============================================================================
// 🔴 **ゲストを開ける前に塞ぐ穴。2026-09-03 に P0 3 件を塞いだ。**
//
// ## なぜこの形で先に書くか（2026-09-03）
//
// 2026-08-31 の外部レビューで 14 件中 13 件が真だった。そのうち **2 件は
// 「検証が空振りしている」という指摘**だった:
//
//   - `guest-mode-spec.md` §16-1 の「合格」は、**端末トークンを一切送らずに
//     200 を得て ✅ と記録していた**。それはまさに P0 の迂回経路そのもの
//   - `verify_030.sql` は**落ちようがない条件**だった
//     （成功は `granted` なのに `st <> 'ok'` を合格としていた）
//
// **迂回を ✅ と記録していた。** だから「塞いでからテストを書く」順だと、
// また空振りに気づけない。**先に赤いテストを置いて、塞いだら緑になることで
// 確かめる。**
//
// ## 経緯
//
// 最初は 4 件を `todo` で置いた（node:test の `todo` は実行するが suite を
// 落とさないので、「まだ塞いでいない」を可視化しつつ `npm test` を緑に
// 保てる）。**同日に塞いだので `todo` を外した** —— 外さないと、直したのに
// 見張りが働かない状態（このリポジトリが最も嫌う形）になる。
//
// **いまはここが本物の見張り。** 塞ぎを戻すと赤くなる。
//
// ## ここに無いもの
//
// **P1 の本体（匿名を RLS が区別しない）はここでは測れない。**
// 匿名サインインが Supabase で無効なので、node からは匿名 JWT を作れない。
// 代わりに読み取りだけの SQL を用意した ——
// `toritavi_app/tool/guest_rls_evidence.sql`。
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  GLOBAL_ATTEMPTS_PER_MIN,
  GLOBAL_RESERVED_FOR_PRO,
  globalCapFor,
} from "../ai-guard.ts";
import { isBitStateNotFound } from "../devicecheck.ts";
import {
  decideGuest,
  guestUnitsExceedRemaining,
  GUEST_UNATTESTED_LIMIT,
} from "../guest-quota.ts";

const ocrRoute = readFileSync("src/app/api/ocr/route.ts", "utf8");
const attestRoute = readFileSync("src/app/api/guest/attest/route.ts", "utf8");

// ───────────────────────── P0-1 ─────────────────────────
//
// 端末トークンが無い／読めないと `decideGuest` が `allow: true` を返す。
// いまのコード:
//
//     if (device.kind === "unknown") {
//       return { allow: true, limit, used: 0, remaining: limit, writeBack: false };
//     }
//
// コメントは「利用者側（DB）の 3 件が必ず残る」と書いているが、
// **匿名 user_id は公開 API で作り直せる**ので DB 側も一緒にリセットされる。
// 結果、**1 件ずつ無限に取れる。**

test("🔴 P0-1: 端末を読めないゲストを通さない", () => {
  const d = decideGuest("unsupported", { kind: "unknown", reason: "no_token" });
  assert.equal(
    d.allow,
    false,
    "端末トークンが無い／読めないゲストを通している。\n" +
      "  匿名 user_id は作り直せるので、DB 側の関門も一緒にリセットされる。\n" +
      "  **1 件ずつ無限に取れる。**",
  );
});

test("🔴 P0-1: attested でも、端末を読めなければ通さない", () => {
  // 「App Attest が通っていれば読めなくてもよい」にしない。
  // attestation は**アプリが本物か**を示すだけで、**その端末が何件使ったか**
  // は示さない。ここを緩めると上限 3 件の側で同じ穴が開く。
  const d = decideGuest("attested", { kind: "unknown", reason: "no_token" });
  assert.equal(d.allow, false, "attested を理由に端末側の関門を素通りしている");
});

test("端末が読めているときは通す（塞ぎすぎていないこと）", () => {
  // **フェイルクローズにしすぎない。** 正常な端末まで弾いたら機能が死ぬ。
  // これは今も緑。P0-1 を直すときに巻き添えで壊さないための土台。
  const d = decideGuest("unsupported", { kind: "known", used: 0 });
  assert.equal(d.allow, true);
  assert.equal(d.limit, GUEST_UNATTESTED_LIMIT);
  assert.equal(d.remaining, GUEST_UNATTESTED_LIMIT);
});

test("使い切った端末は通さない（既存の関門が生きていること）", () => {
  const d = decideGuest("unsupported", { kind: "known", used: 1 });
  assert.equal(d.allow, false);
  assert.equal(d.reason, "device_exhausted");
});

// ───────────────────────── P0-2 ─────────────────────────
//
// `setGuestUsed` の失敗を無視して OCR を続行する。いまのコード:
//
//     const wrote = await setGuestUsed(guestDevice.token, next);
//     console.log("[OCR] guest device write:", next, wrote ? "ok" : "FAILED");
//
// **`wrote` はログに出るだけ。** 書けなくても Claude を呼ぶ。
// 端末カウンタが進まないので、**同じ端末で何度でも通る。**

test("🔴 P0-2: 端末カウンタを書けなければ、OCR を続行しない", () => {
  // ルートを実行する足場が無いので**ソースを検査する**。
  // 「`wrote` を条件に使っているか」を見る —— ログに出すだけでは
  // 書けなかったことが**動きに反映されない**。
  const i = ocrRoute.indexOf("const wrote = await setGuestUsed(");
  assert.notEqual(i, -1, "setGuestUsed の呼び出しが見つからない。検査を直すこと");

  // 呼び出しの直後 600 文字に、`wrote` を**判定に使う**形があるか。
  // `console.log(... wrote ? ...)` は表示であって判定ではないので、
  // それだけの場合は不合格にする。
  const after = ocrRoute.slice(i, i + 600);
  const usedAsGuard = /if\s*\(\s*!\s*wrote\s*\)/.test(after);
  assert.equal(
    usedAsGuard,
    true,
    "setGuestUsed の結果をログに出すだけで、判定に使っていない。\n" +
      "  **書けなくても Claude を呼ぶ**ので、同じ端末で何度でも通る。\n" +
      "  `if (!wrote) return ...` の形にすること。",
  );
});

// ───────────────────────── P0-3 ─────────────────────────
//
// `decision.remaining` と実際の `units` を比較していない。
// DB 側は `limitUnits` で頭打ちにしているが、**端末側の残数は見ていない**。
// 残り 1 件の端末が、3 ページを 1 要求で投げると 3 単位消費して通る
// （`nextDeviceUsed` は 3 で頭打ちなので、書き戻しでも気づけない）。

test("🔴 P0-3: 端末の残数より多い単位数を通さない", () => {
  const i = ocrRoute.indexOf("decideGuest");
  assert.notEqual(i, -1, "ゲスト判定の呼び出しが見つからない");

  // `remaining` と `units` を比べ、**その結果で断っている**か。
  //
  // 🔴 **条件の先頭から一致させる。** 最初は `if\s*\([^)]*…` という緩い形に
  //    していたが、変異検査で **`if (false && guestDecision && …)` を
  //    見逃した**（2026-09-03）。**無効化された関門を、生きていると読む** ——
  //    このファイルが塞ごうとしている形そのものだった。
  //
  // ⚠️ **ソース検査は「在ること」と「位置」しか示せない。**
  //    実行して確かめているわけではないので、書き方を変えられれば
  //    すり抜けうる。**それでも置く**のは、無いよりはるかに強いから。
  const guarded = /if\s*\(\s*guestDecision\s*&&\s*guestUnitsExceedRemaining\(/.test(
    ocrRoute,
  );
  assert.equal(
    guarded,
    true,
    "端末側の残数と要求単位数を比べていない。\n" +
      "  残り 1 件でも 3 ページを 1 要求で通せる。\n" +
      "  `nextDeviceUsed` が 3 で頭打ちなので、**書き戻しでも気づけない。**",
  );

  // 🔴 **予約の前に置くこと。** 後だと予約だけ取って断ることになり、
  //    DB 側の枠が減る（利用者から見れば「使っていないのに減った」）。
  const guardAt = ocrRoute.indexOf("guestUnitsExceedRemaining(guestDecision");
  const reserveAt = ocrRoute.indexOf("const begun = await beginOcrRequest(");
  assert.ok(guardAt > 0 && reserveAt > 0, "位置を測れない。検査を直すこと");
  assert.ok(
    guardAt < reserveAt,
    "残数の検査が予約より後ろにある。**予約だけ取って断る**形になる。",
  );
});

test("🔴 P0-3: 残数と単位数を突き合わせる関数が、境界で正しい", () => {
  // 「超えている」だけを弾く。**ちょうど使い切る要求は通す。**
  // ここを `>=` にすると、残り 3 件で 3 ページを送れなくなる。
  assert.equal(guestUnitsExceedRemaining({ remaining: 1 }, 1), false);
  assert.equal(guestUnitsExceedRemaining({ remaining: 1 }, 2), true);
  assert.equal(guestUnitsExceedRemaining({ remaining: 3 }, 3), false);
  assert.equal(guestUnitsExceedRemaining({ remaining: 3 }, 4), true);
  assert.equal(guestUnitsExceedRemaining({ remaining: 0 }, 1), true);
});

test("🔴 断る理由が 2 つに分かれている（文言を分けるため）", () => {
  // 「上限に達した」と「端末を確認できなかった」は、利用者に取れる手が
  // 違う（登録／再試行）。**まとめると設定ミスの人に「使い切った」と嘘をつく。**
  const unreadable = decideGuest("unsupported", { kind: "unknown", reason: "no_token" });
  const exhausted = decideGuest("unsupported", { kind: "known", used: 1 });
  assert.equal(unreadable.reason, "device_unreadable");
  assert.equal(exhausted.reason, "device_exhausted");
  assert.notEqual(unreadable.reason, exhausted.reason);
});

test("🔴 route が理由で文言を分けている", () => {
  assert.ok(
    ocrRoute.includes('decision.reason === "device_unreadable"'),
    "理由を見ずに 1 つの文言でまとめている",
  );
});

// ───────────────────────── P1: environment ─────────────────────────
//
// `environment` を検証結果ではなく `APPLE_APPATTEST_ALLOW_DEV` から
// 記録していた（P1）。`allowDevelopment: true` のときは development も
// production も通るので、**設定からは実際の環境を復元できない** ——
// 本番の端末に development の印が付く（逆も）。

test("🔴 P1: attest の environment を、設定ではなく検証結果から書く", () => {
  assert.ok(
    /patch\.environment\s*=\s*result\.environment/.test(attestRoute),
    "environment を検証結果から書いていない。\n" +
      "  設定（ALLOW_DEV）から書くと、**何だったかではなく何を許したか**を\n" +
      "  記録することになる。",
  );
  assert.ok(
    !/patch\.environment\s*=\s*ALLOW_DEV/.test(attestRoute),
    "🔴 ALLOW_DEV から書く形が残っている。",
  );
});

test("🔴 P1: 検証が環境を返さなければ、推測で埋めない", () => {
  // `?? null` で落とす。`?? "production"` にすると、**確かめていないものを
  // 本番だと名乗る**ことになる（このリポジトリが最も嫌う形）。
  assert.ok(
    /patch\.environment\s*=\s*result\.environment\s*\?\?\s*null/.test(attestRoute),
    "環境が不明なときに既定値で埋めている。null にすること。",
  );
});

// ───────────────────── 検査が空振りしていないこと ─────────────────────

test("🔴 検査の土台：ルートのソースを実際に読めている", () => {
  // **空文字と比べて緑になる形を塞ぐ。** パスが変わって読めなくなると、
  // 上の `indexOf` が全部 -1 になり、assert の前に落ちる ——
  // ように見えるが、`todo` の中では落ちても suite が緑のままなので
  // 気づけない。ここだけ `todo` なしで置く。
  assert.ok(ocrRoute.length > 5000, "route.ts を読めていない（パスが変わった？）");
  assert.ok(
    ocrRoute.includes("setGuestUsed"),
    "route.ts にゲストの書き戻しが無い。実装が動いた？",
  );
  assert.ok(
    attestRoute.length > 2000 && attestRoute.includes("verifyAppAttest"),
    "attest ルートを読めていない（パスが変わった？）",
  );
});

// ============================================================================
// 🔴 **2026-09-04 の外部監査（ChatGPT / Fable）で出た指摘の再発防止。**
//    どれも「落ちも警告も出ないまま効かなくなる」形（`CLAUDE.md` §6-1）。
// ============================================================================

test("🔴 DeviceCheck の不明な 200 を「未使用」に化けさせない", () => {
  // 枠は**この応答だけ**で決まる。設定ミスや中継の異常が
  // そのまま**無料枠の復活**になる経路だった。
  assert.equal(isBitStateNotFound("Failed to find bit state"), true);
  assert.equal(isBitStateNotFound("  failed to find bit state \n"), true,
    "大小・空白の揺れで閉じすぎない");
  // 🔴 ここが true に戻ると、穴も戻る。
  assert.equal(isBitStateNotFound(""), false, "空の本文");
  assert.equal(isBitStateNotFound("<html>503</html>"), false, "中継が返した HTML");
  assert.equal(isBitStateNotFound('{"bit0":true}'), false, "欠けた JSON");

  const src = readFileSync("src/lib/devicecheck.ts", "utf8");
  assert.ok(
    /isBitStateNotFound\(text\)/.test(src),
    "🔴 判定が呼ばれていない。200 なら何でも初回扱いに戻っている",
  );
});

test("🔴 再 attestation でカウンタを捨てる（鍵と一組）", () => {
  const src = readFileSync("src/app/api/guest/attest/route.ts", "utf8");
  // 新しい鍵は小さい signCount から始まる。古い値が残ると
  // **assertion が永久に通らず、黙って上限 1 件へ縮退する。**
  assert.ok(
    /patch\.assert_counter\s*=\s*null/.test(src),
    "🔴 鍵を差し替えてカウンタを残している。入れ直した端末が二度と通らない",
  );
  // 公開鍵と同じ節にあること（片方だけ替えない）。
  const i = src.indexOf("patch.public_key");
  const j = src.indexOf("patch.assert_counter");
  assert.ok(i > 0 && j > i && j - i < 1500,
    "🔴 公開鍵とカウンタが別の場所で更新されている。一組で扱うこと");
});

test("🔴 掃除 cron が途中で殺されない（maxDuration）", () => {
  const src = readFileSync("src/app/api/cron/purge-anonymous/route.ts", "utf8");
  assert.ok(
    /export const maxDuration\s*=\s*\d+/.test(src),
    "🔴 既定（10 秒）では足りない。途中で殺されると集計ログが出ず、"
      + "「呼ばれていない」と区別できない",
  );
});

// ============================================================================
// 🔴 **同じ端末の要求を 1 本ずつに並べる**（2026-09-04 の外部監査・P0）。
//
// DeviceCheck は「聞く」と「書く」しか無く、その間に検証と予約が挟まる。
// 使用数 0 の端末から 3 本同時に出すと**3 本とも 0 を読み**、3 本とも通る。
// 「3 件使ったのに DeviceCheck は 1」になり、匿名 ID を作り直して繰り返せる。
//
// Apple の API に加算も比較交換も無いので、**こちらで並べるしかない。**
// ============================================================================

test("🔴 端末の鍵は queryGuestUsed より前に取る", () => {
  const src = (readFileSync("src/app/api/ocr/route.ts", "utf8"));
  const claim = src.indexOf("claimGuestDevice(");
  const query = src.indexOf("queryGuestUsed(token)");
  assert.ok(claim > 0, "🔴 端末の排他が無い。3 本同時に出すと 3 本とも通る");
  assert.ok(query > 0);
  assert.ok(
    claim < query,
    "🔴 鍵を取るのが読み取りより後ろ。守りたい「読む→書く」が鍵の外に出る",
  );
});

test("🔴 取れなかったら通さない", () => {
  const src = (readFileSync("src/app/api/ocr/route.ts", "utf8"));
  assert.ok(
    /guestLock\.reason === "busy"/.test(src),
    "🔴 busy を見ていない",
  );
  assert.ok(
    /guest_device_busy/.test(src),
    "🔴 断っていない。通すとこの仕組みが何もしないのと同じになる",
  );
});

test("🔴 どの出口を通っても鍵を返す（finally）", () => {
  const src = readFileSync("src/app/api/ocr/route.ts", "utf8");
  assert.ok(
    /\}\s*finally\s*\{[\s\S]*releaseGuestDevice\(/.test(src),
    "🔴 finally で返していない。返し忘れると、その端末が TTL のあいだ"
      + "締め出される（正規の利用者が使えなくなる）",
  );
});

test("🔴 並べる鍵は key_hash（端末トークンでも user_id でもない）", () => {
  const src = (readFileSync("src/lib/guest-device-lock.ts", "utf8"));
  // 端末トークンは要求ごとに変わり、匿名 user_id は作り直せる。
  // **またいで並べられるのは key_hash だけ。**
  assert.ok(/keyHash/.test(src), "🔴 key_hash で並べていない");
  const route = (readFileSync("src/app/api/ocr/route.ts", "utf8"));
  assert.ok(
    /select\("attested, public_key, assert_counter, key_hash"\)/.test(route),
    "🔴 key_hash を読んでいない。鍵が常に無い扱いになり、並ばない",
  );
});

// ============================================================================
// 🔴 **Pro の可用性を、無料アカウントの数で奪わせない**（2026-09-04 の外部監査・P1）。
//
// 全体の試行上限（120/分）は**受け手を区別しない**共有バケットだった。
// 予算は受け手ごとに分かれているので「ゲストが使い切っても Pro は止まらない」
// は**金銭には真だが可用性には偽**。無効な要求でも共有枠は消費するので、
// 匿名／無料アカウントを増やせば**払っている人まで 429 にできた。**
// ============================================================================

test("🔴 pro には予約枠が残る", () => {
  // pro は全体をそのまま使える。それ以外は予約分だけ低い。
  assert.equal(globalCapFor("pro"), GLOBAL_ATTEMPTS_PER_MIN);
  assert.ok(
    globalCapFor("free") < GLOBAL_ATTEMPTS_PER_MIN,
    "🔴 free が全体を使い切れる。pro の枠が残らない",
  );
  assert.equal(globalCapFor("guest"), globalCapFor("free"),
    "guest と free は同じ扱いでよい（どちらも払っていない）");
  assert.equal(
    globalCapFor("free"),
    GLOBAL_ATTEMPTS_PER_MIN - GLOBAL_RESERVED_FOR_PRO,
  );
});

test("🔴 予約が大きすぎても誰も通らなくならない", () => {
  // 設定を触った人が予約を上限以上にしても、下限 1 で止まる。
  assert.ok(globalCapFor("free") >= 1);
});

test("🔴 受け手ごとの上限を実際に渡している", () => {
  const src = readFileSync("src/lib/ai-guard.ts", "utf8");
  assert.ok(
    /p_global_per_min:\s*globalCapFor\(audience\)/.test(src),
    "🔴 固定値を渡している。受け手で変わらないなら予約は効かない",
  );
});
