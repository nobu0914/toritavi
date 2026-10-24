// ============================================================================
// 🔴 **予約した日と見積りを、戻しと計上まで持ち運ぶ**（2026-10-24・夜間検査 3-9 / 3-10）。
//
// 本番の `toritavi_concierge_begin` は件数だけを予約し、トークンは見るだけだった
// （同時の要求が同じ残りを見て通る・3-9）。`toritavi_concierge_release(p_user_id)` は
// 呼んだ時点の「今日」を減らしていた（23:59 に予約して 00:00 過ぎに落ちると、
// 翌日の件数が減る・3-10）。
//
// SQL（`supabase_migrations/033_concierge_reserve_tokens_and_day.sql`）で:
//   - begin が見積りも tokens_total に足し、予約した日（reserved_day）を返す
//   - release(p_user_id, p_day, p_est_tokens) がその日の件数と見積りを戻す
//   - increment_concierge_usage_srv(..., p_est_tokens, p_day) が見積りを実績に置き換える
//
// サーバは **begin が返した日と、自分が渡した見積り**を覚えておき、そのまま渡す。
// 🔴 **今日を数え直さない。** 数え直すと日付をまたいだときに別の日の行を触る。
//
// 🔴 033 より前の関数（reserved_day を返さない）なら、**新しい引数を渡さない。**
//    渡すと PostgREST が関数を見つけられず、計上が落ちる（上限が緩む側）。
// ============================================================================
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { NextRequest } from "next/server";
import { CONCIERGE_ENABLED } from "../concierge-flags.ts";
import { beginConcierge, releaseConcierge } from "../concierge-quota.ts";
import { recordConciergeUsage } from "../ai-usage-record.ts";
import { POST as conciergePost } from "../../app/api/concierge/route.ts";
import { makeRequest } from "./support/route-harness.ts";
import { fakeDb, resetInjections, type DbCall } from "./support/fake-db.ts";
import {
  CONCIERGE_RESERVED_DAY,
  CONCIERGE_UID,
  anthropicOk,
  conciergeBody,
  setupConcierge,
} from "./support/concierge-fakes.ts";

process.env.ANTHROPIC_API_KEY = "test-key-not-used";
const realFetch = globalThis.fetch;

/** conciergeBody() の本文（「明日の予定は？」7 文字）に対する route の見積り。 */
const EST = Math.ceil("明日の予定は？".length / 2) + 1024;

function rpcArgs(calls: DbCall[], fn: string): unknown[] {
  return calls.filter((c) => c.kind === "rpc" && c.fn === fn).map((c) => (c as { args: unknown }).args);
}

beforeEach(() => resetInjections());
afterEach(() => {
  globalThis.fetch = realFetch;
  resetInjections();
});

