// コンシェルジュに渡す番号を記号にして送り、答えで本物に戻す（2026-09-28）。
//
// 🔴 **「送らない」と「戻る」を両方固定する。** 片方だけだと、
//    記号のまま画面に出る（戻し忘れ）か、本物がそのまま AI へ渡る（隠し忘れ）の
//    どちらかが、落ちも警告も出ずに通る。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildConciergeContext } from "../concierge-context.ts";
import { PiiVault, UNKNOWN_TOKEN_TEXT } from "../pii-vault.ts";
import type { Journey, Step } from "../types.ts";

const CONF = "3350342163";
const TEL = "03-1234-5678";
const MEMBER = "1234567724";
const EMAIL = "taro@example.com";

function journey(steps: Partial<Step>[], extra: Partial<Journey> = {}): Journey {
  return {
    id: "j1",
    title: "札幌",
    startDate: "2026-11-14",
    endDate: "2026-11-16",
    steps: steps.map(
      (s, i) => ({ id: `s${i}`, category: "宿泊", title: "ホテル", time: "15:00", status: "未開始", information: [], ...s }) as Step,
    ),
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...extra,
  } as Journey;
}

const NOW = new Date("2026-09-28T00:00:00Z");

function build(j: Journey) {
  return buildConciergeContext({ allJourneys: [j], now: NOW });
}

test("🔴 確認番号・電話・会員番号の本物は、プロンプトに 1 文字も載らない", () => {
  const ctx = build(
    journey([
      {
        confNumber: CONF,
        detail: `予約番号 ${CONF} / 電話 ${TEL}`,
        memo: `会員 ${MEMBER}`,
        information: [
          { id: "i1", label: "電話番号", value: TEL },
          { id: "i2", label: "会員番号", value: MEMBER },
          { id: "i3", label: "予約番号", value: CONF },
        ],
      },
    ]),
  );
  for (const v of [CONF, TEL, MEMBER]) {
    assert.ok(!ctx.promptBlock.includes(v), `本物が載っている: ${v}`);
  }
  assert.match(ctx.promptBlock, /"confNumber": "\[CONF_1\]"/);
  assert.match(ctx.promptBlock, /\[TEL_1\]/);
  assert.match(ctx.promptBlock, /\[MEMBER_1\]/);
  // 自由文の中に書かれた同じ番号も、同じ記号になる
  assert.match(ctx.promptBlock, /予約番号 \[CONF_1\] \/ 電話 \[TEL_1\]/);
});

test("🔴 答えの中の記号は本物に戻る（利用者には全桁で答えられる）", () => {
  const ctx = build(journey([{ confNumber: CONF, information: [{ id: "i4", label: "電話", value: TEL }] }]));
  const r = ctx.vault.reveal("確認番号は [CONF_1] です。ホテルの電話は [TEL_1] です。");
  assert.equal(r.text, `確認番号は ${CONF} です。ホテルの電話は ${TEL} です。`);
  assert.equal(r.unknown, 0);
  // 括弧を外して書かれても戻る
  assert.equal(ctx.vault.reveal("番号: CONF_1").text, `番号: ${CONF}`);
});

test("🔴 AI が作った存在しない記号は、番号らしいもので埋めない", () => {
  const ctx = build(journey([{ confNumber: CONF }]));
  const r = ctx.vault.reveal("番号は [CONF_7] です");
  assert.equal(r.text, `番号は ${UNKNOWN_TOKEN_TEXT} です`);
  assert.equal(r.unknown, 1);
});

test("🔴 ① 答えに要らない機微（メール・カード・旅券）は従来どおり送らない", () => {
  const ctx = build(
    journey([
      {
        detail: `連絡先 ${EMAIL} カード 4111 1111 1111 1111 旅券 TK1234567`,
        information: [{ id: "i5", label: "メール", value: EMAIL }],
      },
    ]),
  );
  assert.ok(!ctx.promptBlock.includes(EMAIL));
  assert.ok(!ctx.promptBlock.includes("4111 1111 1111 1111"));
  assert.ok(!ctx.promptBlock.includes("TK1234567"));
});

