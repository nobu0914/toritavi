// 日本語以外で使う人への「読み」の添え書き（2026-10-04・訪日客向けの改修 2）。
//
// 🔴 日本語の予約票を英語の利用者が読ませると、駅名・宿名が漢字のまま届いていた。
// 🔴 日本語の利用者のプロンプトは 1 文字も変えない。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, OUTPUT_LANGS } from "../ocr-prompt.ts";

const TODAY = "2026-10-04";

describe("OCR の読みの添え書き", () => {
  test("英語の利用者には、原文を残して括弧で読みを添える指示が入る", () => {
    const en = buildSystemPrompt(OUTPUT_LANGS.en, TODAY);
    assert.ok(en.includes("新大阪 (Shin-Osaka)"));
    assert.ok(en.includes("原文は消さない・置き換えない"));
  });

  test("🔴 日本語の利用者には入らない（言語の節の形も変わらない）", () => {
    const ja = buildSystemPrompt(OUTPUT_LANGS.ja, TODAY);
    assert.ok(!ja.includes("Shin-Osaka"));
    assert.ok(!ja.includes("利用者の表示言語は"));
    assert.ok(
      ja.includes("突き合わせられなくなる。\n\n## 施設・運行会社のウェブサイト"),
      "日本語のプロンプトの「言語」の節の終わりが変わっている",
    );
  });
});
