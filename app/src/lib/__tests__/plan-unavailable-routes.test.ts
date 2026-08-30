// ============================================================================
// 🔴 **「分からない」を「無料」に変換しない —— を、route.ts 本体で見張る。**
//
// `plan-resolve.test.ts` は resolvePlan が throw することしか見ていない。
// **各ルートの catch を `plan = "free"` に書き戻しても、テストは全部
// 緑のままだった**（2026-08-30 の指摘 #11）。プラン読み取りの一時的な
// 失敗が 200 + free になると:
//   - Pro 契約者が 429「今月の上限に達しました」を食らう
//   - /api/ai-usage は 200 + plan:'free' を返し、アプリが
//     「まだ反映されていません」を出す —— 課金の嘘
//
// ここでは **3 経路すべて**（/api/ocr・/api/ai-usage・/api/concierge）の
// ハンドラ本体を実行し、プランが読めないとき 503 + plan_unavailable で
// 止まることを固定する。認証と DB クライアント生成だけ差し替え、
// ルート・ai-guard・moderation は本物が動く（support/loader.mjs）。
// ============================================================================
import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextRequest } from "next/server";
import { POST as ocrPost } from "../../app/api/ocr/route.ts";
import { GET as aiUsageGet } from "../../app/api/ai-usage/route.ts";
import { POST as conciergePost } from "../../app/api/concierge/route.ts";
import { makeRequest } from "./support/route-harness.ts";

const UID = "33333333-3333-4333-8333-333333333333";

// concierge は入口で ANTHROPIC_API_KEY の有無を見る（プラン判定より前）。
process.env.ANTHROPIC_API_KEY = "test-key-not-used";

/**
 * `toritavi_user_plan` の読み取りだけが指定どおりに振る舞い、
 * それ以外のテーブル（moderation の user_status 等）は「行なし・エラーなし」
 * を返す偽クライアント。moderation はフェイルオープンなので素通りし、
 * プラン解決の失敗だけが効く形になる。
 */
function fakeSb(planResult: { data: unknown; error: unknown }) {
  return {
    from(table: string) {
      const result =
        table === "toritavi_user_plan" ? planResult : { data: null, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => result,
      };
      return chain;
    },
  };
}

function login(sb: unknown) {
  (globalThis as Record<string, unknown>).__toritaviTestAuth = () => ({
    sb,
    userId: UID,
    isAnonymous: false,
  });
}

const dbDown = { data: null, error: { message: "connection reset" } };

async function body(res: { json(): Promise<unknown> }) {
  return (await res.json()) as Record<string, unknown>;
}

test("🔴 /api/ocr: プランが読めなければ 503 plan_unavailable（free に落とさない）", async () => {
  login(fakeSb(dbDown));
  const res = await ocrPost(makeRequest() as NextRequest);
  assert.equal(res.status, 503, "読めない plan を free 扱いで先へ進めた");
  assert.equal((await body(res)).error, "plan_unavailable");
});

test("🔴 /api/ai-usage: プランが読めなければ 503 plan_unavailable（200 + free の課金の嘘を返さない）", async () => {
  login(fakeSb(dbDown));
  const res = await aiUsageGet(makeRequest() as NextRequest);
  assert.equal(res.status, 503, "読めない plan を 200 + free で返した");
  assert.equal((await body(res)).error, "plan_unavailable");
});

test("🔴 /api/concierge: プランが読めなければ 503 plan_unavailable（生 500 にも free にもしない）", async () => {
  login(fakeSb(dbDown));
  const res = await conciergePost(
    makeRequest({ body: JSON.stringify({ text: "上限を確認したい" }) }) as NextRequest,
  );
  assert.equal(res.status, 503, "読めない plan を free 扱いか未処理例外にした");
  assert.equal((await body(res)).error, "plan_unavailable");
});

test("/api/ai-usage: プランが読めれば通常どおり返す（このテスト自体が経路に届いている証拠）", async () => {
  // 🔴 これが無いと、ハーネスの組み立てを誤って**何でも 503 になる**状態でも
  //    上の 3 件は緑になる。「503 を返せる」ではなく「読めないときだけ 503」を
  //    見るための対照。
  login(fakeSb({ data: { plan: "pro" }, error: null }));
  const res = await aiUsageGet(makeRequest() as NextRequest);
  assert.equal(res.status, 200);
  assert.equal((await body(res)).plan, "pro");
});
