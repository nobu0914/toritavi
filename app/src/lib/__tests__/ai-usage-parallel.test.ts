// ============================================================================
// 🔴 **残数の API（GET /api/ai-usage）の往復を 1 本ずつ待たない**
//    （2026-10-19・夜間検査 7-35）。
//
// 会員 1 回の表示で **認証 → プラン → 期間の始まり（RPC）→ OCR の件数 →
// 期間の終わり（RPC）** と 5 本を順に待っていた（コンシェルジュの件数だけが
// OCR と並んでいた）。プランの結果で変わるのは「上限の数字」だけで、
// **DB から読む値はプランに依存しない。** 期間の始まりと終わりも互いに独立。
//
// 期間の始まり → OCR の件数 は**鍵が要るので直列のまま**（ここは並べられない）。
//
// ここでは読み取りを門で止め、止めている間に
// 「プラン・期間の始まり・コンシェルジュの件数・期間の終わり」の 4 つが
// 始まっていることを見る（直列ならプランしか始まらない）。
// ============================================================================
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { NextRequest } from "next/server";
import { GET as aiUsageGet } from "../../app/api/ai-usage/route.ts";
import { makeRequest } from "./support/route-harness.ts";
import { fakeDb, gate, label, resetInjections, settle, type DbCall } from "./support/fake-db.ts";

const UID = "66666666-6666-4666-8666-666666666666";

type Opts = {
  hold?: ReturnType<typeof gate>;
  plan?: { data?: unknown; error?: unknown };
  periodNext?: { data?: unknown; error?: unknown };
  ocrUsage?: { data?: unknown; error?: unknown };
};

function setup(opts: Opts = {}) {
  const db = fakeDb(async (call: DbCall) => {
    if (opts.hold) await opts.hold.wait();
    if (call.kind === "rpc") {
      if (call.fn === "ocr_period_start") return { data: "2026-10-01", error: null };
      if (call.fn === "ocr_period_next") return opts.periodNext ?? { data: "2026-11-01", error: null };
      return { data: null, error: { message: "unknown rpc" } };
    }
    if (call.table === "toritavi_user_plan") return opts.plan ?? { data: { plan: "free" }, error: null };
    if (call.table === "toritavi_ocr_usage_monthly") {
      return opts.ocrUsage ?? { data: { requests_count: 3, tokens_total: 1000 }, error: null };
    }
    if (call.table === "toritavi_concierge_usage") {
      return { data: { requests_count: 2, tokens_total: 500 }, error: null };
    }
    return { data: null, error: null };
  });
  (globalThis as Record<string, unknown>).__toritaviTestAuth = () => ({
    sb: db.client,
    userId: UID,
    isAnonymous: false,
    userMetadata: {},
  });
  return db;
}

async function body(res: { json(): Promise<unknown> }) {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => resetInjections());

test("🔴 プラン・期間の始まり・コンシェルジュの件数・期間の終わりが同時に始まる", async () => {
  const hold = gate();
  const db = setup({ hold });

  const pending = aiUsageGet(makeRequest() as NextRequest);
  await settle();
  const started = db.calls.map(label);
  for (const t of [
    "toritavi_user_plan",
    "rpc:ocr_period_start",
    "toritavi_concierge_usage",
    "rpc:ocr_period_next",
  ]) {
    assert.ok(
      started.includes(t),
      `🔴 ${t} が、前の往復が終わるまで始まっていない（直列）: 始まったもの = ${started.join(", ")}`,
    );
  }

  hold.open();
  const res = await pending;
  assert.equal(res.status, 200);
  const b = await body(res);
  assert.equal(b.plan, "free");
  const ocr = b.ocr as Record<string, unknown>;
  const concierge = b.concierge as Record<string, unknown>;
  // 🔴 **並べても読んだ値を取り違えていない。** 件数は件数の表から、
  //    上限はプランから。
  assert.equal(ocr.usedRequests, 3);
  assert.equal(concierge.usedRequests, 2);
  assert.equal(b.resetAt, new Date("2026-11-01T00:00:00+09:00").toISOString());
});

test("🔴 上限の数字は、読み終えたプランで決める（並べても pro を free で数えない）", async () => {
  setup({ plan: { data: { plan: "pro" }, error: null } });
  const res = await aiUsageGet(makeRequest() as NextRequest);
  assert.equal(res.status, 200);
  const b = await body(res);
  assert.equal(b.plan, "pro");
  const ocr = b.ocr as Record<string, unknown>;
  assert.equal(ocr.limitRequests, ocr.proLimitRequests, "🔴 pro なのに無料の上限で返した");
});

test("🔴 期間の終わりが読めなければ、Pro には日付を出さない（並べても変わらない）", async () => {
  setup({
    plan: { data: { plan: "pro" }, error: null },
    periodNext: { data: null, error: { message: "boom" } },
  });
  const res = await aiUsageGet(makeRequest() as NextRequest);
  assert.equal(res.status, 200);
  assert.equal((await body(res)).resetAt, null);
});

test("🔴 プランが読めなければ 503（ほかの読み取りが先に済んでいても）", async () => {
  setup({ plan: { data: null, error: { message: "connection reset" } } });
  const res = await aiUsageGet(makeRequest() as NextRequest);
  assert.equal(res.status, 503);
  assert.equal((await body(res)).error, "plan_unavailable");
});

// 🔴 Codex 夜間検査 3-3（2026-10-24）: 使用量の SELECT だけが落ちると、
//    error を捨てて 0 件にし、200 で「残り満杯」を返していた。
test("🔴 使用量を読めなければ 503（0 件として 200 を返さない）", async () => {
  setup({ ocrUsage: { data: null, error: { message: "timeout" } } });
  const res = await aiUsageGet(makeRequest() as NextRequest);
  assert.equal(res.status, 503);
  const b = await body(res);
  assert.equal(b.error, "plan_unavailable");
  assert.equal((b as { ocr?: unknown }).ocr, undefined);
});

test("対照: 行が無い（今期まだ使っていない）は 0 件で 200", async () => {
  setup({ ocrUsage: { data: null, error: null } });
  const res = await aiUsageGet(makeRequest() as NextRequest);
  assert.equal(res.status, 200);
  const b = (await body(res)) as { ocr: { usedRequests: number } };
  assert.equal(b.ocr.usedRequests, 0);
});
