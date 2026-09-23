// ============================================================================
// 🔴 **終わった旅行は要約に畳む。ただし「存在」は全件そのまま伝える**
//    （2026-09-23・利用者の判断）。
//
// ## なぜ畳むか
//
// 実測（30 旅程 50 予定の実アカウント）で、毎回送っている JSON の
// **75.6% が「終わった旅行」**だった。1 通の原価 ¥4.22 のうち
// **98% が入力**で、その大半がこれ。**過去は増え続け、これからの旅行は
// 増えない**ので、放置すると比率は悪化し続ける。
//
// ## 🔴 壊してはいけないもの
//
// 2026-08-12、「福岡出張について」と聞いて **「見当たりません」** と返す
// 事故が起きた（8 件中、上位 3 件から漏れていた）。そのとき利用者は
// **「全件を必ず見せる」**と決めた。**その判断は壊さない。**
// 変えるのは*どれを詳細にするか*だけで、**存在・題名・期間・予定数は
// 全件そのまま**載る。
// ============================================================================
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildConciergeContext } from "../concierge-context.ts";
import type { Journey, Step } from "../types.ts";

const NOW = new Date("2026-09-23T01:00:00Z"); // = 2026-09-23 10:00 JST

function step(over: Partial<Step> = {}): Step {
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    category: "移動",
    title: "羽田 → 福岡",
    time: "08:00",
    ...over,
  } as Step;
}

function journey(over: Partial<Journey> = {}): Journey {
  return {
    id: `j-${Math.random().toString(36).slice(2, 8)}`,
    title: "出張",
    startDate: "2026-09-25",
    endDate: "2026-09-27",
    steps: [step({ date: "2026-09-25" })],
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...over,
  } as Journey;
}

/** 詳細ブロックに載っているか（Step 付きで出ているか）。 */
function isDetailed(block: string, id: string): boolean {
  const detail = block.slice(block.indexOf("### 詳細"), block.indexOf("### 概要のみ") >= 0 ? block.indexOf("### 概要のみ") : undefined);
  return detail.includes(id);
}

test("これからの旅程は詳細に載る", () => {
  const j = journey({ startDate: "2026-10-01", endDate: "2026-10-05" });
  const { promptBlock } = buildConciergeContext({ allJourneys: [j], now: NOW });
  assert.ok(isDetailed(promptBlock, j.id));
});

test("進行中の旅程は詳細に載る", () => {
  const j = journey({ startDate: "2026-09-22", endDate: "2026-09-24" });
  const { promptBlock } = buildConciergeContext({ allJourneys: [j], now: NOW });
  assert.ok(isDetailed(promptBlock, j.id));
});

test("🔴 終わって久しい旅程は要約へ畳む", () => {
  const past = journey({
    startDate: "2026-05-01",
    endDate: "2026-05-05",
    steps: [step({ date: "2026-05-01" })],
  });
  const soon = journey({ startDate: "2026-10-01", endDate: "2026-10-05" });
  const { promptBlock } = buildConciergeContext({ allJourneys: [past, soon], now: NOW });
  assert.ok(!isDetailed(promptBlock, past.id), "終わった旅程が詳細に残っている");
  assert.ok(isDetailed(promptBlock, soon.id));
});

test("終了から 7 日以内は詳細に残す（帰った直後がいちばん触られる）", () => {
  const justBack = journey({
    startDate: "2026-09-15",
    endDate: "2026-09-18", // 5 日前
    steps: [step({ date: "2026-09-15" })],
  });
  const { promptBlock } = buildConciergeContext({ allJourneys: [justBack], now: NOW });
  assert.ok(isDetailed(promptBlock, justBack.id));
});

test("🔴 endDate が無くても Step の日付で終了と判定する", () => {
  // 片道登録や終了日未入力。`endDate` だけ見ると**永久に畳まれない。**
  const past = journey({
    startDate: "",
    endDate: "",
    steps: [step({ date: "2026-04-10" })],
  });
  const soon = journey({ startDate: "2026-10-01", endDate: "2026-10-05" });
  const { promptBlock } = buildConciergeContext({ allJourneys: [past, soon], now: NOW });
  assert.ok(!isDetailed(promptBlock, past.id), "Step の日付を見ていない");
});

