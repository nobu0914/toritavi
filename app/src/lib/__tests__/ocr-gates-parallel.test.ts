// ============================================================================
// 🔴 **/api/ocr の入口の読み取りを、1 本ずつ待たない**（2026-10-19・夜間検査 7-31）。
//
// 認証のあと、Claude を呼ぶ前に **許諾 → プラン → 非常停止スイッチ →
// モデレーション** の 4 つを 1 本ずつ待っていた。どれも userId だけで引け、
// **互いの結果を使わない**ので、待つ必要があるのは「どの順で判定するか」だけ。
//
// ここでは 4 つの読み取りを門で止め、**止めている間に 4 つとも始まっている**
// ことを見る（直列なら 1 つ目しか始まらない）。
//
// 🔴 **判定の順序は変えない。** DB が落ちたときに返るコードが変わると、
//    `/api/concierge` と同じ状況で違うコードを返すことになる
//    （`concierge/route.ts` の「並びは /api/ocr と同じにする」）。
//    下の 3 本がそれを固定する。
// ============================================================================
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { NextRequest } from "next/server";
import { POST as ocrPost } from "../../app/api/ocr/route.ts";
import { makeRequest } from "./support/route-harness.ts";
import { fakeDb, gate, label, resetInjections, settle, type DbCall } from "./support/fake-db.ts";

const UID = "55555555-5555-4555-8555-555555555555";
process.env.ANTHROPIC_API_KEY = "test-key-not-used";

const GATED = [
  "toritavi_consent_records",
  "toritavi_user_plan",
  "toritavi_ai_switches",
  "toritavi_user_status",
];

type Over = Partial<Record<string, { data?: unknown; error?: unknown }>>;

function setup(opts: { hold?: ReturnType<typeof gate>; over?: Over; anonymous?: boolean } = {}) {
  const db = fakeDb(async (call: DbCall) => {
    if (call.kind !== "query") return { data: null, error: { message: "unexpected rpc" } };
    if (opts.hold && GATED.includes(call.table)) await opts.hold.wait();
    const o = opts.over?.[call.table];
    if (o) return o;
    if (call.table === "toritavi_consent_records") return { data: [], error: null };
    if (call.table === "toritavi_user_plan") return { data: { plan: "free" }, error: null };
    return { data: null, error: null };
  });
  const g = globalThis as Record<string, unknown>;
  g.__toritaviTestAdmin = db.client;
  g.__toritaviTestAuth = () => ({
    sb: db.client,
    userId: UID,
    isAnonymous: opts.anonymous === true,
    userMetadata: {},
  });
  return db;
}

async function body(res: { json(): Promise<unknown> }) {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => resetInjections());
afterEach(() => {
  delete process.env.OCR_MODE;
});

// 🔴 **このファイルの最初に置く。** `getAiMode` は 15 秒キャッシュするので、
//    後ろに置くとスイッチの読み取りが起きず、4 つ目が数えられない。
test("🔴 許諾・プラン・スイッチ・モデレーションの読み取りが同時に始まる", async () => {
  const hold = gate();
  const db = setup({ hold });

  const pending = ocrPost(makeRequest({ body: "{}" }) as NextRequest);
  await settle();
  const started = db.calls.map(label);
  for (const t of GATED) {
    assert.ok(
      started.includes(t),
      `🔴 ${t} が、前の読み取りが終わるまで始まっていない（直列）: 始まったもの = ${started.join(", ")}`,
    );
  }

  hold.open();
  const res = await pending;
  // 4 つの門を全部通り、本文の検査（requestId が無い）まで届いた証拠。
  assert.equal(res.status, 400);
  assert.equal((await body(res)).error, "request_id_required");
});

test("🔴 順序: プランが読めなければ、凍結の判定より先に plan_unavailable", async () => {
  setup({
    over: {
      toritavi_user_plan: { data: null, error: { message: "connection reset" } },
      toritavi_user_status: { data: { status: "suspended", reason: null }, error: null },
    },
  });
  const res = await ocrPost(makeRequest({ body: "{}" }) as NextRequest);
  assert.equal(res.status, 503);
  assert.equal((await body(res)).error, "plan_unavailable");
});

test("🔴 順序: スイッチが止まっていれば、凍結の判定より先に ai_disabled", async () => {
  process.env.OCR_MODE = "off";
  setup({ over: { toritavi_user_status: { data: { status: "suspended", reason: null }, error: null } } });
  const res = await ocrPost(makeRequest({ body: "{}" }) as NextRequest);
  assert.equal(res.status, 503);
  assert.equal((await body(res)).error, "ai_disabled");
});

test("🔴 凍結は並べても効く（読んだ結果を捨てていない）", async () => {
  setup({ over: { toritavi_user_status: { data: { status: "suspended", reason: null }, error: null } } });
  const res = await ocrPost(makeRequest({ body: "{}" }) as NextRequest);
  assert.equal(res.status, 403);
  assert.equal((await body(res)).error, "account_suspended");
});

test("🔴 断るのが決まっているゲストには、許諾以外の読み取りを始めない", async () => {
  const db = setup({ anonymous: true });
  const res = await ocrPost(makeRequest({ body: "{}" }) as NextRequest);
  assert.equal(res.status, 403);
  assert.equal((await body(res)).error, "registration_required");
  const started = db.calls.map(label);
  for (const t of ["toritavi_user_plan", "toritavi_user_status"]) {
    assert.ok(!started.includes(t), `🔴 断る要求に ${t} を読ませた`);
  }
});
