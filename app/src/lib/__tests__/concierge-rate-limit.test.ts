// ============================================================================
// 🔴 **分間レートが、定義してあるだけで呼ばれていない状態を作らない**
//    （2026-09-23）。
//
// `CONCIERGE_GUARD.tiers.*.ratePerMin`（無料 5 / Pro 10）は env でも設定でき、
// 429 の文面まで用意されていたのに、**`/api/concierge` から一度も
// 参照されていなかった。** それでいて `route.ts` の冒頭は
// 「3 階層キャップ（**分** / 日 / 月予算）」と宣言していた ——
// **文書だけが嘘をついていた**（`CLAUDE.md` §6-1）。
//
// 原因は 2026-09-22 の作り替え。`enforceAiLimits`（分を見ていた）を
// `beginConcierge` へ置き換えたときに**分だけが落ちた。**
// **日次 500 件（Pro）を数十秒で焼き切れる**状態だった。
//
// 🔴 **値そのものは固定しない。** 上限の増減は判断であって誤りではない。
//    見張るのは「**どこかで実際に使われている**」こと。
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CONCIERGE_GUARD } from "../ai-guard.ts";

/** 行コメントを落とす。**注記に名前があるだけで通さない。** */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

const QUOTA = "src/lib/concierge-quota.ts";
const SQL = "../../toritavi_app/tool/concierge_reopen.sql";

test("すべての層に分間レートが定義されている", () => {
  for (const [name, tier] of Object.entries(CONCIERGE_GUARD.tiers)) {
    assert.equal(
      typeof tier.ratePerMin,
      "number",
      `${name} に ratePerMin が無い`,
    );
    assert.ok(tier.ratePerMin >= 0, `${name} の ratePerMin が負`);
  }
});

test("🔴 ratePerMin が実際に DB へ渡っている", () => {
  const src = code(QUOTA);
  assert.ok(
    /p_rate_per_min:\s*tier\.ratePerMin/.test(src),
    "🔴 ratePerMin を RPC へ渡していない —— 定義してあるだけで効かない",
  );
});

test("🔴 rate_limited を 429 で返している", () => {
  const src = code(QUOTA);
  const i = src.indexOf('status === "rate_limited"');
  assert.ok(i >= 0, "🔴 rate_limited を見ていない");
  // その分岐のすぐ後ろに 429 があること（別の状態の 429 を拾わない）
  const branch = src.slice(i, i + 400);
  assert.match(branch, /status:\s*429/, "🔴 rate_limited が 429 で返っていない");
  assert.match(
    branch,
    /msgs\.rateLimit\(/,
    "🔴 用意されている文面（rateLimit）を使っていない",
  );
});

test("🔴 席を取る前に見る（日次を増やしてから弾かない）", () => {
  // SQL の中で、分間の判定が日次の INSERT より前にあること。
  const sql = readFileSync(SQL, "utf8");
  const iRate = sql.indexOf("toritavi_concierge_rate_buckets (user_id, bucket, hits)");
  const iUsage = sql.indexOf("insert into toritavi_concierge_usage");
  assert.ok(iRate >= 0, "🔴 分バケットへの書き込みが無い");
  assert.ok(iUsage >= 0, "🔴 日次の予約が無い");
  assert.ok(
    iRate < iUsage,
    "🔴 日次を増やしたあとに分間を見ている —— 弾いた要求が枠を食う",
  );
});

test("🔴 旧 6 引数版を落としている（関門の無い版が残らない）", () => {
  // `CLAUDE.md` §6 の危険物と同じ型 ——
  // `create or replace` は引数が違えば**別の関数として増える。**
  const sql = readFileSync(SQL, "utf8");
  assert.match(
    sql,
    /drop function if exists public\.toritavi_concierge_begin\(\s*uuid, text, integer, integer, integer, integer\)/,
    "🔴 旧 6 引数版を落としていない —— 分間レートの無い版が service_role から呼べる",
  );
});

test("🔴 分バケットの表が匿名から読めない形で作られている", () => {
  const sql = readFileSync(SQL, "utf8");
  assert.match(
    sql,
    /revoke all on public\.toritavi_concierge_rate_buckets from public, anon, authenticated;/,
    "🔴 PUBLIC を落としていない",
  );
  assert.match(
    sql,
    /alter table public\.toritavi_concierge_rate_buckets enable row level security;/,
    "🔴 RLS が有効になっていない",
  );
});
