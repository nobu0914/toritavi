import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { OCR_GUARD, CONCIERGE_GUARD, msgsFor } from "../ai-guard";

// 🔴 **ゲストに「今月」「翌月 1 日」と言わない。**
//    お試し枠にリセットは無い。アプリ側の文言を直しても、
//    **画面はサーバの `message` を優先する**ので、ここが本体
//    （`scan_screen.dart` の `_serverMessage`）。2026-08-31 に実測で判明。

test("🔴 ゲスト向けの文言に「今月」「翌月」が無い", () => {
  const m = msgsFor(OCR_GUARD, "guest");
  for (const s of [m.quotaRequest, m.quotaToken, m.quotaUnits(0), m.quotaUnits(2)]) {
    assert.ok(!s.includes("今月"), `🔴 「今月」と言っている: ${s}`);
    assert.ok(!s.includes("翌月"), `🔴 「翌月」と言っている: ${s}`);
    assert.ok(!s.includes("本日"), `🔴 「本日」と言っている: ${s}`);
  }
});

test("無料会員の文言は変えていない（暦月なので「今月」で正しい）", () => {
  // 🔴 **pro をここに含めない。** 2026-08-31 に Pro 用の文言を足した
  //    （契約応当日が入ると「翌月 1 日」が嘘になるため。`pro-reset-wording.test.ts`）。
  //    仕様が変わったのでこの期待値も変えた —— **テストの更新は変更の一部**
  //    （`CLAUDE.md` §5）。
  assert.equal(msgsFor(OCR_GUARD, "free").quotaRequest, OCR_GUARD.messages.quotaRequest);
});

test("🔴 Pro は差し替わっている（無料と同じにしない）", () => {
  assert.notEqual(msgsFor(OCR_GUARD, "pro").quotaRequest, OCR_GUARD.messages.quotaRequest);
});

test("🔴 差し替えは quotaUnits の関数まで届く", () => {
  // spread が浅いと関数だけ会員向けのまま残る。
  assert.notEqual(msgsFor(OCR_GUARD, "guest").quotaUnits(1), OCR_GUARD.messages.quotaUnits(1));
});

test("guestMessages を持たない設定はそのまま", () => {
  assert.equal(msgsFor(CONCIERGE_GUARD, "guest"), CONCIERGE_GUARD.messages);
});

test("🔴 文言はすべて msgsFor を通る（直読みが残っていない）", () => {
  // 1 か所でも直読みが残ると、その経路だけ会員向けの文言が出る。
  const src = readFileSync("src/lib/ai-guard.ts", "utf8");
  const bare = src.match(/(?:cfg|OCR_GUARD|CONCIERGE_GUARD)\.messages\.quota\w+/g) ?? [];
  assert.deepEqual(bare, [], `🔴 直読みが残っている: ${bare.join(", ")}`);
});
