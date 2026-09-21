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
  assert.equal(
    msgsFor(OCR_GUARD, "free", "ja").quotaRequest,
    OCR_GUARD.messages.quotaRequest.ja,
  );
});

test("🔴 Pro は差し替わっている（無料と同じにしない）", () => {
  assert.notEqual(
    msgsFor(OCR_GUARD, "pro", "ja").quotaRequest,
    OCR_GUARD.messages.quotaRequest.ja,
  );
  // 🔴 **英語でも差し替わっていること。** 日本語だけ直して英語が
  //    会員向けのまま、という壊れ方をする（2026-09-21）。
  assert.notEqual(
    msgsFor(OCR_GUARD, "pro", "en").quotaRequest,
    OCR_GUARD.messages.quotaRequest.en,
  );
});

test("🔴 差し替えは quotaUnits の関数まで届く", () => {
  // spread が浅いと関数だけ会員向けのまま残る。
  for (const lang of ["ja", "en"] as const) {
    assert.notEqual(
      msgsFor(OCR_GUARD, "guest", lang).quotaUnits(1),
      OCR_GUARD.messages.quotaUnits[lang](1),
      `🔴 ${lang} でゲストの quotaUnits が差し替わっていない`,
    );
  }
});

test("guestMessages を持たない設定はそのまま", () => {
  assert.equal(
    msgsFor(CONCIERGE_GUARD, "guest", "ja").quotaRequest,
    CONCIERGE_GUARD.messages.quotaRequest.ja,
  );
});

test("🔴 文言はすべて msgsFor を通る（直読みが残っていない）", () => {
  // 1 か所でも直読みが残ると、その経路だけ会員向けの文言が出る。
  const src = readFileSync("src/lib/ai-guard.ts", "utf8");
  const bare = src.match(/(?:cfg|OCR_GUARD|CONCIERGE_GUARD)\.messages\.quota\w+/g) ?? [];
  assert.deepEqual(bare, [], `🔴 直読みが残っている: ${bare.join(", ")}`);
});
