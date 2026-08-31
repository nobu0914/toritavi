import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { OCR_GUARD, msgsFor } from "../ai-guard";

// 🔴 **Pro に「今月」「翌月 1 日」と言わない。**
//
// 契約応当日が入るとリセットは月初ではない（`ocr_period_start`）。
// `nextResetIso` は user_id を取らないので**常に翌月 1 日**を返しており、
// 画面が嘘の日付を出していた（外部レビュー 2026-08-31 の P1）。
//
// **いまは実害が無い**（現行 Pro 2 名の `period_anchor` が NULL で暦月に
// 倒れている）。**課金を開けた瞬間に真になる。**

const code = (s: string) =>
  s.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");

test("🔴 Pro 向けの文言に「今月」「翌月」が無い", () => {
  const m = msgsFor(OCR_GUARD, "pro");
  for (const s of [m.quotaRequest, m.quotaToken, m.quotaUnits(0), m.quotaUnits(2)]) {
    assert.ok(!s.includes("今月"), `🔴 「今月」と言っている: ${s}`);
    assert.ok(!s.includes("翌月"), `🔴 「翌月」と言っている: ${s}`);
  }
});

test("無料の文言は変えていない（暦月なので「今月」で正しい）", () => {
  assert.equal(msgsFor(OCR_GUARD, "free").quotaRequest, OCR_GUARD.messages.quotaRequest);
  assert.ok(msgsFor(OCR_GUARD, "free").quotaRequest.includes("今月"));
});

test("🔴 差し替えは quotaUnits の関数まで届く", () => {
  assert.notEqual(msgsFor(OCR_GUARD, "pro").quotaUnits(1), OCR_GUARD.messages.quotaUnits(1));
});

test("🔴 リセット日を DB に訊いている（サーバで計算しない）", () => {
  // 「期間開始 +1 か月」では月末起点がずれる ——
  // anchor=1/31・3/15 時点で正しくは 3/31 なのに 3/28（ローカルで実測）。
  const src = code(readFileSync("src/app/api/ai-usage/route.ts", "utf8"));
  assert.ok(src.includes('rpc("ocr_period_next"'),
    "🔴 DB に訊いていない。丸めを 2 か所で書くと必ず食い違う");
  assert.ok(!/resetAt: isAnonymous \? null : nextResetIso/.test(src),
    "🔴 常に翌月 1 日を返す旧実装が残っている");
});

test("🔴 読めなかったとき、Pro には日付を出さない", () => {
  // 分からないことを、それらしい日付に変換しない。
  const src = code(readFileSync("src/app/api/ai-usage/route.ts", "utf8"));
  assert.ok(src.includes('plan === "pro" ? null : nextResetIso'),
    "🔴 Pro にも暦月の日付を返している");
});
