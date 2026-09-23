// ============================================================================
// 🔴 **コンシェルジュが「いまが何日か」を知っていること**（2026-09-23）。
//
// 再開直後の実機確認で「今日の予定は？」と聞いたら、こう返った:
//
//   > 申し訳ありませんが、**本日の日付が不明** なため、今日の予定をお答えできません。
//
// **システムプロンプトにも旅程の文脈にも、現在日時が入っていなかった。**
// プロンプト本文は「当日動線の助言」を仕事だと書き、日付の体裁まで指定して
// いたのに、**当日そのものを渡していなかった。**
//
// 🔴 **これは落ちない形の欠陥**（`CLAUDE.md` §6-1）。例外も警告も出ず、
//    返答が丁寧なので「そういう仕様」に見える。**検査で固定する。**
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildNowBlock } from "../concierge-now.ts";

/** 行コメントを落とす。**注記に名前があるだけで通さない。** */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

const ROUTE = "src/app/api/concierge/route.ts";

test("日付・曜日・時刻・ゾーン名がすべて入る", () => {
  // 2026-09-23 10:11 JST = 2026-09-23T01:11Z（水曜）
  const block = buildNowBlock(new Date("2026-09-23T01:11:00Z"));
  assert.match(block, /2026-09-23（水）10:11 JST/);
});

test("🔴 ゾーン名を必ず添える（裸の「今日」を出さない）", () => {
  // `ocr-prompt-locale-neutral.test.ts` と同じ理屈 ——
  // **省略されたゾーンは、読む側の既定として解釈される。**
  const block = buildNowBlock(new Date("2026-09-23T01:11:00Z"));
  assert.ok(block.includes("JST"), "ゾーン名が無いと、どこの「今日」か決まらない");
});

test("🔴 timeZone が実際に効いている（日付境界で 1 日ずれる）", () => {
  // 同じ瞬間。JST では 9/23（水）の朝、ニューヨークではまだ 9/22（火）の夜。
  const at = new Date("2026-09-23T01:11:00Z");
  const jst = buildNowBlock(at, "Asia/Tokyo", "JST");
  const nyc = buildNowBlock(at, "America/New_York", "EDT");

  assert.match(jst, /2026-09-23/);
  assert.match(nyc, /2026-09-22/);
  assert.notEqual(
    jst,
    nyc,
    "🔴 timeZone を無視していると、海外配信を開けた瞬間に「今日」が 1 日ずれる",
  );
});

test("深夜は 24:xx ではなく 00:xx", () => {
  // 🔴 `hour12: false` は ICU の版によって `24` を出す。`h23` を使っている。
  const block = buildNowBlock(new Date("2026-09-22T15:30:00Z")); // = 09-23 00:30 JST
  assert.match(block, /2026-09-23（水）00:30 JST/);
});

test("🔴 route が実際に差し込んでいる（定義してあるだけでは通さない）", () => {
  const src = code(ROUTE);
  assert.ok(
    /import\s*\{\s*buildNowBlock\s*\}\s*from\s*["']@\/lib\/concierge-now["']/.test(src),
    "🔴 route が buildNowBlock を取り込んでいない",
  );
  assert.ok(
    src.includes("buildNowBlock()"),
    "🔴 取り込んでいるだけで呼んでいない —— プロンプトに日付は入らない",
  );
});

test("🔴 いまの日時は「旅程データの扱い」より上に置く", () => {
  // この節から下は **利用者が入力した値** として読ませている。
  // 日付は**システムが与える事実**なので、下に置くと
  // 「利用者が書いた日付」として扱われ、指示として読まれなくなる。
  const src = code(ROUTE);
  const system = src.slice(src.indexOf("system:"), src.indexOf("tools: [ADD_STEP_TOOL]"));
  assert.ok(system.length > 0, "system の組み立てが見つからない（検査が空振りしている）");

  const iHead = system.indexOf("SYSTEM_PROMPT_HEAD");
  const iNow = system.indexOf("buildNowBlock()");
  const iNotice = system.indexOf("SYSTEM_PROMPT_DATA_NOTICE");
  const iCtx = system.indexOf("context.promptBlock");

  assert.ok(iHead >= 0 && iNow >= 0 && iNotice >= 0 && iCtx >= 0, "4 つとも system に無い");
  assert.ok(iHead < iNow, "🔴 いまの日時が本文より前にある");
  assert.ok(
    iNow < iNotice,
    "🔴 いまの日時が「旅程データの扱い」より下にある —— 利用者の入力として読まれる",
  );
  assert.ok(iNotice < iCtx, "🔴 注意書きより先に旅程データが来ている");
});
