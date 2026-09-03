// ============================================================================
// 🔴 **ゲストを開ける前に塞ぐ穴。いまは全部 `todo`（＝赤い）。**
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
// ## `todo` の意味
//
// node:test の `todo` は**実行するが、失敗しても suite を落とさない**。
// つまりこのファイルは「まだ塞いでいない」ことを毎回可視化しつつ、
// `npm test` は緑のままにできる。
//
// 🔴 **塞いだら `todo: true` を外すこと。** 外さないと、直したのに
// 見張りが働かない状態（このリポジトリが最も嫌う形）になる。
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
import { decideGuest, GUEST_UNATTESTED_LIMIT } from "../guest-quota.ts";

const ocrRoute = readFileSync("src/app/api/ocr/route.ts", "utf8");

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

test("🔴 P0-1: 端末を読めないゲストを通さない", { todo: true }, () => {
  const d = decideGuest("unsupported", { kind: "unknown", reason: "no_token" });
  assert.equal(
    d.allow,
    false,
    "端末トークンが無い／読めないゲストを通している。\n" +
      "  匿名 user_id は作り直せるので、DB 側の関門も一緒にリセットされる。\n" +
      "  **1 件ずつ無限に取れる。**",
  );
});

test("🔴 P0-1: attested でも、端末を読めなければ通さない", { todo: true }, () => {
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

test("🔴 P0-2: 端末カウンタを書けなければ、OCR を続行しない", { todo: true }, () => {
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

test("🔴 P0-3: 端末の残数より多い単位数を通さない", { todo: true }, () => {
  const i = ocrRoute.indexOf("decideGuest");
  assert.notEqual(i, -1, "ゲスト判定の呼び出しが見つからない");

  // `remaining` と `units` を比べている箇所があるか。
  const compares =
    /decision\.remaining\s*<\s*units|units\s*>\s*[\w.]*decision\.remaining|remaining\s*<\s*units|units\s*>\s*[\w.]*\bremaining\b/.test(
      ocrRoute,
    );
  assert.equal(
    compares,
    true,
    "端末側の残数と要求単位数を比べていない。\n" +
      "  残り 1 件でも 3 ページを 1 要求で通せる。\n" +
      "  `nextDeviceUsed` が 3 で頭打ちなので、**書き戻しでも気づけない。**",
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
});
