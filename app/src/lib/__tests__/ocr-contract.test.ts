// 実装の**並び順と結線**を原文で見張る。
//
// 🔴 これらは実物を踏めない（Supabase と Anthropic が要る）ので、
//    「踏めないものをテストしたことにしない」ために原文で契約を固定する。
//    並び順が入れ替わると、落ちも警告も出ないまま防御が無効になる。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SPEC_FREE_REQUESTS,
  SPEC_PRO_REQUESTS,
  SPEC_GUEST_REQUESTS,
} from "../ocr-plan-spec.ts";

const route = readFileSync("src/app/api/ocr/route.ts", "utf8");
const guard = readFileSync("src/lib/ai-guard.ts", "utf8");

/** コメントを除いた原文（理由を書いたコメント自体を拾わないため）。 */
function code(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

describe("確定仕様の件数", () => {
  test("Free 5 / Pro 50 / ゲスト 3", () => {
    assert.equal(SPEC_FREE_REQUESTS, 5);
    assert.equal(SPEC_PRO_REQUESTS, 50);
    assert.equal(SPEC_GUEST_REQUESTS, 3);
  });

  test("🔴 ゲストの上限が、件数の軸に存在する", () => {
    // 2026-08-30 まで**存在しなかった**。ゲストは `Audience`（予算の軸）
    // にしか無く、件数は `Plan = free | pro` で引いていたので、
    // `resolvePlan` が行の無い匿名利用者に返す `free` = **5 件**が
    // そのままゲストの上限になっていた（`guest-mode-spec.md` §2-1）。
    const c = code(guard);
    assert.ok(
      c.includes("cappedQuota([\"AI_OCR_GUEST_REQUESTS\"], SPEC_GUEST_REQUESTS)"),
      "ゲストの上限が仕様値に紐づいていない",
    );
  });

  test("🔴 上限を plan ではなく audience で引いている", () => {
    // **ここが本丸。** `tiers[plan]` に戻ると、ゲストが無料会員と同じ枠になる。
    const r = code(route);
    assert.ok(
      !r.includes("tiers[plan]"),
      "🔴 `tiers[plan]` が復活している —— ゲストが無料会員の枠を使う",
    );
    assert.ok(r.includes("tiers[audience]"), "audience で引いていない");
  });

  test("🔴 仕様との突き合わせが guest も見ている", () => {
    // 見張りに guest を足し忘れると、仕様 3 に対して実装が 5 でも黙る。
    // 🔴 **「近くに語がある」で見ない。比較そのものを見る。**
    //    最初は `quotaSpecMismatch` から 600 字以内に SPEC_GUEST_REQUESTS が
    //    あることを見ていたが、**判定の行を消しても返り値の文字列
    //    （`spec ${SPEC_GUEST_REQUESTS}`）が残るので通ってしまった**
    //    （書いた直後の変異検査で発覚。今日 3 度目の同じ失敗）。
    const c = code(guard);
    assert.ok(
      /g\s*===\s*SPEC_GUEST_REQUESTS/.test(c),
      "quotaSpecMismatch が guest を**比較**していない（語があるだけでは足りない）",
    );
  });

  test("🔴 コンシェルジュはゲストに開いていない（0 で固定）", () => {
    // env で開けられる形にしない（`envNum` を使わない）。
    // 設定 1 つでゲストにチャットが開くのは、意図しない開放になる。
    const c = code(guard);
    assert.ok(
      c.includes("guest: { quotaRequests: 0, quotaTokens: 0, ratePerMin: 0 }"),
      "コンシェルジュのゲスト枠が 0 で固定されていない",
    );
  });

  test("🔴 env で仕様値を超えられない（ログに出すだけにしない）", () => {
    const c = code(guard);
    assert.ok(
      c.includes("cappedQuota([\"AI_OCR_MONTHLY_REQUESTS\"], SPEC_FREE_REQUESTS)"),
      "free の上限が env で増やせる",
    );
    assert.ok(
      c.includes("cappedQuota([\"AI_OCR_PRO_MONTHLY_REQUESTS\"], SPEC_PRO_REQUESTS)"),
      "pro の上限が env で増やせる",
    );
    // 丸めていることを本体でも確かめる。
    assert.ok(c.includes("if (raw > spec)"), "超過を丸めていない");
    assert.ok(c.includes("return spec;"), "仕様値へ丸めていない");
  });

  test("🔴 効いている上限が仕様と違ったら検知する", () => {
    assert.ok(code(guard).includes("export function quotaSpecMismatch"));
    assert.ok(code(route).includes("quotaSpecMismatch()"), "route が検知を呼んでいない");
  });
});

describe("🔴 処理の並び順", () => {
  const c = code(route);
  const at = (needle: string) => {
    const i = c.indexOf(needle);
    assert.ok(i > 0, `${needle} が見つからない`);
    return i;
  };

  test("安価な試行制限が、重いファイル検証より前にある", () => {
    // ここが逆だと、PDF を開かせるだけの解析 DoS が素通りする。
    assert.ok(
      at("tryOcrAttempt(userId, audience)") < at("await validateFile("),
      "試行制限が validateFile より後ろにある",
    );
  });

  test("トークンの実測が、予約より前にある", () => {
    // 予約は見積り額で予算を押さえる。実測が後ろだと押さえる額が間違う。
    assert.ok(
      at("countInputTokens({") < at("beginOcrRequest({"),
      "count_tokens が予約より後ろにある",
    );
  });

  test("予約が、Anthropic の実行より前にある", () => {
    assert.ok(at("beginOcrRequest({") < at("client.messages.create("));
  });

  test("🔴 計測に失敗したら Anthropic を呼ばない（fail-close）", () => {
    const failClose = at("if (!counted.ok)");
    assert.ok(failClose < at("client.messages.create("), "計測の失敗判定が実行より後ろ");
    assert.ok(c.includes('error: "estimate_unavailable"'), "計測失敗を通してしまっている");
    // 見積りへのフォールバックが残っていないこと。
    assert.ok(!c.includes("fallback: inputTokens"), "見積りへのフォールバックが残っている");
  });

  test("🔴 段ごとではなく全体の締切で時間を配る", () => {
    assert.ok(c.includes("countBudget(startedAt"), "計測の予算を取っていない");
    assert.ok(c.includes("callBudget(startedAt"), "呼び出しの予算を取っていない");
    assert.ok(!c.includes("ANTHROPIC_TIMEOUT_MS"), "段ごとの固定タイムアウトが残っている");
  });

  test("🔴 送る前に時間が足りなければ、精算してから諦める", () => {
    assert.ok(c.includes('reason: "no_time_before_send"'));
  });

  test("モデレーションが予約より前で、フェイルクローズ版を使っている", () => {
    assert.ok(at("assertActiveOr403Strict(userId)") < at("beginOcrRequest({"));
  });
});

describe("🔴 精算の結線", () => {
  const c = code(route);

  test("🔴 精算 RPC の false を成功扱いしない", () => {
    const g = code(guard);
    assert.ok(g.includes("if (data === true) return true;"), "true 以外も通している");
    assert.ok(g.includes("readOcrRequestState("), "false のとき状態を見ていない");
    assert.ok(g.includes('if (state === "succeeded") return true;'), "冪等成功の判定が無い");
  });

  test("成功の精算が失敗したら 200 を返さない", () => {
    assert.ok(c.includes("const settled = await settleOcrSuccess("));
    assert.ok(c.includes("if (!settled)"), "精算の結果を見ていない");
    assert.ok(c.includes('error: "settle_failed"'));
  });

  test("送信後の失敗は予算を戻さない（chargeBudget: true）", () => {
    assert.ok(
      c.includes("chargeBudget: true"),
      "送信後の失敗で予算まで戻している（未計上の支出が作れる）",
    );
  });

  test("SDK の自動再試行を切っている", () => {
    assert.ok(c.includes("maxRetries: 0"), "再試行のたびに二重課金される");
  });
});

describe("🔴 DB 側の契約", () => {
  const sql = readFileSync(
    "../../toritavi_app/supabase/ocr_hardening_phase1.sql",
    "utf8",
  );

  test("件数とトークンを同じ UPDATE で確保している", () => {
    assert.ok(sql.includes("tokens_reserved  = toritavi_ocr_usage_monthly.tokens_reserved + p_est_tokens"));
    assert.ok(sql.includes("+ p_est_tokens <= p_limit_tokens"));
  });

  test("予約した期間を行に保存し、精算でそれを使う", () => {
    assert.ok(sql.includes("period_day        date not null"));
    assert.ok(sql.includes("RETURNING est_cost_cents, est_tokens, audience, units, period_day, period_month"));
  });

  test("利用者ごとの試行制限が advisory lock を取っている", () => {
    assert.ok(sql.includes("pg_advisory_xact_lock"));
  });

  test("🔴 全体の試行上限が原子的（別利用者どうしは lock で守れない）", () => {
    // 利用者ごとの lock は鍵が user_id なので、別の利用者とは直列化されない。
    // 全体件数は行ロックの下で足してから見る。
    assert.ok(sql.includes("INSERT INTO toritavi_ocr_rate_buckets"));
    assert.ok(sql.includes("WHERE toritavi_ocr_rate_buckets.hits + 1 <= p_global_per_min"));
  });

  test("🔴 作り直す前に消している（型・既定値は replace で変えられない）", () => {
    for (const sig of [
      "drop function if exists public.toritavi_ocr_try_attempt(uuid, int, int);",
      "drop function if exists public.toritavi_ocr_sweep(int);",
    ]) {
      assert.ok(sql.includes(sig), sig + " が無い");
    }
  });

  test("🔴 2 引数の互換ラッパーを消していない（ロールバックで OCR が止まる）", () => {
    // 途中の版のサーバは try_attempt を 2 引数で呼ぶ。無いと、コードだけ
    // 戻した瞬間に関数が見つからず、フェイルクローズで全要求が 503 になる。
    assert.ok(
      !sql.includes("drop function if exists public.toritavi_ocr_try_attempt(uuid, int);"),
      "互換ラッパーを消している",
    );
    assert.ok(
      sql.includes("create or replace function public.toritavi_ocr_try_attempt(\n  p_user_id uuid,\n  p_per_min int\n) returns boolean"),
      "2 引数の互換ラッパーが無い",
    );
    // ラッパーも全体上限を必ず適用すること（省略が「上限なし」にならない）。
    assert.ok(
      sql.includes("select public.toritavi_ocr_try_attempt(p_user_id, p_per_min, 120);"),
      "ラッパーが全体上限を渡していない",
    );
  });

  test("🔴 計測値を記録する列と引数がある（見積りと実費のずれを測る）", () => {
    for (const needle of [
      "counted_input_tokens  integer",
      "reserved_input_tokens integer",
      "actual_input_tokens   integer",
      "actual_output_tokens  integer",
      "p_counted_input  int default null",
    ]) {
      assert.ok(sql.includes(needle), needle + " が無い");
    }
    const g = readFileSync("src/lib/ai-guard.ts", "utf8");
    assert.ok(g.includes("p_counted_input: args.countedInput"));
    assert.ok(g.includes("p_reserved_input: args.reservedInput"));
  });

  test("🔴 全利用者ぶんの期限切れ掃除と created_at のインデックスがある", () => {
    assert.ok(sql.includes("DELETE FROM toritavi_ocr_events WHERE created_at <"));
    assert.ok(sql.includes("idx_ocr_events_created_at"));
  });

  test("🔴 サーバが全体上限を明示的に渡している", () => {
    const g = readFileSync("src/lib/ai-guard.ts", "utf8");
    assert.ok(g.includes("p_global_per_min: GLOBAL_ATTEMPTS_PER_MIN"));
  });
});
