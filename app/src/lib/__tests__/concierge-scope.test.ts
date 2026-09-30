// コンシェルジュの答える範囲（2026-09-30・利用者の決定）。
//
// 「アメリカの渡航に必要な書類は？」を「旅程についての相談ではない」と断っていた。
// 範囲を**旅程と、旅行・おでかけ全般**へ広げた（旅と関係ない話は今までどおり断る）。
//
// 🔴 固定すること:
//    - 登録していない旅先・旅行全般の質問は範囲に入る
//    - 旅と関係ない依頼（コード・長文・一般知識）は断る
//    - 入国・ビザは前提を先に書き、言い切らず、公式での確認を促す
//      （`toritavi_app` の docs/travel-info-safety.md §4 と同じ規則）
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const src = readFileSync(new URL("../../app/api/concierge/route.ts", import.meta.url), "utf8");

test("範囲は旅程と、旅行・おでかけ全般（登録していない旅先も）", () => {
  assert.match(src, /旅程と、旅行・おでかけに関する相談/);
  assert.match(src, /登録していない旅先の質問も含む/);
  assert.doesNotMatch(src, /旅程に関する相談だけ/, "旧い範囲（旅程だけ）が残っている");
});

test("🔴 旅と関係ない依頼は今までどおり断る", () => {
  assert.match(src, /プログラムの生成・修正・解説/);
  assert.match(src, /旅と無関係な一般知識の質問/);
  assert.match(src, /長さの指定に応える形での文章生成/);
  assert.match(src, /旅行やおでかけについてでしたらお答えできます/);
});

test("🔴 入国・ビザは前提を先に・言い切らない・公式で確認", () => {
  assert.match(src, /前提を先に書く/);
  assert.match(src, /言い切らない/);
  assert.match(src, /公式での確認を促す/);
});
