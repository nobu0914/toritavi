// ============================================================================
// 🔴 **読み取りの断り文言が、アプリの画面に届く形で・利用者の言語で返ること**
// （2026-10-19・夜間検査 3-2 / 3-3 / 3-25）。
//
// アプリは `{error, message}` の `message` が**文字列のときだけ**それを出し、
// それ以外は汎用の文言に倒す（`toritavi_app` の `scan_screen.dart` の
// `_serverMessage`）。**落ちも警告も出ない**ので、ここで固定する。
//
// 3-2  月予算の 503 が `message` に `{ja, en}` の**オブジェクト**を載せていた
//      → アプリは捨てて汎用文言を出す。「あなたの枠は減っていない」が届かない。
// 3-3  件数超過の 429 だけ `msgsFor` に言語を渡しておらず、**英語でも日本語**。
// 3-25 インライン上限（約 3MB）で断るのに、文言は「1 ファイル 10MB まで」で
//      日本語固定だった。**数字が実際の上限と違う。**
// ============================================================================
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { NextRequest } from "next/server";
import { OCR_GUARD, beginOcrRequest, msgsFor } from "../ai-guard.ts";
import { MAX_INLINE_FILE_BYTES, MAX_INLINE_TOTAL_BYTES } from "../ocr-limits.ts";
import { POST as ocrPost } from "../../app/api/ocr/route.ts";
import { makeRequest } from "./support/route-harness.ts";
import { fakeDb, resetInjections, type DbCall } from "./support/fake-db.ts";

const UID = "66666666-6666-4666-8666-666666666666";
const REQ = "77777777-7777-4777-8777-777777777777";
const JP = /[ぁ-んァ-ヶ一-龥]/;
process.env.ANTHROPIC_API_KEY = "test-key-not-used";

beforeEach(() => resetInjections());

async function body(res: { json(): Promise<unknown> }) {
  return (await res.json()) as Record<string, unknown>;
}

/** `toritavi_ocr_begin_request` が `status` を返す DB を差し込んで呼ぶ。 */
async function begin(status: string, lang: "ja" | "en", extra: Record<string, unknown> = {}) {
  const db = fakeDb((call: DbCall) => {
    if (call.kind === "rpc" && call.fn === "toritavi_ocr_begin_request") {
      return { data: [{ status, ...extra }], error: null };
    }
    // logAiRejection の insert など。中身は見ない。
    return { data: null, error: null };
  });
  (globalThis as Record<string, unknown>).__toritaviTestAdmin = db.client;
  const r = await beginOcrRequest({
    requestId: REQ,
    userId: UID,
    audience: "free",
    units: 2,
    limitUnits: 15,
    estCostCents: 1,
    estTokens: 1000,
    limitTokens: 500_000,
    countedInput: 100,
    reservedInput: 120,
    lang,
  });
  assert.ok(!("kind" in r), `🔴 断るはずの ${status} が通った`);
  return r as unknown as { status: number; json(): Promise<unknown> };
}

// ---- 3-2 ------------------------------------------------------------------

for (const lang of ["ja", "en"] as const) {
  test(`🔴 3-2 月予算の 503: message が文字列で、${lang} の既存文言そのもの`, async () => {
    const res = await begin("budget_exceeded", lang);
    assert.equal(res.status, 503);
    const b = await body(res);
    assert.equal(b.error, "monthly_budget_exceeded");
    assert.equal(
      typeof b.message,
      "string",
      "🔴 message が文字列でない —— アプリはこれを捨てて汎用の文言を出す",
    );
    // 🔴 **新しい文言を書かない。** 既存の文言をそのまま、言語だけ選ぶ。
    assert.equal(b.message, OCR_GUARD.messages.budgetExceeded[lang]);
    assert.equal(b.message, msgsFor(OCR_GUARD, "free", lang).budgetExceeded);
    if (lang === "en") assert.ok(!JP.test(b.message as string), `🔴 英語の利用者に日本語: ${b.message}`);
  });
}

