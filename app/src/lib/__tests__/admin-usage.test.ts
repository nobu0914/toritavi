/**
 * 利用解析の集計。
 *
 * ここが守るのは 3 つ:
 *   ① **読めなかったを 0 にしない**（0 だと「誰も使っていない」と嘘をつく。
 *      表がまだ無いあいだ、ずっとその嘘を出し続けることになる）
 *   ② **集合で数える**（1 回の起動で 10 回見ても、その画面の起動は 1）
 *   ③ 🔴 **数えているのは「起動」であって「人」ではない**
 *      （2026-09-13 に `user_id` を取らないと決めた。同じ人の 3 回は 3）
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  usageFrom,
  usageUnavailable,
  MILESTONES,
  MILESTONE_LABEL,
  type EventRow,
} from "../admin-usage";
import { EVENT_NAMES } from "../events";

const row = (o: Partial<EventRow> & { name: string }): EventRow => ({
  created_at: "2026-09-13T10:00:00Z",
  session_id: "s1",
  screen: null,
  props: null,
  ...o,
});

test("🔴 読めなかったときは null（0 ではない）", () => {
  const u = usageUnavailable('relation "toritavi_events" does not exist');
  assert.equal(u.rows, null);
  assert.equal(u.sessions, null);
  assert.ok(u.error);
});

test("陽性対照: 0 件は 0（null ではない）", () => {
  const u = usageFrom([]);
  assert.equal(u.rows, 0);
  assert.equal(u.sessions, 0);
  assert.equal(u.error, null);
});

test("🔴 起動は集合で数える（1 回の起動で 10 回見ても 1）", () => {
  const rows = Array.from({ length: 10 }, () =>
    row({ name: "screen.view", screen: "scan" }),
  );
  const u = usageFrom(rows);
  assert.equal(u.sessions, 1);
  assert.equal(u.screens[0].views, 10);
  assert.equal(u.screens[0].sessions, 1, "🔴 件数を起動数として出している");
});

/**
 * 🔴 **誰かを持っていないので、同じ人の 2 回は 2 と出る。**
 * これは欠陥ではなく、2026-09-13 の決定の帰結。**画面が「人数」と
 * 書いていないこと**が、この数字が嘘にならない唯一の条件。
 */
test("🔴 別の起動は別に数える（人数ではない）", () => {
  const u = usageFrom([
    row({ name: "screen.view", screen: "welcome", session_id: "a" }),
    row({ name: "screen.view", screen: "welcome", session_id: "b" }),
  ]);
  assert.equal(u.sessions, 2);
  assert.equal(u.screens[0].views, 2);
  assert.equal(u.screens[0].sessions, 2);
});

test("滞在は中央値（外れ値に引っぱられない）", () => {
  const u = usageFrom([
    row({ name: "screen.view", screen: "scan", props: { ms: 100 } }),
    row({ name: "screen.view", screen: "scan", props: { ms: 200 } }),
    row({ name: "screen.view", screen: "scan", props: { ms: 999999 } }),
  ]);
  assert.equal(u.screens[0].medianMs, 200);
});

test("滞在が 1 件も無ければ null（0 ではない）", () => {
  const u = usageFrom([row({ name: "screen.view", screen: "scan" })]);
  assert.equal(u.screens[0].medianMs, null, "🔴 0 ミリ秒だったことになる");
});

test("画面は閲覧数の多い順", () => {
  const u = usageFrom([
    row({ name: "screen.view", screen: "a" }),
    row({ name: "screen.view", screen: "b" }),
    row({ name: "screen.view", screen: "b" }),
  ]);
  assert.deepEqual(u.screens.map((s) => s.screen), ["b", "a"]);
});

test("タップは画面ごとに分けて数える", () => {
  const u = usageFrom([
    row({ name: "tap", screen: "scan", props: { target: "go" } }),
    row({ name: "tap", screen: "scan", props: { target: "go" } }),
    row({ name: "tap", screen: "account", props: { target: "go" } }),
  ]);
  assert.equal(u.taps.length, 2, "🔴 別の画面の同じ名前をまとめている");
  assert.equal(u.taps[0].taps, 2);
  assert.equal(u.taps[0].screen, "scan");
});

test("🔴 節目は、出ていなくても 0 で並ぶ（欄が消えない）", () => {
  const u = usageFrom([row({ name: "scan.started" })]);
  assert.equal(u.milestones.length, MILESTONES.length);
  const byName = Object.fromEntries(
    u.milestones.map((m) => [m.name, m.sessions]),
  );
  assert.equal(byName["scan.started"], 1);
  assert.equal(
    byName["purchase.completed"],
    0,
    "🔴 出ていない節目が一覧から消えると、どこで止まったか分からない",
  );
});

test("🔴 節目はアプリが送る名前でなければならない（綴り違いは黙って 0 になる）", () => {
  const known = new Set<string>(EVENT_NAMES);
  for (const name of MILESTONES) {
    assert.ok(
      known.has(name),
      `🔴 ${name} は EVENT_NAMES に無い。/api/events が受け取らないので永久に 0 で並ぶ`,
    );
  }
});

test("🔴 節目には必ず日本語のラベルがある（無いとイベント名が画面に出る）", () => {
  for (const name of MILESTONES) {
    const label = MILESTONE_LABEL[name];
    assert.ok(label, `🔴 ${name} のラベルが無い。開発者の語がそのまま画面に出る`);
    assert.ok(
      !/[.a-z_]{4,}/.test(label),
      `🔴 ${name} のラベルがイベント名のまま（${label}）`,
    );
  }
});

test("🔴 2026-09-23 に足した 4 つが集計に出る（送っているのに出ない形を防ぐ）", () => {
  const added = [
    "calendar.opened",
    "concierge.asked",
    "concierge.journey_picked",
    "concierge.limits_opened",
  ];
  const u = usageFrom(added.map((name) => row({ name })));
  const byName = Object.fromEntries(u.milestones.map((m) => [m.name, m.sessions]));
  for (const name of added) {
    assert.equal(byName[name], 1, `🔴 ${name} が MILESTONES に無く、黙って捨てられている`);
  }
});

test("日次は日付順（新しい順に来た行でも並べ直す）", () => {
  const u = usageFrom([
    row({ name: "tap", created_at: "2026-09-13T01:00:00Z", session_id: "a" }),
    row({ name: "tap", created_at: "2026-09-11T01:00:00Z", session_id: "b" }),
    row({ name: "tap", created_at: "2026-09-11T05:00:00Z", session_id: "b" }),
  ]);
  assert.deepEqual(u.dailyActive, [
    { day: "2026-09-11", value: 1 },
    { day: "2026-09-13", value: 1 },
  ]);
});

test("🔴 打ち切ったことを持ち回る", () => {
  assert.equal(usageFrom([], true).capped, true);
  assert.equal(usageFrom([]).capped, false);
});
