// ============================================================================
// 🔴 **答えが出たあとの書き込みを 1 本ずつ待たない**（2026-10-19・夜間検査 7-33）。
//
// `/api/concierge` は答えを受け取ってから、**アシスタントの発言の保存 →
// 使用量の計上（RPC）→ スレッドの更新日時** の 3 つを順に待ってから返していた。
// 3 つは互いの結果を使わない。
//
// 🔴 **計上は待ったまま返す。** `increment_concierge_usage_srv` は全体と
//    その人の月の原価に足し込み、次の予約（`toritavi_concierge_begin`）が
//    それを見て止める。応答のあと（after）に回すと、計上が落ちたときに
//    **誰も気づかないまま上限が緩む。** 並べるだけで、外へは出さない。
// ============================================================================
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { NextRequest } from "next/server";
import { CONCIERGE_ENABLED } from "../concierge-flags.ts";
import { POST as conciergePost } from "../../app/api/concierge/route.ts";
import { makeRequest } from "./support/route-harness.ts";
import { gate, label, resetInjections, settle } from "./support/fake-db.ts";
import {
  anthropicOk,
  conciergeBody,
  isAfterAnswerWrite,
  setupConcierge,
} from "./support/concierge-fakes.ts";

process.env.ANTHROPIC_API_KEY = "test-key-not-used";
const realFetch = globalThis.fetch;

describe("/api/concierge の答えのあと", {
  skip: CONCIERGE_ENABLED ? false : "CONCIERGE_ENABLED = false のあいだはルートが 404 で落ちる",
}, () => {
  beforeEach(() => {
    resetInjections();
    globalThis.fetch = (async () => anthropicOk()) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("🔴 発言の保存・使用量の計上・スレッドの更新が同時に始まる", async () => {
    const hold = gate();
    const db = setupConcierge({ holdAfterWrites: hold.wait });

    const pending = conciergePost(makeRequest({ body: conciergeBody() }) as NextRequest);
    for (let i = 0; i < 50 && !db.calls.some(isAfterAnswerWrite); i++) await settle(1);
    await settle();

    const started = db.calls.filter(isAfterAnswerWrite).map(label);
    assert.equal(
      started.length,
      3,
      `🔴 前の書き込みが終わるまで次が始まっていない（直列）: 始まったもの = ${started.join(", ")}`,
    );

    hold.open();
    const res = await pending;
    assert.equal(res.status, 200);
    const b = (await res.json()) as { assistant: { content: string } };
    assert.equal(b.assistant.content, "明日は 9:00 の便です。");
  });

  test("🔴 使用量の計上は待ってから返す（応答のあとへ回さない）", async () => {
    const hold = gate();
    const db = setupConcierge({ holdUsage: hold.wait });

    let done = false;
    const pending = conciergePost(makeRequest({ body: conciergeBody() }) as NextRequest).then(
      (r) => {
        done = true;
        return r;
      },
    );
    for (let i = 0; i < 50 && !db.calls.some((c) => label(c) === "rpc:increment_concierge_usage_srv"); i++) {
      await settle(1);
    }
    await settle();
    assert.equal(done, false, "🔴 計上が終わる前に応答を返した（計上が落ちても誰も気づかない）");

    hold.open();
    const res = await pending;
    assert.equal(res.status, 200);
  });

  // 🔴 計上が落ちても、その要求の原価を 1 回で諦めない（2026-10-24・夜間検査 3-8）。
  //    やり直しても通らなければ `[ai-usage] UNRECORDED` で残す。答えは返す ——
  //    AI は既に呼ばれて実費が出ており、利用者を待たせて失敗にしても原価は戻らない。
  test("🔴 計上が落ちてもやり直し、最後まで落ちても答えは返す", async () => {
    const db = setupConcierge({ failUsage: Infinity });
    const errors: string[] = [];
    const orig = { error: console.error, warn: console.warn };
    console.error = (...a: unknown[]) => errors.push(a.map(String).join(" "));
    console.warn = () => {};
    try {
      const res = await conciergePost(makeRequest({ body: conciergeBody() }) as NextRequest);
      assert.equal(res.status, 200, "計上が落ちただけで答えを捨てた");
      const b = (await res.json()) as { assistant: { content: string } };
      assert.equal(b.assistant.content, "明日は 9:00 の便です。");
    } finally {
      console.error = orig.error;
      console.warn = orig.warn;
    }
    const tries = db.calls.filter((c) => label(c) === "rpc:increment_concierge_usage_srv").length;
    assert.equal(tries, 3, "🔴 計上が 1 回落ちただけで諦めた（その要求の原価が上限に足されない）");
    assert.ok(
      errors.some((e) => e.includes("[ai-usage] UNRECORDED")),
      "🔴 計上が落ちたことが目立つ形で残っていない",
    );
  });
});
