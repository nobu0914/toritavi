// ============================================================================
// 🔴 **「読む側の権限で呼べるか」を見張る。**
//
// 2026-08-30 に本番を壊した。`ocr_period_start` の実行権限を
// `service_role` だけにしたが、**読む側（`/api/ai-usage`）は利用者の
// 認証クライアント（`authenticated` ロール）で呼ぶ。** 権限が無く RPC が
// 失敗し、フェイルクローズが効いて **全利用者の残数バッジが 503** になった。
//
// **テストは 109 件すべて緑だった。** 偽の Supabase は権限を持たないので、
// 誰が呼ぶかを一切見ていなかった。
//
// ここで固定できるのは「**どのクライアントで呼んでいるか**」だけで、
// 実際の GRANT は SQL 側の話。だから 2 つに分けて見張る:
//
//   1. このテスト … 読む側が「利用者の client」を使っていること（下記）
//   2. `026_ocr_period_start_caller_guard.sql` の末尾 select
//      … 本番の proacl に `authenticated` があること（人が目で見る）
//
// **片方だけでは足りない。** 1 だけだと GRANT を落としても気づかず、
// 2 だけだとコードが service client に変わったときに気づかない。
// ============================================================================
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/** コメント行を落とす（注釈が自分自身に一致して緑になるのを防ぐ）。 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => {
      const t = l.trimStart();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return "";
      const i = l.indexOf("//");
      return i >= 0 ? l.slice(0, i) : l;
    })
    .join("\n");
}

test("🔴 期間キーの RPC は、渡された client（利用者の client）で呼ぶ", () => {
  const src = code("src/lib/ai-guard.ts");
  const at = src.indexOf("async function quotaKey");
  assert.ok(at > 0, "quotaKey が見つからない");
  const body = src.slice(at, src.indexOf("\n}", at));

  assert.match(
    body,
    /sb\.rpc\(\s*"ocr_period_start"/,
    "期間キーは `sb`（呼び出し元から渡された client）で引くこと。" +
      "`createServiceClient()` に変えると、`authenticated` への GRANT が" +
      "不要になったと誤解され、次に GRANT を落とされて本番が 503 になる",
  );
  assert.doesNotMatch(
    body,
    /createServiceClient/,
    "ここで service client を作らないこと。読み取り経路に書き込み権限を持ち込む",
  );
});

test("移行ファイルが authenticated に GRANT していること", () => {
  // 🔴 SQL 側の GRANT はテストから実行できない。**書いてあることだけ**見る。
  //    実際に効いているかは本番で確かめる（026 の末尾 select）。
  const sql = readFileSync(
    "../supabase_migrations/026_ocr_period_start_caller_guard.sql",
    "utf8",
  );
  assert.match(
    sql,
    /grant execute on function public\.ocr_period_start\(uuid\) to authenticated/,
    "読む側が authenticated で呼ぶので、GRANT が要る",
  );
  assert.match(
    sql,
    /auth\.uid\(\) <> p_user_id/,
    "GRANT を戻すだけにしない。**他人の期間を引けなくする関門**が要る",
  );
});
