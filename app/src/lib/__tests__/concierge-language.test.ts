// AI相談の回答言語（2026-10-04・訪日客向けの改修 1）。
//
// 🔴 英語で使う人にも日本語で答えていた（`lang` はエラー文にしか使っていなかった）。
// 🔴 日本語の利用者のプロンプトは 1 文字も変えない。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLanguageBlock } from "../concierge-language.ts";

describe("AI相談の回答言語", () => {
  test("日本語の利用者には何も足さない", () => {
    assert.equal(buildLanguageBlock("ja"), "");
  });

  test("英語の利用者には、英語で答える指示と読みの添え方を足す", () => {
    const b = buildLanguageBlock("en");
    assert.match(b, /Write every reply in English/);
    assert.match(b, /新大阪 \(Shin-Osaka\)/);
    assert.match(b, /Do not assume Japanese nationality/);
  });

  test("🔴 ルートが実際にシステムプロンプトへ足している", () => {
    const src = readFileSync(
      new URL("../../app/api/concierge/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(src, /SYSTEM_PROMPT_HEAD \+[\s\S]{0,120}buildLanguageBlock\(lang\) \+/);
  });
});
