// リクエスト全体の絶対締切。**精算する時間を必ず残す。**
//
// 以前は count_tokens と messages.create にそれぞれ 50 秒を与えていた。
// 合計 100 秒に対して関数の上限は 60 秒。AI が返ったあとに精算する時間が
// 残らないままプラットフォームに殺されうる状態だった。
// 殺されると reserved が残り、件数と予算を握ったままになる。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  callBudget,
  countBudget,
  COUNT_MAX_MS,
  MIN_CALL_MS,
  PLATFORM_SAFETY_MS,
  SETTLE_RESERVE_MS,
  TOTAL_MS,
} from "../request-deadline.ts";

const T0 = 1_000_000;

describe("計測に与える時間", () => {
  test("開始直後は上限いっぱい（ただし COUNT_MAX_MS で頭打ち）", () => {
    const b = countBudget(T0, T0);
    assert.equal(b.ok, true);
    if (b.ok) assert.equal(b.countMs, COUNT_MAX_MS);
  });

  test("🔴 残り時間が少なければ計測を短くする", () => {
    // 開始から 40 秒経過。残り 60-3-40 = 17 秒。
    // そこから精算 8 秒と AI 最低 5 秒を引くと 4 秒。
    const b = countBudget(T0, T0 + 40_000);
    assert.equal(b.ok, true);
    if (b.ok) assert.equal(b.countMs, 4_000);
  });

  test("🔴 精算と AI のぶんが残らないなら始めない", () => {
    const b = countBudget(T0, T0 + 46_000);
    assert.equal(b.ok, false);
  });
});

describe("AI 呼び出しに与える時間", () => {
  test("🔴 精算のぶんを必ず残す", () => {
    const b = callBudget(T0, T0 + 10_000);
    assert.equal(b.ok, true);
    // 残り 60-3-10 = 47 秒。精算 8 秒を引いて 39 秒。
    if (b.ok) assert.equal(b.countMs, 39_000);
  });

  test("🔴 遅延して残りが最低線を割ったら送らない", () => {
    // 送ってから殺されると、課金だけ起きて精算できない。
    const b = callBudget(T0, T0 + 45_000);
    assert.equal(b.ok, false);
  });

  test("計測が遅れても、全体が 60 秒を超える組み合わせにならない", () => {
    // 計測に上限いっぱい使った直後でも、AI + 精算が締切内に収まること。
    const c = countBudget(T0, T0);
    assert.equal(c.ok, true);
    if (!c.ok) return;
    const afterCount = T0 + c.countMs;
    const a = callBudget(T0, afterCount);
    assert.equal(a.ok, true);
    if (!a.ok) return;
    const total = c.countMs + a.countMs + SETTLE_RESERVE_MS + PLATFORM_SAFETY_MS;
    assert.ok(total <= TOTAL_MS, `合計 ${total}ms が上限 ${TOTAL_MS}ms を超える`);
  });

  test("最低線の定数が矛盾していない", () => {
    assert.ok(SETTLE_RESERVE_MS > 0);
    assert.ok(MIN_CALL_MS > 0);
    assert.ok(PLATFORM_SAFETY_MS + SETTLE_RESERVE_MS + MIN_CALL_MS < TOTAL_MS);
  });
});