test("🔴 日付が 1 つも無い旅程は畳まない（作りかけ）", () => {
  const draft = journey({
    startDate: "",
    endDate: "",
    steps: [step({ date: undefined })],
  });
  // 🔴 **相棒を必ず置く。** 1 件だけだと「最低 1 件は詳細」の保険に救われ、
  //    畳む実装でも緑になる（2026-09-23 に変異で実際に空振りした）。
  const soon = journey({ startDate: "2026-10-01", endDate: "2026-10-05" });
  const { promptBlock } = buildConciergeContext({ allJourneys: [draft, soon], now: NOW });
  assert.ok(isDetailed(promptBlock, draft.id));
});

test("🔴 選択した旅程は、終わっていても必ず詳細", () => {
  const past = journey({
    startDate: "2026-02-01",
    endDate: "2026-02-05",
    steps: [step({ date: "2026-02-01" })],
  });
  const otherPast = journey({
    title: "選んでいない過去",
    startDate: "2026-02-10",
    endDate: "2026-02-12",
    steps: [step({ date: "2026-02-10" })],
  });
  // 🔴 **相棒を必ず置く。** 1 件だけだと「最低 1 件は詳細」の保険に救われ、
  //    選択を無視する実装でも緑になる（2026-09-23 に変異で実際に空振りした）。
  const soon = journey({ startDate: "2026-10-01", endDate: "2026-10-05" });
  const { promptBlock } = buildConciergeContext({
    allJourneys: [past, otherPast, soon],
    contextJourneyIds: [past.id],
    now: NOW,
  });
  assert.ok(isDetailed(promptBlock, past.id), "選んだのに畳まれている＝選択の意味が無い");
  assert.ok(
    !isDetailed(promptBlock, otherPast.id),
    "選んでいない過去まで詳細になっている＝畳めていない",
  );
});

test("🔴 全部終わっていても、詳細は最低 1 件残る", () => {
  // ここが 0 件だと、何を聞いても「選んでください」しか返せない。
  const all = [
    journey({ startDate: "2026-01-01", endDate: "2026-01-05", steps: [step({ date: "2026-01-01" })] }),
    journey({ startDate: "2026-02-01", endDate: "2026-02-05", steps: [step({ date: "2026-02-01" })] }),
  ];
  const { promptBlock } = buildConciergeContext({ allJourneys: all, now: NOW });
  assert.match(promptBlock, /### 詳細（Step 付き・1 件）/);
});

test("🔴 畳んでも全件の存在は伝わる（2026-08-12 の事故の再発防止）", () => {
  const fukuoka = journey({
    title: "福岡出張",
    startDate: "2026-03-01",
    endDate: "2026-03-03",
    steps: [step({ date: "2026-03-01" })],
  });
  const others = Array.from({ length: 5 }, (_, i) =>
    journey({
      title: `過去 ${i}`,
      startDate: "2026-01-01",
      endDate: "2026-01-02",
      steps: [step({ date: "2026-01-01" })],
    }),
  );
  const { promptBlock } = buildConciergeContext({
    allJourneys: [...others, fukuoka],
    now: NOW,
  });
  assert.match(promptBlock, /全部で 6 件で、下に全件を挙げています/);
  assert.ok(promptBlock.includes("福岡出張"), "🔴 題名が消えている —— 「見当たりません」が再発する");
  assert.match(promptBlock, /存在しないという意味ではありません/);
});

test("🔴 実測に近い構成で、送信量が目に見えて減る", () => {
  // 終わった旅行 23 件 / これから 7 件（2026-09-23 の実測に近い比率）
  const finished = Array.from({ length: 23 }, () =>
    journey({
      startDate: "2026-01-10",
      endDate: "2026-01-12",
      steps: [step({ date: "2026-01-10" }), step({ date: "2026-01-11" })],
    }),
  );
  const upcoming = Array.from({ length: 7 }, () =>
    journey({
      startDate: "2026-10-10",
      endDate: "2026-10-12",
      steps: [step({ date: "2026-10-10" }), step({ date: "2026-10-11" })],
    }),
  );
  const all = [...finished, ...upcoming];

  const after = buildConciergeContext({ allJourneys: all, now: NOW }).promptBlock.length;
  // 比較用: すべて「これから」だったとき（＝畳まれない）
  const before = buildConciergeContext({
    allJourneys: all.map((j) => ({ ...j, startDate: "2026-10-10", endDate: "2026-10-12", steps: j.steps.map((s) => ({ ...s, date: "2026-10-10" })) })),
    now: NOW,
  }).promptBlock.length;

  assert.ok(
    after < before * 0.6,
    `🔴 畳んでも減っていない（${before} → ${after}）`,
  );
});
