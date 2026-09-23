// ============================================================================
// 🔴 **Pro に金額の蓋が 1 つも無かった**（2026-09-23・利用者の指示で追加）。
//
// 全体の月予算（$50）は `budgetMonthlyCents` にあるが、**意図どおり
// 有料には効かせていない** —— 共有のまま効かせると、無料利用者の消費で
// 課金者が止まるため。その結果、**Pro を縛るものが件数とトークンだけ**になり、
// 金額の上限がどこにも無かった。
//
// 実測（2026-09-23）: 1 通の原価は ¥0.96〜¥4.22 で **98% が入力**。
// Pro の日次トークン上限まで使われると **月 ¥4,000〜5,200**。
// 手取りは **月 ¥602.7**。**「上界が計算できる」と「引き合う」は別。**
//
// ## 🔴 二重計上も同時に直した
//
// `toritavi_concierge_begin`（予約）が `requests_count` を足したあと、
// `increment_concierge_usage_srv` が**もう一度足していた。**
// 2026-09-22 に予約方式へ作り替えたとき、旧方式の「足す」が残っていた。
// **1 回の相談で 2 回数えられ、日次の上限が半分になっていた**
// （本番実測: 09-23 は記録 4 / 実際 2。旧方式の 08-12 は 4 / 4）。
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CONCIERGE_GUARD, OCR_GUARD } from "../ai-guard.ts";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

const QUOTA = "src/lib/concierge-quota.ts";
const SQL = "../../toritavi_app/tool/concierge_reopen.sql";

/**
 * `toritavi_concierge_begin` の本体だけを切り出す。
 *
 * 🔴 **ファイル全体で `indexOf` しない**（2026-09-23 に踏んだ）。
 *    正本に `increment_concierge_usage_srv` を移したら、そちらの
 *    `insert into toritavi_concierge_usage` を先に拾って落ちた。
 *    **見たいのは「予約関数の中の順番」。**
 */
function beginBody(sql: string): string {
  const i = sql.indexOf("function public.toritavi_concierge_begin");
  const j = sql.indexOf("$$;", i);
  return i >= 0 && j > i ? sql.slice(i, j) : "";
}


test("🔴 Pro に金額の蓋がある（0 のままにしない）", () => {
  assert.ok(
    CONCIERGE_GUARD.tiers.pro.userBudgetMonthlyCents > 0,
    "🔴 Pro の月の原価に上限が無い",
  );
  assert.ok(
    CONCIERGE_GUARD.tiers.free.userBudgetMonthlyCents > 0,
    "🔴 無料の 1 人あたりの蓋が無い（全体予算を 1 人で食い切れる）",
  );
});

test("🔴 蓋は手取りより低い（赤字を仕様にしない）", () => {
  // Pro の手取りは月 ¥602.7（¥780 − 消費税 − Apple 15%）。
  // ¥150/$ なので 402 セント。**ここを超える蓋は、使われるほど赤字。**
  const takeHomeCents = 402;
  assert.ok(
    CONCIERGE_GUARD.tiers.pro.userBudgetMonthlyCents < takeHomeCents,
    `🔴 Pro の蓋（${CONCIERGE_GUARD.tiers.pro.userBudgetMonthlyCents}¢）が` +
      ` 手取り（${takeHomeCents}¢）以上。原価だけで手取りを食い切る`,
  );
});

test("ゲストは 0（蓋の有無以前に使えない）", () => {
  assert.equal(CONCIERGE_GUARD.tiers.guest.userBudgetMonthlyCents, 0);
  assert.equal(CONCIERGE_GUARD.tiers.guest.quotaRequests, 0);
});

test("OCR には蓋を置いていない（件数で縛れている）", () => {
  // 1 件の原価が読めるので、件数上限が金額の上限を兼ねる。
  assert.equal(OCR_GUARD.tiers.pro.userBudgetMonthlyCents, 0);
});

test("🔴 蓋が実際に DB へ渡っている", () => {
  const src = code(QUOTA);
  assert.match(
    src,
    /p_user_budget_cents:\s*tier\.userBudgetMonthlyCents/,
    "🔴 定義してあるだけで渡していない",
  );
});

test("🔴 user_budget_exceeded を 503 で返す（全体の停止と別の文言）", () => {
  const src = code(QUOTA);
  const i = src.indexOf('status === "user_budget_exceeded"');
  assert.ok(i >= 0, "🔴 その状態を見ていない");
  const branch = src.slice(i, i + 400);
  assert.match(branch, /status:\s*503/);
  assert.match(
    branch,
    /concierge_user_budget/,
    "🔴 全体の停止と同じ文言を使っている（有料の人が「自分のせいではない」と読む）",
  );
});

test("🔴 SQL が、席を取る前に蓋を見る", () => {
  const sql = beginBody(readFileSync(SQL, "utf8"));
  assert.ok(sql.length > 0, "予約関数の本体が見つからない（検査が空振りしている）");
  const iCap = sql.indexOf("toritavi_concierge_user_budget");
  const iUsage = sql.indexOf("insert into toritavi_concierge_usage");
  assert.ok(iCap >= 0, "🔴 蓋の判定が予約関数に無い");
  assert.ok(iCap < iUsage, "🔴 席を取ってから蓋を見ている");
});

test("🔴 記録側が requests_count を足し直していない（二重計上）", () => {
  const sql = readFileSync(SQL, "utf8");
  const i = sql.indexOf("function public.increment_concierge_usage_srv");
  assert.ok(i >= 0, "🔴 記録の関数が正本に無い");
  const fn = sql.slice(i, sql.indexOf("$$;", i));
  assert.ok(
    !/requests_count\s*=\s*toritavi_concierge_usage\.requests_count\s*\+\s*1/.test(fn),
    "🔴 予約で足したぶんを、記録でもう一度足している —— 上限が半分になる",
  );
});
