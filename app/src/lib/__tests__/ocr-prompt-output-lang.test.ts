// OCR の出力言語が、プロンプト全体で 1 つに揃っているか（JR000225）。
//
// ## なぜ要るか
//
// 🔴 2026-09-07 まで、「言語」の節は `variable の label は ${outputLang} で書く`
//    と言っていたのに、**施設ウェブサイトの節だけ label を「ウェブサイト」に
//    固定していた。** 英語の利用者には、英語のラベルの列に 1 行だけ日本語が
//    混ざる。落ちも警告も出ない。
//
// 🔴 **プロンプトは「出荷物」。** テストが無いと、次に誰かが日本語のラベルを
//    直書きしても誰も気づかない。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, OUTPUT_LANGS } from "../ocr-prompt.ts";

const TODAY = "2026-09-07";

/**
 * label に日本語の literal を書いてよいのは、**出力言語への言及とセットのとき**だけ。
 *
 * 「日本語を一切書くな」にはしない —— プロンプト本体は日本語で書かれており、
 * 「英語なら "Website"」のような**例**はモデルにとって手がかりになる。
 * 禁じたいのは**例が指示にすり替わる**形（＝出力言語と無関係に語を固定する）。
 */
const JP_LITERAL = /「[^」]*[ぁ-んァ-ヶ一-龥][^」]*」/;

describe("出力言語", () => {
  test("アプリが送りうる言語をすべて知っている", () => {
    // アプリ側は `effectiveLocale` で ja / en のどちらかに畳んでから送る
    // （`test/features/scan/ocr_output_language_test.dart` が対で見張る）。
    for (const code of ["ja", "en"]) {
      assert.ok(OUTPUT_LANGS[code], `${code} を知らない`);
    }
  });

  test("label を指示する行は、必ず出力言語に紐づく", () => {
    // 🔴 これが元の欠陥の形。施設ウェブサイトの節は
    //    `label は「ウェブサイト」` とだけ書いてあり、**出力言語をどこにも
    //    参照していなかった。** だから英語の利用者にも日本語で返っていた。
    for (const code of ["en", "ja"] as const) {
      const lang = OUTPUT_LANGS[code];
      const lines = buildSystemPrompt(lang, TODAY)
        .split("\n")
        .filter((l) => l.includes("label"));
      assert.ok(lines.length >= 2, "陽性対照: label の指示行を拾えていない");
      for (const line of lines) {
        if (!JP_LITERAL.test(line)) continue;
        assert.ok(
          line.includes(lang),
          `label に語を固定していて、出力言語（${lang}）を参照していない: ${line.trim()}`,
        );
      }
    }
  });

  test("出力言語がプロンプトに実際に入る", () => {
    const en = buildSystemPrompt(OUTPUT_LANGS.en, TODAY);
    const ja = buildSystemPrompt(OUTPUT_LANGS.ja, TODAY);
    assert.ok(en.includes("English"), "英語の指定が入っていない");
    assert.ok(ja.includes("日本語"), "日本語の指定が入っていない");
    assert.notEqual(en, ja, "陰性対照: 言語を変えてもプロンプトが同じ");
  });

  test("category の値は言語を変えても日本語のまま", () => {
    // 🔴 **これは表示用ではなく内部の値。** アプリが `category == '宿泊'` の
    //    ような文字列一致で扱うので、訳した瞬間に分類が全部外れる。
    const en = buildSystemPrompt(OUTPUT_LANGS.en, TODAY);
    assert.ok(
      en.includes("category の値は上に挙げた日本語の語をそのまま使う"),
      "🔴 category を訳させる指示になっている",
    );
  });
});
