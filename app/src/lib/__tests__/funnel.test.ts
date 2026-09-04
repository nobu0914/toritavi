/**
 * 登録ファネルの数え方。
 *
 * ここが守るのは 3 つ:
 *   ① **読めなかったを 0 にしない**（0 だと、離脱していないのに離脱に見える）
 *   ② **匿名を分母に混ぜない**（混ぜると転換率が実際より低く出る）
 *   ③ **人数を数える**（1 人が 10 件読んでも 1 人）
 *
 * ゲスト（未登録お試し）を出すかを決められなかった理由が、
 * **増分の Pro 転換率を測れないこと**だった（`guest-mode-spec.md` §24）。
 * ここが狂うと、その判断がまた狂う。
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { funnelFrom, type FunnelUser } from "../admin-analytics";

const START = "2026-09-01";
const u = (o: Partial<FunnelUser> & { id: string }): FunnelUser => ({
  created_at: "2026-09-02T00:00:00Z",
  ...o,
});

test("4 段を、同じ人の集合で数える", () => {
  const f = funnelFrom(
    [
      u({ id: "a", email_confirmed_at: "2026-09-02T01:00:00Z" }),
      u({ id: "b", email_confirmed_at: "2026-09-02T02:00:00Z" }),
      u({ id: "c" }), // 未確認
    ],
    ["a", "b"],
    ["a"],
    START
  );
  assert.equal(f.registered, 3);
  assert.equal(f.confirmed, 2);
  assert.equal(f.firstRead, 2);
  assert.equal(f.pro, 1);
});

test("🔴 期間より前に登録した人は、分母にも分子にも入れない", () => {
  const f = funnelFrom(
    [
      u({ id: "old", created_at: "2026-08-20T00:00:00Z", email_confirmed_at: "x" }),
      u({ id: "new", email_confirmed_at: "x" }),
    ],
    ["old", "new"], // 期間内に読んでいても、コホート外は数えない
    ["old"],
    START
  );
  assert.equal(f.registered, 1);
  assert.equal(f.firstRead, 1);
  assert.equal(f.pro, 0, "コホート外の pro を数えると、転換率が実際より高く出る");
});

test("🔴 匿名を分母に混ぜない", () => {
  const f = funnelFrom(
    [u({ id: "m", email_confirmed_at: "x" }), u({ id: "anon", is_anonymous: true })],
    ["m", "anon"],
    [],
    START
  );
  assert.equal(f.registered, 1, "匿名を混ぜると分母が膨らみ、転換率が低く出る");
  assert.equal(f.firstRead, 1);
});

test("🔴 1 人が何度読んでも 1 人", () => {
  const f = funnelFrom([u({ id: "a" })], ["a", "a", "a"], [], START);
  assert.equal(f.firstRead, 1);
});

test("🔴 利用者一覧が読めなければ、すべて null（0 ではない）", () => {
  const f = funnelFrom(null, ["a"], ["a"], START);
  assert.equal(f.registered, null);
  assert.equal(f.confirmed, null);
  assert.equal(f.firstRead, null, "分母が無いのに分子だけ出すと、率が嘘になる");
  assert.equal(f.pro, null);
});

test("🔴 途中の段だけ読めなかったときも、その段は null", () => {
  const f = funnelFrom([u({ id: "a", email_confirmed_at: "x" })], null, ["a"], START);
  assert.equal(f.registered, 1);
  assert.equal(f.confirmed, 1);
  assert.equal(f.firstRead, null, "読めなかった段を 0 にすると、全員が離脱したように見える");
  assert.equal(f.pro, 1);
});

test("コホートの開始日と capped をそのまま返す", () => {
  const f = funnelFrom([], [], [], START, true);
  assert.equal(f.cohortFrom, START);
  assert.equal(f.capped, true);
});
