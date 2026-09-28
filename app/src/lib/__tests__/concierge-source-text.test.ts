// 書類の原文をコンシェルジュに渡す（2026-09-28・B-2）。
//
// 🔴 固定すること:
//    - 原文が載る（載らなければ機能が無いのと同じ。落ちも警告も出ない形）
//    - 原文の中の番号も記号になり、メール・カード・旅券は落ちる
//    - 原文は旅程の予算を食わない（他の旅程を「概要のみ」に落とさない）
//    - 予算で省いたときは「無い」と言わせない
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildConciergeContext } from "../concierge-context.ts";
import type { Journey, Step } from "../types.ts";

const NOW = new Date("2026-09-28T00:00:00Z");

function journey(id: string, steps: Partial<Step>[], title = id): Journey {
  return {
    id,
    title,
    startDate: "2026-11-14",
    endDate: "2026-11-16",
    steps: steps.map(
      (s, i) => ({ id: `${id}-s${i}`, category: "車", title: "レンタカー", time: "10:00", status: "未開始", information: [], ...s }) as Step,
    ),
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  } as Journey;
}

const RENTAL = "補償: 車両・対物 免責 5 万円 / NOC 2 万円\n返却: 満タン返し。給油しない場合 1L あたり 250 円";

test("🔴 書類の原文が載り、読み方の指示が付く", () => {
  const ctx = buildConciergeContext({ allJourneys: [journey("j1", [{ sourceText: RENTAL }])], now: NOW });
  assert.match(ctx.promptBlock, /### 書類の原文（1 件）/);
  assert.match(ctx.promptBlock, /NOC 2 万円/);
  assert.match(ctx.promptBlock, /stepIds: j1-s0/);
  assert.match(ctx.promptBlock, /予定の欄の値を正/);
  assert.match(ctx.promptBlock, /書類には見当たりません/);
});

test("🔴 原文の中の番号は記号になり、メール・カード・旅券は落ちる", () => {
  const ctx = buildConciergeContext({
    allJourneys: [
      journey("j1", [
        {
          confNumber: "3350342163",
          sourceText: "予約番号 3350342163\n連絡先 taro@example.com\nカード 4111 1111 1111 1111\n旅券 TK1234567",
        },
      ]),
    ],
    now: NOW,
  });
  const p = ctx.promptBlock;
  assert.ok(!p.includes("3350342163"), "確認番号の本物が載っている");
  assert.match(p, /予約番号 \[CONF_1\]/);
  for (const v of ["taro@example.com", "4111 1111 1111 1111", "TK1234567"]) {
    assert.ok(!p.includes(v), `送らないはずの値が載っている: ${v}`);
  }
});

test("同じ原文（1 枚から予定が複数）は 1 回だけ載る", () => {
  const ctx = buildConciergeContext({
    allJourneys: [journey("j1", [{ sourceText: RENTAL }, { sourceText: RENTAL, title: "返却" }])],
    now: NOW,
  });
  assert.equal(ctx.promptBlock.split("NOC 2 万円").length - 1, 1);
  assert.match(ctx.promptBlock, /stepIds: j1-s0, j1-s1/);
});

test("🔴 原文は旅程の予算を食わない（長い原文があっても他の旅程は詳細のまま）", () => {
  const long = "あ".repeat(60_000);
  const js = [journey("j1", [{ sourceText: long }]), journey("j2", [{ title: "札幌のホテル" }])];
  const ctx = buildConciergeContext({ allJourneys: js, now: NOW });
  assert.match(ctx.promptBlock, /### 詳細（Step 付き・2 件）/);
  assert.doesNotMatch(ctx.promptBlock, /### 概要のみ/);
  // 1 書類 8,000 文字で切り、切ったことを書く
  assert.ok(!ctx.promptBlock.includes("あ".repeat(8_001)));
  assert.match(ctx.promptBlock, /ここで切っています/);
});

test("🔴 予算で省いた書類は件数を伝え、「無い」と言わせない", () => {
  const js = ["a", "b", "c", "d"].map((k) => journey(`j${k}`, [{ sourceText: `${k}`.repeat(8_000) }]));
  const ctx = buildConciergeContext({ allJourneys: js, now: NOW });
  assert.match(ctx.promptBlock, /### 書類の原文（3 件）/);
  assert.match(ctx.promptBlock, /ほかに 1 件の書類がありますが/);
});

test("原文が 1 つも無ければ節ごと出さない（従来と同じ）", () => {
  const ctx = buildConciergeContext({ allJourneys: [journey("j1", [{}])], now: NOW });
  assert.doesNotMatch(ctx.promptBlock, /### 書類の原文/);
});

test("終わった旅程（概要のみ）の原文は載せない", () => {
  const old = { ...journey("old", [{ sourceText: RENTAL }]), startDate: "2025-01-01", endDate: "2025-01-02" } as Journey;
  old.steps = old.steps.map((s) => ({ ...s, date: "2025-01-01" }));
  const ctx = buildConciergeContext({ allJourneys: [journey("j1", [{}]), old], now: NOW });
  assert.doesNotMatch(ctx.promptBlock, /NOC 2 万円/);
});

test("route: 行の source_text を読んでいる", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../app/api/concierge/route.ts", import.meta.url), "utf8");
  assert.match(src, /sourceText: row\.source_text \?\? undefined/);
});
