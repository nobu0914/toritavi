// ============================================================================
// 🔴 **コンシェルジュに締切を付け、予約を必ず戻す**（2026-10-19・夜間検査 7-34）。
//
// アプリ（`toritavi_app` の `concierge_service.dart` の `kConciergeTimeout`）は
// **60 秒で諦める。** サーバ側の `/api/concierge` には締切も `maxDuration` も
// 無く、Anthropic の呼び出しは SDK の既定（10 分）まで待ちうる。
// その間にプラットフォームの上限で関数が殺されると、
// `toritavi_concierge_begin` で取った**予約が戻らない**
// （`toritavi_concierge_release` が呼ばれない）。利用者は答えを受け取れないのに
// 日次の枠だけが減る。
//
// `/api/ocr` は同じ問題を `request-deadline.ts` の「絶対締切」で解いている。
// ここでも開始時刻から締切を引き、**アプリが諦める前に返し、後片づけの
// 時間を必ず残す。**
//
// 時間は `node:test` の偽の時計で進める（実時間は待たない）。
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import type { NextRequest } from "next/server";
import { CONCIERGE_ENABLED } from "../concierge-flags.ts";
import {
  CONCIERGE_AFTER_MS,
  CONCIERGE_APP_TIMEOUT_MS,
  CONCIERGE_MIN_CALL_MS,
  CONCIERGE_TOTAL_MS,
  conciergeCallBudget,
} from "../request-deadline.ts";
import { POST as conciergePost } from "../../app/api/concierge/route.ts";
import { makeRequest } from "./support/route-harness.ts";
import { gate, label, resetInjections, settle } from "./support/fake-db.ts";
import {
  anthropicOk,
  conciergeBody,
  releases,
  setupConcierge,
} from "./support/concierge-fakes.ts";

process.env.ANTHROPIC_API_KEY = "test-key-not-used";

const T0 = Date.parse("2026-10-19T03:00:00Z");
const realFetch = globalThis.fetch;

describe("締切の数字", () => {
  test("🔴 アプリが諦めるより前に返し終える", () => {
    assert.ok(CONCIERGE_TOTAL_MS < CONCIERGE_APP_TIMEOUT_MS);
  });

  test("🔴 maxDuration は締切より長い（後片づけの前に殺されない）", () => {
    // ルートの `export const maxDuration` は Next が静的に読むので数値の直書き。
    // **書いてあること**を読む（消されたら落ちる）。
    const src = readFileSync("src/app/api/concierge/route.ts", "utf8");
    const m = src.match(/^export const maxDuration = (\d+);$/m);
    assert.ok(m, "🔴 /api/concierge に maxDuration が無い（プラットフォームの既定で切られる）");
    assert.ok(Number(m[1]) * 1000 > CONCIERGE_TOTAL_MS, "🔴 締切の前に関数が殺されうる");
  });

  test("開始直後は、後片づけのぶんを残して AI に渡す", () => {
    const b = conciergeCallBudget(T0, T0);
    assert.equal(b.ok, true);
    if (b.ok) assert.equal(b.countMs, CONCIERGE_TOTAL_MS - CONCIERGE_AFTER_MS);
  });

  test("🔴 残りが最低線を割ったら呼ばない", () => {
    const late = T0 + CONCIERGE_TOTAL_MS - CONCIERGE_AFTER_MS - CONCIERGE_MIN_CALL_MS + 1;
    assert.equal(conciergeCallBudget(T0, late).ok, false);
  });
});

describe("/api/concierge の締切", {
  skip: CONCIERGE_ENABLED ? false : "CONCIERGE_ENABLED = false のあいだはルートが 404 で落ちる",
}, () => {
  beforeEach(() => resetInjections());
  afterEach(() => {
    mock.timers.reset();
    globalThis.fetch = realFetch;
  });

  test("🔴 AI を呼ぶ前に締切が近ければ、呼ばずに予約を戻す", async () => {
    mock.timers.enable({ apis: ["Date"], now: T0 });
    const hold = gate();
    const db = setupConcierge({ holdHistory: hold.wait });
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched += 1;
      return anthropicOk();
    }) as typeof fetch;

    const pending = conciergePost(makeRequest({ body: conciergeBody() }) as NextRequest);
    // 履歴の読み取り（AI の直前）で止まるまで待つ。
    for (let i = 0; i < 50 && !db.calls.map(label).includes("toritavi_concierge_messages"); i++) {
      await settle(1);
    }
    // 前の段が遅れて、締切まで後片づけ＋最低線ぶんしか残っていない状態にする。
    mock.timers.tick(CONCIERGE_TOTAL_MS - CONCIERGE_AFTER_MS - CONCIERGE_MIN_CALL_MS + 1);
    hold.open();
    const res = await pending;

    assert.equal(fetched, 0, "🔴 間に合わないのに AI を呼んだ（呼んでから殺されると予約が戻らない）");
    assert.equal(releases(db.calls), 1, "🔴 予約を戻していない");
    assert.notEqual(res.status, 200);
  });

  test("🔴 AI が返らなければ締切で打ち切り、予約を戻して返す", async () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"], now: T0 });
    const db = setupConcierge();
    let called = false;
    globalThis.fetch = ((_url: unknown, init?: { signal?: AbortSignal }) => {
      called = true;
      return new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () =>
          rej(new DOMException("This operation was aborted", "AbortError")),
        );
      });
    }) as typeof fetch;

    let done = false;
    const pending = conciergePost(makeRequest({ body: conciergeBody() }) as NextRequest).then(
      (r) => {
        done = true;
        return r;
      },
    );
    for (let i = 0; i < 50 && !called; i++) await settle(1);
    assert.ok(called, "AI の呼び出しまで届いていない（偽物の組み立てを疑う）");

    // 締切（後片づけのぶんを残した時刻）まで進める。
    mock.timers.tick(CONCIERGE_TOTAL_MS - CONCIERGE_AFTER_MS);
    for (let i = 0; i < 50 && !done; i++) await settle(1);
    const finished = done;
    if (!finished) {
      // 片づけ: SDK の既定（10 分）まで進めて、ぶら下がった要求を終わらせる。
      mock.timers.tick(600_000);
      await pending;
    }
    assert.ok(
      finished,
      "🔴 締切を過ぎても AI を待ち続けている（アプリは 60 秒で諦め、関数が殺されると予約が戻らない）",
    );
    const res = await pending;
    assert.equal(releases(db.calls), 1, "🔴 打ち切ったのに予約を戻していない");
    assert.equal(res.status, 502);
  });
});
