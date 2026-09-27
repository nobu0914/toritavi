// 列車の予約サービス名を残す指示（2026-09-27）。
//
// ## なぜ要るか
//
// アプリの「交通系 IC カードを持っていく」は、予約票に「スマートEX」
// 「えきねっと」等があるときだけ出す。実データで流したところ、**読み取りが
// サービス名を捨て、保存された予定のどこにも残らず、案内が一度も出なかった。**
//
// 🔴 **公開中の版には効かせない。** アプリが `features: ["booking_service"]` を
//    送ったときだけ指示を足す。送らない版（1.3.1）の指示文は変えない ——
//    既存の利用者の読み取り結果が、サーバの配信だけで変わらないように。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSystemPrompt } from "../ocr-prompt.ts";

const TODAY = "2026-09-27";
const HEADING = "## 列車の予約サービス";

describe("列車の予約サービス", () => {
  test("🔴 合図が無ければ指示を足さない（既定と false は同じ文面）", () => {
    for (const lang of ["日本語", "English"]) {
      const def = buildSystemPrompt(lang, TODAY);
      assert.equal(def.includes(HEADING), false);
      assert.equal(buildSystemPrompt(lang, TODAY, { bookingService: false }), def);
    }
  });

  test("合図があれば、書いてあるものだけを写す指示が入る", () => {
    const p = buildSystemPrompt("日本語", TODAY, { bookingService: true });
    assert.ok(p.includes(HEADING));
    assert.ok(p.includes("スマートEX"));
    assert.ok(p.includes("えきねっと"));
    assert.ok(p.includes("推測しない"), "推測で付けると紙のきっぷの人に誤った乗り方を教える");
  });

  test("label は利用者の表示言語で書かせる", () => {
    const p = buildSystemPrompt("English", TODAY, { bookingService: true });
    const section = p.split(HEADING)[1].split("\n## ")[0];
    assert.ok(section.includes("**English**"));
  });

  test("🔴 ルートは合図を見て渡している（渡し忘れると新しい版でも出ない）", () => {
    const route = readFileSync(
      new URL("../../app/api/ocr/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(route, /bookingService:\s*features\.includes\("booking_service"\)/);
  });
});
