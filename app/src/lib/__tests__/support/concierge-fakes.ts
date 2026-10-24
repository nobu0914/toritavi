/**
 * `/api/concierge` を本文の保存・AI 呼び出し・後片づけまで動かすための偽物一式。
 *
 * 認証・DB・Anthropic（global fetch）を差し替える。**ルート本体・予約・
 * 文脈の組み立て・SDK は本物が動く。** 門（`gate`）を渡すと、その読み書きで
 * 止めておける —— 「止めている間に何が始まったか」で並列かどうかを見る。
 */
import { fakeDb, hasOp, type DbCall } from "./fake-db.ts";

export const CONCIERGE_UID = "77777777-7777-4777-8777-777777777777";
export const CONCIERGE_THREAD = "88888888-8888-4888-8888-888888888888";

type Wait = () => Promise<void>;

export type ConciergeFakeOpts = {
  /** 履歴の読み取り（AI を呼ぶ直前の DB）で止める。 */
  holdHistory?: Wait;
  /** 答えのあとの 3 つの書き込みで止める。 */
  holdAfterWrites?: Wait;
  /** 使用量の計上（RPC）だけで止める。 */
  holdUsage?: Wait;
  /** 使用量の計上（RPC）を、最初の n 回だけ失敗させる（`Infinity` で常に）。 */
  failUsage?: number;
};

/** 答えのあとの書き込みか（アシスタントの発言・使用量・スレッドの更新）。 */
export function isAfterAnswerWrite(call: DbCall): boolean {
  if (call.kind === "rpc") return call.fn === "increment_concierge_usage_srv";
  if (call.table === "toritavi_concierge_threads" && hasOp(call, "update")) return true;
  if (call.table === "toritavi_concierge_messages" && hasOp(call, "insert")) {
    const row = call.ops.find((o) => o.op === "insert")?.args[0] as { role?: string } | undefined;
    return row?.role === "assistant";
  }
  return false;
}

export function setupConcierge(opts: ConciergeFakeOpts = {}) {
  let usageCalls = 0;
  const db = fakeDb(async (call: DbCall) => {
    if (call.kind === "rpc") {
      if (call.fn === "toritavi_concierge_begin") {
        return { data: [{ status: "ok", used_after: 1 }], error: null };
      }
      if (call.fn === "increment_concierge_usage_srv") {
        if (opts.holdUsage) await opts.holdUsage();
        if (opts.holdAfterWrites) await opts.holdAfterWrites();
        usageCalls += 1;
        if (usageCalls <= (opts.failUsage ?? 0)) {
          return { data: null, error: { message: "usage rpc unavailable (test)" } };
        }
        return { data: null, error: null };
      }
      return { data: null, error: null }; // release ほか
    }
    if (isAfterAnswerWrite(call) && opts.holdAfterWrites) await opts.holdAfterWrites();
    switch (call.table) {
      case "toritavi_consent_records":
        return { data: [], error: null };
      case "toritavi_user_plan":
        return { data: { plan: "free" }, error: null };
      case "toritavi_journeys":
        return { data: [], error: null };
      case "toritavi_concierge_messages":
        if (hasOp(call, "insert")) return { data: null, error: null };
        if (opts.holdHistory) await opts.holdHistory();
        return { data: [{ role: "user", content: "明日の予定は？" }], error: null };
      default:
        return { data: null, error: null };
    }
  });
  const g = globalThis as Record<string, unknown>;
  g.__toritaviTestAdmin = db.client;
  g.__toritaviTestAuth = () => ({
    sb: db.client,
    userId: CONCIERGE_UID,
    isAnonymous: false,
    userMetadata: {},
  });
  return db;
}

/** 予約を戻した回数。 */
export function releases(calls: DbCall[]): number {
  return calls.filter((c) => c.kind === "rpc" && c.fn === "toritavi_concierge_release").length;
}

/** Messages API の正常な応答。 */
export function anthropicOk(text = "明日は 9:00 の便です。"): Response {
  return new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5-20251001",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    { status: 200, headers: { "content-type": "application/json", "request-id": "req_test" } },
  );
}

export function conciergeBody(): string {
  return JSON.stringify({ text: "明日の予定は？", threadId: CONCIERGE_THREAD });
}
