// ============================================================================
// 🔴 **使用量の計上が 1 回落ちただけで、その要求の原価が消えない**（2026-10-24・夜間検査 3-8）。
//
// 以前の `record` は RPC の失敗を `console.error` に 1 行出して**握り潰す**だけだった。
// `/api/concierge` はそれを待って 200 を返すので、計上が落ちた要求のトークンと
// 原価は、その人のトークン上限にも月の予算にも**二度と足されない。**
// 落ちても例外は出ず、ログは他の行に埋もれる（CLAUDE.md §6-1「出ないのに落ちない」）。
//
// 固定すること:
//   1. 一時的な失敗は**限られた回数だけ**やり直し、通れば成功を返す
//   2. やり直しても通らなければ**失敗を返し**、目立つ印（`[ai-usage] UNRECORDED`）で残す
// ============================================================================
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { recordConciergeUsage, recordOcrTokensOnly } from "../ai-usage-record.ts";
import { fakeDb, resetInjections, type DbCall } from "./support/fake-db.ts";

const UID = "55555555-5555-4555-8555-555555555555";
const USAGE = { userId: UID, tokensIn: 1200, tokensOut: 340, costCents: 3 };

/** console.error / console.warn を差し替えて、出た行を集める。 */
function captureConsole() {
  const lines: { level: "error" | "warn"; text: string }[] = [];
  const orig = { error: console.error, warn: console.warn };
  const fmt = (args: unknown[]) =>
    args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  console.error = (...args: unknown[]) => lines.push({ level: "error", text: fmt(args) });
  console.warn = (...args: unknown[]) => lines.push({ level: "warn", text: fmt(args) });
  return {
    lines,
    restore() {
      console.error = orig.error;
      console.warn = orig.warn;
    },
  };
}

function rpcCalls(calls: DbCall[], fn: string) {
  return calls.filter((c): c is Extract<DbCall, { kind: "rpc" }> => c.kind === "rpc" && c.fn === fn);
}

describe("使用量の計上のやり直し", () => {
  let cap: ReturnType<typeof captureConsole>;
  beforeEach(() => {
    resetInjections();
    cap = captureConsole();
  });
  afterEach(() => {
    cap.restore();
    resetInjections();
  });

  test("🔴 2 回落ちても 3 回目で通れば計上される（成功を返す）", async () => {
    let n = 0;
    const db = fakeDb((call) => {
      if (call.kind !== "rpc") return { data: null, error: null };
      n += 1;
      // 1 回目は PostgREST のエラー、2 回目は通信の例外 —— どちらもやり直す
      if (n === 1) return { data: null, error: { message: "upstream 503" } };
      if (n === 2) throw new Error("fetch failed");
      return { data: null, error: null };
    });
    (globalThis as Record<string, unknown>).__toritaviTestAdmin = db.client;

    const ok = await recordConciergeUsage(USAGE);

    const calls = rpcCalls(db.calls, "increment_concierge_usage_srv");
    assert.equal(calls.length, 3, "🔴 落ちたあとにやり直していない");
    assert.equal(ok, true);
    // やり直しても同じ値を送る（試行ごとに中身が変わらない）
    for (const c of calls) {
      assert.deepEqual(c.args, {
        p_user_id: UID,
        p_tokens_in: 1200,
        p_tokens_out: 340,
        p_cost_cents: 3,
      });
    }
    assert.ok(
      !cap.lines.some((l) => l.text.includes("UNRECORDED")),
      "通ったのに「計上されていない」と残した",
    );
  });

  test("🔴 やり直しても通らなければ失敗を返し、UNRECORDED の印で残す", async () => {
    const db = fakeDb((call) =>
      call.kind === "rpc"
        ? { data: null, error: { message: "function does not exist" } }
        : { data: null, error: null },
    );
    (globalThis as Record<string, unknown>).__toritaviTestAdmin = db.client;

    const ok = await recordConciergeUsage(USAGE);

    assert.equal(ok, false, "🔴 計上できなかったのに成功を返した");
    assert.equal(
      rpcCalls(db.calls, "increment_concierge_usage_srv").length,
      3,
      "やり直しの回数が決まっていない（無限に回すか、1 回で諦めている）",
    );
    const unrecorded = cap.lines.filter((l) => l.level === "error" && l.text.includes("[ai-usage] UNRECORDED"));
    assert.equal(unrecorded.length, 1, "🔴 計上が落ちたことが目立つ形で残っていない");
    const line = unrecorded[0].text;
    // 後から人が突き合わせられるだけの中身（誰の・どの関数の・いくら）
    assert.match(line, /increment_concierge_usage_srv/);
    assert.ok(line.includes(UID), "誰の計上が落ちたかが分からない");
    assert.match(line, /1200/);
    assert.match(line, /340/);
    assert.match(line, /function does not exist/);
  });

  test("OCR の計上も同じくやり直し、最後まで落ちれば失敗を返す", async () => {
    const db = fakeDb((call) =>
      call.kind === "rpc" ? { data: null, error: { message: "timeout" } } : { data: null, error: null },
    );
    (globalThis as Record<string, unknown>).__toritaviTestAdmin = db.client;

    const ok = await recordOcrTokensOnly({ ...USAGE, units: 1 });

    assert.equal(ok, false);
    assert.equal(rpcCalls(db.calls, "toritavi_record_ocr_tokens_srv").length, 3);
    assert.ok(cap.lines.some((l) => l.text.includes("[ai-usage] UNRECORDED")));
  });
});
