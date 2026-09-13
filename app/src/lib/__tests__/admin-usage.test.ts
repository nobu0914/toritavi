/**
 * 利用解析の集計。
 *
 * ここが守るのは 3 つ:
 *   ① **読めなかったを 0 にしない**（0 だと「誰も使っていない」と嘘をつく。
 *      表がまだ無いあいだ、ずっとその嘘を出し続けることになる）
 *   ② **人数は集合で数える**（1 人が 10 回見ても 1 人）
 *   ③ **未ログインを人数に混ぜない**（user_id が null は「誰か分からない
 *      1 件」で、数えると同じ人の複数回が別人になる）
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  usageFrom,
  usageUnavailable,
  MILESTONES,
  type EventRow,
} from "../admin-usage";

const row = (o: Partial<EventRow> & { name: string }): EventRow => ({
  created_at: "2026-09-13T10:00:00Z",
  user_id: "u1",
  session_id: "s1",
  screen: null,
  props: null,
  ...o,
});

test("🔴 読めなかったときは null（0 ではない）", () => {
  const u = usageUnavailable('relation "toritavi_events" does not exist');
  assert.equal(u.rows, null);
  assert.equal(u.users, null);
  assert.equal(u.sessions, null);
  assert.ok(u.error);
});

test("陽性対照: 0 件は 0（null ではない）", () => {
  const u = usageFrom([]);
  assert.equal(u.rows, 0);
  assert.equal(u.users, 0);
  assert.equal(u.error, null);
});

test("🔴 人数は集合で数える（1 人が 10 回見ても 1 人）", () => {
  const rows = Array.from({ length: 10 }, () =>
    row({ name: "screen.view", screen: "scan" }),
  );
  const u = usageFrom(rows);
  assert.equal(u.users, 1);
  assert.equal(u.screens[0].views, 10);
  assert.equal(u.screens[0].users, 1, "🔴 件数を人数として出している");
});

test("🔴 未ログインは人数に混ぜない（session では数える）", () => {
  const u = usageFrom([
    row({ name: "screen.view", screen: "welcome", user_id: null, session_id: "a" }),
    row({ name: "screen.view", screen: "welcome", user_id: null, session_id: "b" }),
  ]);
  assert.equal(u.users, 0, "🔴 誰か分からない行を人数に数えている");
  assert.equal(u.sessions, 2);
  assert.equal(u.screens[0].views, 2, "閲覧数には入る");
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
  const byName = Object.fromEntries(u.milestones.map((m) => [m.name, m.users]));
  assert.equal(byName["scan.started"], 1);
  assert.equal(
    byName["purchase.completed"],
    0,
    "🔴 出ていない節目が一覧から消えると、どこで止まったか分からない",
  );
});

test("日次は日付順（新しい順に来た行でも並べ直す）", () => {
  const u = usageFrom([
    row({ name: "tap", created_at: "2026-09-13T01:00:00Z", user_id: "u1" }),
    row({ name: "tap", created_at: "2026-09-11T01:00:00Z", user_id: "u2" }),
    row({ name: "tap", created_at: "2026-09-11T05:00:00Z", user_id: "u2" }),
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
