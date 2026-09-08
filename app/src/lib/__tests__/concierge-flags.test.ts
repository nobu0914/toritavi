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

test("🔴 コンシェルジュは閉じたまま", () => {
  assert.equal(
    CONCIERGE_ENABLED,
    false,
    "CONCIERGE_ENABLED を true にした。\n" +
      "  🔴 開けるときは 4 つ同時に動かす —— アプリの kConciergeEnabled ／\n" +
      "  ここ ／ AI 許諾（decideAiConsent）をこの経路にも配線 ／\n" +
      "  docs/feature-flags.md §1.4 の表。\n" +
      "  2026-08-01 に降ろした理由（実在しない URL を出しうるのに検査が無い）が\n" +
      "  片付いているかも確かめること",
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