test("「予約サービス」は番号ではない（スマートEX の名前を残す）", () => {
  const ctx = build(journey([{ information: [{ id: "i6", label: "予約サービス", value: "スマートEX" }] }]));
  assert.match(ctx.promptBlock, /スマートEX/);
});

test("🔴 履歴を送るときは隠し直す（前の答えに戻した番号が AI へ渡らない）", () => {
  const ctx = build(journey([{ confNumber: CONF }]));
  // 保存しているのは本物（画面に出した文）
  const saved = `確認番号は ${CONF} です`;
  assert.equal(ctx.vault.hide(saved), "確認番号は [CONF_1] です");
  // 利用者が自分で打った番号も隠れる
  assert.equal(ctx.vault.hide(`${CONF} の宿はどこ？`), "[CONF_1] の宿はどこ？");
});

test("別の番号の一部は記号にしない", () => {
  const v = new PiiVault();
  v.token("CONF", "12345");
  assert.equal(v.hide("A123456 と 12345"), "A123456 と [CONF_1]");
  // 短い値は文中で探さない（時刻や金額を壊さない）。欄そのものは記号になる
  const w = new PiiVault();
  assert.equal(w.token("CONF", "15"), "[CONF_1]");
  assert.equal(w.hide("15:00 に 1500 円"), "15:00 に 1500 円");
});

test("同じ値は同じ記号・旅程をまたいでも隠れる", () => {
  const a = journey([{ confNumber: CONF }]);
  const b = journey([{ memo: `前回の番号 ${CONF}` }], { id: "j2", title: "福岡" });
  const ctx = buildConciergeContext({ allJourneys: [a, b], now: NOW });
  assert.ok(!ctx.promptBlock.includes(CONF));
  assert.ok(!ctx.promptBlock.includes("[CONF_2]"), "同じ値に 2 つ目の記号を振った");
});

test("予定を足す提案（ツールの入力）の中の記号も戻る", () => {
  const ctx = build(journey([{ confNumber: CONF }]));
  const input = { title: "チェックイン", reason: "予約 [CONF_1] の宿", nested: ["[CONF_1]"] };
  assert.deepEqual(ctx.vault.revealDeep(input), {
    title: "チェックイン",
    reason: `予約 ${CONF} の宿`,
    nested: [CONF],
  });
});

test("プロンプトは「記号をそのまま書け」と言い、「末尾のみ」とは言わない", () => {
  const ctx = build(journey([{ confNumber: CONF }]));
  assert.match(ctx.promptBlock, /記号を\*\*そのまま\*\*書いて/);
  assert.doesNotMatch(ctx.promptBlock, /末尾のみ可視/);
});

// route.ts は Next.js の決まりで POST 以外を export できないので、配線は文で見る。
test("🔴 route: 答えを戻し、履歴を隠し直している", () => {
  const src = readFileSync(new URL("../../app/api/concierge/route.ts", import.meta.url), "utf8");
  assert.match(src, /context\.vault\.reveal\(plain\.text\)/, "答えを戻していない —— 画面に [CONF_1] が出る");
  assert.match(src, /content: revealed\.text,/, "戻した文を返していない");
  assert.match(src, /buildAnthropicMessages\(history \?\? \[\], \(t\) => context\.vault\.hide\(t\)\)/, "履歴を隠し直していない —— 前の答えの番号が AI へ渡る");
  assert.match(src, /content: hide\(m\.content\)/, "利用者の発言を隠していない");
  assert.match(src, /text: hide\(m\.content\)/, "過去の答えを隠していない");
  assert.doesNotMatch(src, /マスクされた状態で届きます/, "古い「末尾だけ」の指示が残っている");
});