describe("予約の控え（concierge-quota）", () => {
  test("🔴 begin が返した予約日と、渡した見積りを控える", async () => {
    const db = fakeDb((c) =>
      c.kind === "rpc" && c.fn === "toritavi_concierge_begin"
        ? { data: [{ status: "ok", used_after: 3, reserved_day: "2026-10-23" }], error: null }
        : { data: null, error: null },
    );
    (globalThis as Record<string, unknown>).__toritaviTestAdmin = db.client;
    const r = await beginConcierge({ userId: CONCIERGE_UID, audience: "free", estTokens: 1500, lang: "ja" });
    assert.ok(r.ok);
    assert.deepEqual(r.reservation, { userId: CONCIERGE_UID, day: "2026-10-23", estTokens: 1500 });
  });

  test("🔴 戻しは予約した日と見積りを渡す（今日を数え直さない）", async () => {
    const db = fakeDb(() => ({ data: null, error: null }));
    (globalThis as Record<string, unknown>).__toritaviTestAdmin = db.client;
    await releaseConcierge({ userId: CONCIERGE_UID, day: "2026-10-23", estTokens: 1500 });
    assert.deepEqual(rpcArgs(db.calls, "toritavi_concierge_release"), [
      { p_user_id: CONCIERGE_UID, p_day: "2026-10-23", p_est_tokens: 1500 },
    ]);
  });

  test("🔴 計上は見積りと予約した日を渡す（見積りを実績に置き換える）", async () => {
    const db = fakeDb(() => ({ data: null, error: null }));
    (globalThis as Record<string, unknown>).__toritaviTestAdmin = db.client;
    const ok = await recordConciergeUsage({
      userId: CONCIERGE_UID,
      tokensIn: 9000,
      tokensOut: 300,
      costCents: 2,
      reservation: { userId: CONCIERGE_UID, day: "2026-10-23", estTokens: 1500 },
    });
    assert.equal(ok, true);
    assert.deepEqual(rpcArgs(db.calls, "increment_concierge_usage_srv"), [
      {
        p_user_id: CONCIERGE_UID,
        p_tokens_in: 9000,
        p_tokens_out: 300,
        p_cost_cents: 2,
        p_est_tokens: 1500,
        p_day: "2026-10-23",
      },
    ]);
  });

  test("🔴 033 より前の関数（reserved_day が無い）なら、新しい引数を渡さない", async () => {
    const db = fakeDb((c) =>
      c.kind === "rpc" && c.fn === "toritavi_concierge_begin"
        ? { data: [{ status: "ok", used_after: 3 }], error: null }
        : { data: null, error: null },
    );
    (globalThis as Record<string, unknown>).__toritaviTestAdmin = db.client;
    const orig = console.error;
    console.error = () => {};
    let r;
    try {
      r = await beginConcierge({ userId: CONCIERGE_UID, audience: "free", estTokens: 1500, lang: "ja" });
    } finally {
      console.error = orig;
    }
    assert.ok(r.ok);
    assert.equal(r.reservation.day, null, "予約日を推測で埋めた（旧い関数は見積りを足していない）");
    await releaseConcierge(r.reservation);
    await recordConciergeUsage({ userId: CONCIERGE_UID, tokensIn: 10, tokensOut: 5, costCents: 0, reservation: r.reservation });
    assert.deepEqual(rpcArgs(db.calls, "toritavi_concierge_release"), [{ p_user_id: CONCIERGE_UID }]);
    assert.deepEqual(rpcArgs(db.calls, "increment_concierge_usage_srv"), [
      { p_user_id: CONCIERGE_UID, p_tokens_in: 10, p_tokens_out: 5, p_cost_cents: 0 },
    ]);
  });
});

describe("/api/concierge の配線", {
  skip: CONCIERGE_ENABLED ? false : "CONCIERGE_ENABLED = false のあいだはルートが 404 で落ちる",
}, () => {
  test("🔴 AI が落ちたら、予約した日の行を見積りぶん戻す", async () => {
    const db = setupConcierge();
    globalThis.fetch = (async () => new Response("overloaded", { status: 529 })) as typeof fetch;
    const orig = console.error;
    console.error = () => {};
    try {
      const res = await conciergePost(makeRequest({ body: conciergeBody() }) as NextRequest);
      assert.equal(res.status, 502);
    } finally {
      console.error = orig;
    }
    assert.deepEqual(rpcArgs(db.calls, "toritavi_concierge_release"), [
      { p_user_id: CONCIERGE_UID, p_day: CONCIERGE_RESERVED_DAY, p_est_tokens: EST },
    ]);
  });

  test("🔴 答えが出たら、予約した日の見積りを実トークンで置き換える", async () => {
    const db = setupConcierge();
    globalThis.fetch = (async () => anthropicOk()) as typeof fetch;
    const res = await conciergePost(makeRequest({ body: conciergeBody() }) as NextRequest);
    assert.equal(res.status, 200);
    const begin = rpcArgs(db.calls, "toritavi_concierge_begin")[0] as { p_est_tokens: number };
    assert.equal(begin.p_est_tokens, EST);
    const usage = rpcArgs(db.calls, "increment_concierge_usage_srv") as Record<string, unknown>[];
    assert.equal(usage.length, 1);
    // 原価の計算はここでは見ない（estimateCostCents の検査の持ち場）
    const { p_cost_cents: _cost, ...rest } = usage[0];
    assert.deepEqual(rest, {
      p_user_id: CONCIERGE_UID,
      p_tokens_in: 10,
      p_tokens_out: 5,
      p_est_tokens: EST,
      p_day: CONCIERGE_RESERVED_DAY,
    });
    assert.equal(rpcArgs(db.calls, "toritavi_concierge_release").length, 0, "成功したのに予約を戻した");
  });
});