// ---- 3-3 ------------------------------------------------------------------

test("🔴 3-3 件数超過の 429: lang=en なら英語", async () => {
  const res = await begin("quota_exceeded", "en", { used_after: 14 });
  assert.equal(res.status, 429);
  const b = await body(res);
  assert.equal(b.error, "quota_request_limit");
  assert.equal(b.remaining, 1);
  assert.equal(b.message, msgsFor(OCR_GUARD, "free", "en").quotaUnits(1));
  assert.ok(!JP.test(String(b.message)), `🔴 英語の利用者に日本語: ${b.message}`);
});

test("3-3 件数超過の 429: lang=ja は今までどおり日本語", async () => {
  const b = await body(await begin("quota_exceeded", "ja", { used_after: 14 }));
  assert.equal(b.message, msgsFor(OCR_GUARD, "free", "ja").quotaUnits(1));
});

// ---- 3-25 -----------------------------------------------------------------

/** 試行制限まで通し、ファイル検証に届く /api/ocr を組む。 */
function setupRoute(lang: "ja" | "en") {
  const db = fakeDb((call: DbCall) => {
    if (call.kind === "rpc") {
      if (call.fn === "toritavi_ocr_try_attempt") return { data: true, error: null };
      return { data: null, error: { message: `unexpected rpc ${call.fn}` } };
    }
    if (call.table === "toritavi_consent_records") return { data: [], error: null };
    if (call.table === "toritavi_user_plan") return { data: { plan: "free" }, error: null };
    return { data: null, error: null };
  });
  const g = globalThis as Record<string, unknown>;
  g.__toritaviTestAdmin = db.client;
  g.__toritaviTestAuth = () => ({
    sb: db.client,
    userId: UID,
    isAnonymous: false,
    // 🔴 言語の第一の源（`resolveLang`）。
    userMetadata: { lang },
  });
}

const MB = MAX_INLINE_TOTAL_BYTES / (1024 * 1024);
const EXPECTED = {
  ja: `ファイルが大きすぎます（1 回の読み取りで合計 ${MB}MB まで）。画像を圧縮するか、PDF をページで分けてお試しください。`,
  en: `The file is too large (up to ${MB} MB per scan in total). Please compress the image or split the PDF.`,
} as const;

for (const lang of ["ja", "en"] as const) {
  test(`🔴 3-25 インライン上限の 413: ${lang} で、上限の数字が定数から入り 10MB と言わない`, async () => {
    setupRoute(lang);
    const big = Buffer.alloc(MAX_INLINE_TOTAL_BYTES + 1).toString("base64");
    const res = await ocrPost(
      makeRequest({
        body: JSON.stringify({ requestId: REQ, images: [`data:image/png;base64,${big}`] }),
      }) as NextRequest,
    );
    assert.equal(res.status, 413);
    const b = await body(res);
    assert.equal(b.error, "too_large");
    const msg = String(b.message);
    assert.ok(msg.includes(lang === "ja" ? `${MB}MB` : `${MB} MB`), `🔴 上限の数字が無い: ${msg}`);
    assert.ok(!/10\s?MB/.test(msg), `🔴 実際の上限と違う 10MB と言っている: ${msg}`);
    if (lang === "en") assert.ok(!JP.test(msg), `🔴 英語の利用者に日本語: ${msg}`);
    assert.equal(msg, EXPECTED[lang]);
  });
}

test("3-25 「合計」と言ってよい前提: 1 ファイルの上限が合計の上限を下回らない", () => {
  // 1 ファイルの上限の方が小さいと、合計に届かない 1 枚が
  // 「合計 3MB まで」で断られ、文言が嘘になる。
  assert.ok(MAX_INLINE_FILE_BYTES >= MAX_INLINE_TOTAL_BYTES);
});
