// ============================================================================
// 🔴 **画面に記号として出る Markdown を落とすこと**（2026-09-23）。
//
// 実機の画面にこう出ていた:
//
//   申し訳ありませんが、**本日の日付が不明** なため、…
//                       ^^              ^^ アスタリスクが見えている
//
// `concierge_screen.dart` は `SelectableText(msg.text)` ——
// **素のテキストで描き、Markdown を解釈しない。** それでいて
// システムプロンプトは「Markdown 装飾は最小限（**太字のみ可**）」と
// **太字を明示的に許可していた。**
//
// 🔴 **プロンプトで禁じるだけでは足りない。** `url-allowlist.ts` と同じ理屈 ——
//    「プロンプトの指示は担保ではない」。**仕組みで落とす。**
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { stripMarkdown } from "../strip-markdown.ts";

/** 行コメントを落とす。**注記に名前があるだけで通さない。** */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

const ROUTE = "src/app/api/concierge/route.ts";

test("実機で出た文がそのまま直る", () => {
  const got = stripMarkdown("申し訳ありませんが、**本日の日付が不明** なため、");
  assert.equal(got.text, "申し訳ありませんが、本日の日付が不明 なため、");
  assert.equal(got.removed, 1);
});

test("見出し・斜体・コードも落ちる", () => {
  assert.equal(stripMarkdown("## 当日の動線").text, "当日の動線");
  assert.equal(stripMarkdown("これは *目安* です").text, "これは 目安 です");
  assert.equal(stripMarkdown("`NH006` 便").text, "NH006 便");
});

test("🔴 対になっていない ** は残す（本文を食わない）", () => {
  // 記号が 1 つ残るより、文を削るほうが悪い。
  const got = stripMarkdown("出発は 08:00 **です");
  assert.equal(got.text, "出発は 08:00 **です");
  assert.equal(got.removed, 0);
});

test("🔴 改行をまたいで飲み込まない", () => {
  const got = stripMarkdown("1 行目 **強調\n2 行目** 続き");
  assert.equal(got.text, "1 行目 **強調\n2 行目** 続き", "段落を丸ごと飲んでいる");
});

test("🔴 アンダースコアには触らない（許可済み URL が壊れる）", () => {
  const url = "https://www.mofa.go.jp/mofaj/toko/page22_000043.html";
  assert.equal(stripMarkdown(url).text, url);
});

test("装飾が無ければ何も変えない", () => {
  const plain = "9-23（水）は羽田 08:00 発です。搭乗口は当日ご確認ください。";
  const got = stripMarkdown(plain);
  assert.equal(got.text, plain);
  assert.equal(got.removed, 0);
});

test("🔴 route が実際に呼んでいる（定義してあるだけでは通さない）", () => {
  const src = code(ROUTE);
  assert.ok(
    /import\s*\{\s*stripMarkdown\s*\}\s*from\s*["']@\/lib\/strip-markdown["']/.test(src),
    "🔴 route が stripMarkdown を取り込んでいない",
  );
  assert.ok(
    src.includes("stripMarkdown(stripped.text)"),
    "🔴 URL を落としたあとの文に掛かっていない",
  );
});

test("🔴 URL を落としたあとに掛ける（順序）", () => {
  // `stripDisallowedUrls` はマークダウンリンクの表示文だけを残す。
  // 先に記法を壊すと、そちらが仕事をできない。
  const src = code(ROUTE);
  const iUrl = src.indexOf("stripDisallowedUrls(assistantRaw.content)");
  const iMd = src.indexOf("stripMarkdown(stripped.text)");
  assert.ok(iUrl >= 0 && iMd >= 0, "どちらかが見つからない（検査が空振りしている）");
  assert.ok(iUrl < iMd, "🔴 Markdown を先に落としている —— URL の検査が効かなくなる");
});

test("🔴 保存する文も落としたあとのものにする（履歴から復活させない）", () => {
  const src = code(ROUTE);
  assert.ok(
    /const assistant = \{ \.\.\.assistantRaw, content: plain\.text \}/.test(src),
    "🔴 assistant の中身が落とす前の文になっている",
  );
});

test("🔴 プロンプトが太字を許可し直していない", () => {
  const src = readFileSync(ROUTE, "utf8");
  assert.ok(
    !src.includes("太字のみ可"),
    "🔴 プロンプトが太字を許可している —— アプリは素のテキストで描くので記号が出る",
  );
});
