// OCR のプロンプトに、日本を前提にした規則が入っていないこと（JR000221）。
//
// ## なぜ要るか
//
// 2026-09-07 まで、時刻ルールに
// 「**国内の場合は timezone は省略する（JST が前提）**」が入っていた。
// 日本だけに配信していたときは、**省略＝日本時間**で正しかった。
//
// 🔴 **省略されたゾーンは、端末のゾーンとして解釈される**
//    （アプリの `reminder_builder.dart` の `_toUtc` が `local.toUtc()` に落ちる）。
//    日本は単一タイムゾーンで利用者もたいてい国内に居るので当たっていたが、
//    **米国は 6 つ、カナダも豪州も複数ある。**
//
//    ニューヨークに居る人がロサンゼルス発の便を登録すると、
//    **出発時刻が 3 時間ずれたまま通知が飛ぶ。落ちも警告も出ない。**
//
// 🔴 **プロンプトは「出荷物」。** テストが無いと、次に誰かが
//    「国内なら省略」を戻しても誰も気づかない。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildOcrRulesPrompt, TIME_RULES } from "../ocr-rules.ts";

/** プロンプトに入ってはいけない言い回し。**例としての JST は可。** */
const FORBIDDEN: Array<[string, string]> = [
  ["国内", "「国内／国際」という区別は、どの国から見るかで変わる"],
  ["JSTが前提", "省略を日本時間と読み替える前提"],
  ["JST が前提", "同上"],
  ["日本時間", "併記の相手が日本に固定されている"],
  ["国際線", "「国内でない」＝日本の外、という前提が残る"],
];

describe("OCR プロンプトが国に依存しない", () => {
  const prompt = buildOcrRulesPrompt();

  test("🔴 走査が空振りしていない", () => {
    // 空文字を検査して「禁止語なし」で緑になる形を塞ぐ。
    assert.ok(prompt.length > 300, `プロンプトが短すぎる: ${prompt.length}`);
    assert.ok(prompt.includes("時刻ルール"), "時刻ルールの節が無い（構造が変わった？）");
  });

  for (const [word, why] of FORBIDDEN) {
    test(`🔴 「${word}」を含まない —— ${why}`, () => {
      assert.ok(
        !prompt.includes(word),
        `🔴 プロンプトに「${word}」がある。\n` +
          "  日本を基準にした規則は、英語圏の利用者で静かに間違う。\n" +
          `  該当箇所: ${prompt.split("\n").filter((l) => l.includes(word)).join(" / ")}`
      );
    });
  }

  test("🔴 ゾーンを特定できないときだけ省略する、と指示している", () => {
    // 「省略してよい」ではなく「特定できないときだけ」であること。
    assert.ok(
      TIME_RULES.timezone.unknown.includes("特定できない"),
      "省略の条件が『特定できないとき』になっていない"
    );
    assert.ok(
      TIME_RULES.timezone.unknown.includes("推測で埋めない"),
      "🔴 推測で埋めるなという指示が消えている（フェイルクローズ）"
    );
    assert.ok(prompt.includes("推測で埋めない"), "その指示がプロンプトに届いていない");
  });

  test("IANA ID を優先させている（略称だけにしない）", () => {
    // 略称は曖昧（CST は米国と中国で違う）。IANA を先に求める。
    assert.ok(prompt.includes("IANA"), "IANA ID の指示が無い");
    for (const z of ["America/Los_Angeles", "Europe/London", "Australia/Sydney"]) {
      assert.ok(prompt.includes(z), `例に ${z} が無い（日本以外の例が要る）`);
    }
  });
});
