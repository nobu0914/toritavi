import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";

// 🔴 **端末カウンタは Claude を呼ぶ前に進める。**
//
// もとは成功してから進めていた。読みと書きの間に Claude の呼び出しが
// 丸ごと入るので、同じ端末の要求が重なると**どれも同じ値を読み、
// 同じ値を書いた**（lost update）。2026-08-31 に実際に踏んだ ——
// 90 秒に 4 要求を投げたあと入れ直したら枠が戻っていた（§22）。
//
// **戻すと落ちも警告も出ない。** 再インストールで枠が戻るだけで、
// テストは緑のまま（`CLAUDE.md` §6-1 の型）。

/** コメントを落とす。説明文中の語を拾うと見張りが緩む（failure-patterns I-2）。 */
const code = (s: string) =>
  s.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");

const src = code(readFileSync("src/app/api/ocr/route.ts", "utf8"));
const at = (needle: string) => {
  const i = src.indexOf(needle);
  assert.ok(i > 0, `見つからない: ${needle}`);
  return i;
};

test("🔴 書き戻しが Claude 呼び出しより前にある", () => {
  assert.ok(
    at("setGuestUsed(") < at("client.messages.create("),
    "🔴 書き戻しが Claude の後ろ。重なった要求が同じ値を読み、枠が戻る",
  );
});

test("🔴 読み → 書き の順は保つ（読む前に書かない）", () => {
  assert.ok(at("queryGuestUsed(") < at("setGuestUsed("));
});

test("🔴 予約の後に置く（門前払いで枠を減らさない）", () => {
  // `input_too_large` や予算 503 で弾かれた人の枠を減らさない。
  assert.ok(
    at("beginOcrRequest(") < at("setGuestUsed("),
    "🔴 予約より前。使えなかった人の枠が減る",
  );
});

test("🔴 失敗しても戻さない（フェイルクローズ）", () => {
  // 戻すと、並んだ別の要求の加算まで消せる。
  const after = src.slice(at("setGuestUsed("));
  assert.ok(
    !/setGuestUsed\(/.test(after.slice(20)),
    "🔴 setGuestUsed が 2 か所ある。巻き戻しは別の要求の加算を消す",
  );
});

test("🔴 書き戻しの結果を黙らせない", () => {
  assert.ok(src.includes('"[OCR] guest device write:"'));
});
