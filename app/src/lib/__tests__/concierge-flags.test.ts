// ============================================================================
// 🔴 **コンシェルジュ API が、サーバ側でも閉じていること**（JR000187）。
//
// アプリ側は `kConciergeEnabled = false` で**導線が無いだけ。API は生きていた。**
// `/api/concierge` の POST に機能フラグの門が **0 件**だった。
//
// 🔴 `concierge-context.ts` は**確認番号とメモ**を文脈に含める。
// 素通しだと、旅程の題名・メモ・確認番号が Anthropic へ出うる。
//
// **アプリのフラグはサーバを閉じない**（`CLAUDE.md` §5「1 か所で ✅ に
// しない」）。JR000081（`/api/ocr` の許諾）と同じ型。
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CONCIERGE_ENABLED } from "../concierge-flags.ts";

/** 行コメントを落とす。**注記に名前があるだけで通さない。** */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

const ROUTE = "src/app/api/concierge/route.ts";

test("🔴 開いているなら、開ける条件がすべて配線されている", () => {
  // 🔴 **値そのものは固定しない**（2026-09-22 に書き換えた）。
  //    それまでは `assert.equal(CONCIERGE_ENABLED, false)` で釘付けていたが、
  //    **開け閉めは判断であって誤りではない。** `isFalse` に釘付けると
  //    開けた人が必ずここを書き換えることになり、見張りとして働かない
  //    （`toritavi_app/test/core/purchases_gate_test.dart` と同じ考え方）。
  //
  //    代わりに「**開いているなら、開ける条件が揃っていること**」を見る。
  //    閉じているあいだは何も要求しない。
  if (!CONCIERGE_ENABLED) return;

  const c = code(ROUTE);

  // 1) 🔴 降ろした本体の理由 —— 実在しない URL の担保。
  assert.ok(
    c.includes("stripDisallowedUrls("),
    "🔴 許可リストを通していない。**2026-08-01 に降ろした理由そのもの** ——\n" +
      "  AI が実在しない URL を出しうるのに検査が無い状態へ戻る。\n" +
      "  プロンプトの「実在する公式サイトのみ」は指示であって担保ではない",
  );

  // 2) 🔴 AI 送信の許諾（サーバ側）。アプリ側のゲートはサーバを閉じない。
  assert.ok(
    c.includes("decideAiConsentFromServer("),
    "🔴 許諾をサーバで見ていない。`/api/concierge` を直接叩けば素通りする。\n" +
      "  `concierge-context.ts` は確認番号とメモを文脈に含める",
  );

  // 3) 🔴 非常停止スイッチ。
  assert.ok(
    c.includes('getAiMode("concierge")') && c.includes("modeAllows("),
    "🔴 非常停止スイッチが効かない。off にしても API を直接叩けば呼べる",
  );

  // 4) 🔴 原子的な予約（「見てから足す」に戻さない）。
  assert.ok(
    c.includes("beginConcierge("),
    "🔴 予約していない。同時に投げた分が全部通り、上限も予算も超えられる",
  );

  // 5) 🔴 SDK の自動再送を切る（実費が最大 3 倍になる）。
  assert.ok(
    /new Anthropic\(\s*\{[^}]*maxRetries:\s*0/.test(c),
    "🔴 `maxRetries: 0` が無い。5xx / 429 のたびに再送され、そのたびに課金される",
  );

  // 6) 🔴 モデレーションはフェイルクローズ（支払いが発生する経路だから）。
  assert.ok(
    c.includes("assertActiveOr403Strict("),
    "🔴 フェイルオープン版を使っている。判定が読めない間、\n" +
      "  凍結済みの利用者が支払いを発生させられる",
  );
  assert.ok(
    !/\bassertActiveOr403\(/.test(c),
    "🔴 フェイルオープン版が残っている",
  );
});

test("🔴 POST がフラグで落ちる（配線されている）", () => {
  const c = code(ROUTE);
  assert.ok(
    c.includes("if (!CONCIERGE_ENABLED)"),
    "🔴 ルートにフラグの門が無い。定数があっても API は開いたまま",
  );
});

test("🔴 門が、認証や本文の読み取りより前にある", () => {
  // 閉じている機能のために本文を読む理由が無い。
  // 後ろに置くと、閉じているのに本文（旅程の題名・確認番号）を受け取る。
  const c = code(ROUTE);
  // 🔴 **import 行を数えない。** 最初は `indexOf("authenticateRequest")` で
  //    見ていて、**import(465) を掴んで常に赤**になった。呼び出し側を見る。
  const gate = c.indexOf("if (!CONCIERGE_ENABLED)");
  const auth = c.indexOf("await authenticateRequest(");
  const body = c.indexOf("await request.json()");
  assert.ok(gate > -1, "門が無い");
  assert.ok(gate < auth, `🔴 門(${gate}) が認証(${auth}) より後ろ`);
  assert.ok(gate < body, `🔴 門(${gate}) が本文の読み取り(${body}) より後ろ`);
});

test("陰性対照: 文脈に確認番号とメモが入ることを確かめる（閉じる理由）", () => {
  // ここが入らなくなったら、閉じる理由の重さが変わる。
  // **理由が消えたのに門だけ残っている**状態を、黙って続けない。
  const c = code("src/lib/concierge-context.ts");
  assert.ok(
    c.includes("confNumber") || c.includes("conf_number"),
    "確認番号を文脈に入れなくなった。閉じる理由を見直すこと",
  );
});
