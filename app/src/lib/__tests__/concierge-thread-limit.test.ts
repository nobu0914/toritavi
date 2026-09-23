// 🔴 **相談スレッドを際限なく作れないこと**（2026-09-23・利用者の指示）。
//
// `threadId` を付けずに `/api/concierge` を叩くと、**1 通ごとに
// `toritavi_concierge_threads` の行が増える。** 上限が無かった。
//
// ## 🔴 総数ではなく「1 日あたり」にした理由
//
// アプリにはスレッドの一覧も削除も無く、端末に保存した 1 本を使い回す。
// **総数で蓋をすると、入れ直しで溜まった利用者が、消す手段のないまま
// 永久に締め出される。** 日ごとなら翌日には戻る。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { API_MESSAGES } from "../api-messages.ts";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}
const ROUTE = "src/app/api/concierge/route.ts";

test("🔴 スレッド作成に上限がある", () => {
  const src = code(ROUTE);
  assert.match(src, /const MAX_NEW_THREADS_PER_DAY = \d+;/, "🔴 上限の定数が無い");
  assert.ok(
    src.includes("MAX_NEW_THREADS_PER_DAY") &&
      /count \?\? 0\) >= MAX_NEW_THREADS_PER_DAY/.test(src),
    "🔴 定数はあるのに判定へ使っていない",
  );
});

test("🔴 数えるのは新規作成のときだけ（毎回数えない）", () => {
  const src = code(ROUTE);
  const i = src.indexOf("if (!threadId) {");
  const j = src.indexOf("MAX_NEW_THREADS_PER_DAY", i);
  assert.ok(i >= 0 && j > i, "🔴 threadId がある通常の送信でも数えている");
});

test("🔴 弾くときは予約を戻す（枠だけ減らさない）", () => {
  const src = code(ROUTE);
  const i = src.indexOf('error: "thread_limit"');
  assert.ok(i >= 0, "🔴 thread_limit を返していない");
  const before = src.slice(Math.max(0, i - 300), i);
  assert.match(before, /releaseConcierge\(userId\)/, "🔴 予約を戻していない");
});

test("🔴 スレッド作成に失敗したときも予約を戻す", () => {
  const src = code(ROUTE);
  const i = src.indexOf('error: "failed to create thread"');
  assert.ok(i >= 0);
  const before = src.slice(Math.max(0, i - 300), i);
  assert.match(before, /releaseConcierge\(userId\)/, "🔴 AI を呼ばずに枠だけ減る");
});

test("文言は日英そろっている", () => {
  const m = (API_MESSAGES as Record<string, { ja: string; en: string }>).thread_limit;
  assert.ok(m, "thread_limit の文言が無い");
  assert.ok(m.ja.length > 0 && m.en.length > 0, "片方の言語が空");
});
