// コンシェルジュに曜日を計算させない（2026-09-28）。
//
// 旅程の日付だけを渡していたところ、17 問の回答のうち 6 か所で曜日を誤った
// （2026-04-18（土）を「金」「日」、2026-11-14（土）を「木」など）。
// サーバで計算して日付の横に渡す。**日付の値そのものは変えない** ——
// 「2026-04-18(土)」の形にすると、予定を足すツールへその形のまま渡されうる。
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildConciergeContext } from "../concierge-context.ts";
import { weekdayJa } from "../concierge-now.ts";
import type { Journey, Step } from "../types.ts";

test("曜日の計算（実験で AI が誤った日付）", () => {
  assert.equal(weekdayJa("2026-04-18"), "土");
  assert.equal(weekdayJa("2026-11-14"), "土");
  assert.equal(weekdayJa("2026-11-16"), "月");
  assert.equal(weekdayJa("2028-02-29"), "火"); // うるう日
  assert.equal(weekdayJa(null), null);
  assert.equal(weekdayJa("2026/04/18"), null, "形式が違えば書かない（推測しない）");
});

test("🔴 旅程と予定の日付の横に曜日が載る。日付の値はそのまま", () => {
  const j = {
    id: "j1",
    title: "札幌",
    startDate: "2026-11-14",
    endDate: "2026-11-16",
    steps: [
      { id: "s1", category: "宿泊", title: "ホテル", date: "2026-11-14", endDate: "2026-11-16", time: "15:00", status: "未開始" } as Step,
    ],
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  } as Journey;
  const { promptBlock } = buildConciergeContext({ allJourneys: [j], now: new Date("2026-09-28T00:00:00Z") });
  assert.match(promptBlock, /"startWeekday": "土"/);
  assert.match(promptBlock, /"endWeekday": "月"/);
  assert.match(promptBlock, /"dateWeekday": "土"/);
  assert.match(promptBlock, /"endDateWeekday": "月"/);
  assert.match(promptBlock, /"date": "2026-11-14"/, "日付の値は変えない");
  assert.match(promptBlock, /自分で計算しない/, "曜日の欄を使えという指示が無い");
});

test("🔴 畳んだ旅程にも曜日が載る", () => {
  const old = {
    id: "old",
    title: "春",
    startDate: "2026-04-18",
    endDate: "2026-04-18",
    steps: [{ id: "s", category: "観光", title: "花見", date: "2026-04-18", time: "10:00", status: "完了" } as Step],
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
  } as Journey;
  const soon = { ...old, id: "soon", startDate: "2026-10-01", endDate: "2026-10-01", updatedAt: "2026-09-01T00:00:00Z" } as Journey;
  const { promptBlock } = buildConciergeContext({ allJourneys: [old, soon], now: new Date("2026-09-28T00:00:00Z") });
  const summary = promptBlock.slice(promptBlock.indexOf("### 概要のみ"));
  assert.match(summary, /"startWeekday": "土"/);
});
