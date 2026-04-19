/*
 * POST /api/concierge — AI Concierge のメッセージ送信エンドポイント。
 *
 * - 認証必須（auth.uid() ベース）
 * - 3 階層キャップ（分 / 日 / 月予算）
 * - Journey context を PII マスクして system prompt に注入
 * - Claude Haiku 4.5 呼び出し、tool_use: add_step 提案
 * - user / assistant メッセージを DB 保存
 * - usage インクリメント（RPC）
 *
 * DS v2 §15 参照
 */

import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { buildConciergeContext } from "@/lib/concierge-context";
import type { Journey, Step } from "@/lib/types";

const ALLOWED_ORIGINS = new Set([
  "https://toritavi.com",
  "https://app-lime-seven-80.vercel.app",
  "http://localhost:3000",
]);

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;

// 流量上限（DS v2 §15.6）
const RATE_LIMIT_PER_MIN = 5;
const DAILY_REQUEST_LIMIT = 100;
const DAILY_TOKEN_LIMIT = 200_000;
const MONTHLY_BUDGET_CENTS = Number(process.env.CONCIERGE_BUDGET_MONTHLY_CENTS ?? 5000); // $50

// Haiku 4.5 の 2026-04 時点概算: $1 / Mtok in, $5 / Mtok out
function estimateCostCents(tokensIn: number, tokensOut: number): number {
  const inCents = (tokensIn / 1_000_000) * 100;   // $1 = 100 cents
  const outCents = (tokensOut / 1_000_000) * 500; // $5 = 500 cents
  return Math.ceil(inCents + outCents);
}

const SYSTEM_PROMPT_BASE = `あなたは toritavi の旅程アシスタント「コンシェルジュ」です。
ユーザーが登録している Journey / Step データを参照し、抜けチェック / 要約 / 当日動線の助言を返してください。

## 回答スタイル
- 日本語、簡潔、モバイル画面で読みやすい長さに
- Markdown 装飾は最小限（太字のみ可）。箇条書きは短文で
- 時刻は 24 時間制、日付は YYYY-MM-DD で参照
- 確信がない数値や所要時間は「目安」と明示
- 旅程データに含まれない情報（特定のレストラン名など）は推測で答えず、検索案内に留める

## 提案機能 (tool_use)
新しい予定を Journey に追加することを提案できる場合は、以下のツールを呼んでください:
- add_step: 既存 Journey に 1 Step 追加

ツールを呼ぶ際は content に短い日本語の説明（1 文）も添えて、ユーザーが確認しやすい形にする。

## PII 規則
- 確認番号やマイレージ番号はマスクされた状態で届きます。全桁を知っている前提で答えない
- メール / 決済情報は送信されていません。必要なら「お手元の控えで確認してください」と案内
`;

type ToolUse = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

type AssistantPayload = {
  content: string;
  toolUse?: ToolUse;
  tokensIn: number;
  tokensOut: number;
};

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  const sb = await createClient();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = userData.user.id;

  type Body = {
    threadId?: string;
    text: string;
    contextJourneyIds?: string[];
  };
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  if (text.length > 2000) return NextResponse.json({ error: "text too long" }, { status: 400 });

  /* ---- 1) Monthly budget check (global) ---- */
  const { data: budget } = await sb
    .from("toritavi_concierge_budget")
    .select("spend_cents")
    .eq("month", firstOfThisMonth())
    .maybeSingle();
  if (budget && budget.spend_cents >= MONTHLY_BUDGET_CENTS) {
    return NextResponse.json({
      error: "monthly_budget_exceeded",
      message: "コンシェルジュを一時停止中です。今月の想定利用量を超えたため翌月 1 日に再開します。",
    }, { status: 503 });
  }

  /* ---- 2) Daily limit (per user) ---- */
  const today = new Date().toISOString().slice(0, 10);
  const { data: usage } = await sb
    .from("toritavi_concierge_usage")
    .select("requests_count, tokens_total")
    .eq("user_id", userId)
    .eq("day", today)
    .maybeSingle();
  if (usage) {
    if (usage.requests_count >= DAILY_REQUEST_LIMIT) {
      return NextResponse.json({
        error: "daily_request_limit",
        message: "本日の利用上限に達しました。翌日 0:00 にリセットされます。",
      }, { status: 429 });
    }
    if (usage.tokens_total >= DAILY_TOKEN_LIMIT) {
      return NextResponse.json({
        error: "daily_token_limit",
        message: "本日の使用量が上限に達しました。翌日 0:00 にリセットされます。",
      }, { status: 429 });
    }
  }

  /* ---- 3) Per-minute rate limit (count recent messages) ---- */
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count: recentCount } = await sb
    .from("toritavi_concierge_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("role", "user")
    .gte("created_at", since);
  if ((recentCount ?? 0) >= RATE_LIMIT_PER_MIN) {
    return NextResponse.json({
      error: "rate_limit",
      message: "少しお待ちください。短時間に送信が多すぎます（1 分あたり 5 回まで）。",
    }, { status: 429 });
  }

  /* ---- 4) Ensure thread ---- */
  let threadId = body.threadId;
  if (!threadId) {
    const { data: created, error: thrErr } = await sb
      .from("toritavi_concierge_threads")
      .insert({
        user_id: userId,
        title: text.slice(0, 40),
        context_journey_ids: body.contextJourneyIds ?? [],
      })
      .select("id")
      .single();
    if (thrErr || !created) {
      return NextResponse.json({ error: "failed to create thread" }, { status: 500 });
    }
    threadId = created.id;
  }

  /* ---- 5) Collect Journey context (own data, RLS scoped) ---- */
  const { data: journeyRows } = await sb
    .from("toritavi_journeys")
    .select(`*, toritavi_steps(*)`)
    .order("updated_at", { ascending: false })
    .limit(10);
  const journeys: Journey[] = (journeyRows ?? []).map(rowToJourney);
  const context = buildConciergeContext({
    allJourneys: journeys,
    contextJourneyIds: body.contextJourneyIds,
  });

  /* ---- 6) Save user message ---- */
  await sb.from("toritavi_concierge_messages").insert({
    thread_id: threadId,
    user_id: userId,
    role: "user",
    content: text,
  });

  /* ---- 7) Build Anthropic request ---- */
  const client = new Anthropic({ apiKey });

  // 同スレッドの直近 20 件を履歴として注入
  const { data: history } = await sb
    .from("toritavi_concierge_messages")
    .select("role, content, tool_use, tool_result")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(20);

  const messages = buildAnthropicMessages(history ?? []);

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT_BASE + "\n" + context.promptBlock,
      tools: [ADD_STEP_TOOL],
      messages,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[concierge] Anthropic error:", msg);
    return NextResponse.json({ error: "ai_error", message: msg }, { status: 502 });
  }

  /* ---- 8) Extract text + tool_use ---- */
  const assistant = extractAssistantPayload(response);

  /* ---- 9) Save assistant message ---- */
  await sb.from("toritavi_concierge_messages").insert({
    thread_id: threadId,
    user_id: userId,
    role: "assistant",
    content: assistant.content,
    tool_use: assistant.toolUse ?? null,
    tokens_in: assistant.tokensIn,
    tokens_out: assistant.tokensOut,
  });

  /* ---- 10) Increment usage ---- */
  const cost = estimateCostCents(assistant.tokensIn, assistant.tokensOut);
  await sb.rpc("increment_concierge_usage", {
    p_tokens_in: assistant.tokensIn,
    p_tokens_out: assistant.tokensOut,
    p_cost_cents: cost,
  });

  /* ---- 11) Bump thread updated_at ---- */
  await sb
    .from("toritavi_concierge_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", threadId);

  return NextResponse.json({
    threadId,
    assistant: {
      content: assistant.content,
      toolUse: assistant.toolUse ?? null,
    },
    includedJourneyIds: context.includedJourneyIds,
  });
}

/* ====== Claude tool 定義 ====== */

const ADD_STEP_TOOL: Anthropic.Tool = {
  name: "add_step",
  description: "既存の Journey に新しい Step（予定）を追加する提案を出します。実行はユーザー確認後。",
  input_schema: {
    type: "object",
    properties: {
      journey_id: { type: "string", description: "対象 Journey の ID" },
      category: {
        type: "string",
        enum: ["飛行機", "列車", "バス", "宿泊", "商談", "食事", "観光", "病院", "その他"],
      },
      title: { type: "string", description: "Step タイトル（便名 / 会場名 / 店名 等）" },
      date: { type: "string", description: "開始日 YYYY-MM-DD（不明なら省略）" },
      time: { type: "string", description: "開始時刻 HH:MM（不明なら省略）" },
      endTime: { type: "string", description: "終了時刻 HH:MM（不明なら省略）" },
      from: { type: "string", description: "出発地・場所（任意）" },
      to: { type: "string", description: "到着地（任意）" },
      reason: { type: "string", description: "なぜこの予定を提案したかの簡潔な理由（1 文）" },
    },
    required: ["journey_id", "category", "title", "reason"],
  },
};

/* ====== Helpers ====== */

function firstOfThisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToJourney(row: any): Journey {
  return {
    id: row.id,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    memo: row.memo ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    steps: ((row.toritavi_steps as any[]) ?? [])
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map(rowToStep),
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToStep(row: any): Step {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    date: row.date ?? undefined,
    endDate: row.end_date ?? undefined,
    time: row.time ?? "",
    endTime: row.end_time ?? undefined,
    from: row.from ?? undefined,
    to: row.to ?? undefined,
    airline: row.airline ?? undefined,
    detail: row.detail ?? undefined,
    confNumber: row.conf_number ?? undefined,
    memo: row.memo ?? undefined,
    source: row.source ?? undefined,
    timezone: row.timezone ?? undefined,
    status: row.status ?? "未開始",
    inferred: row.inferred ?? undefined,
    needsReview: row.needs_review ?? undefined,
    information: row.information ?? [],
  };
}

type MessageRow = {
  role: string;
  content: string | null;
  tool_use: Record<string, unknown> | null;
  tool_result: Record<string, unknown> | null;
};

function buildAnthropicMessages(history: MessageRow[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of history) {
    if (m.role === "user" && m.content) {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      if (m.tool_use) {
        const tu = m.tool_use as { id?: string; name?: string; input?: Record<string, unknown> };
        if (tu.id && tu.name) {
          blocks.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input ?? {} });
        }
      }
      if (blocks.length > 0) out.push({ role: "assistant", content: blocks });
    }
  }
  return out;
}

function extractAssistantPayload(res: Anthropic.Message): AssistantPayload {
  let text = "";
  let tool: ToolUse | undefined;
  for (const block of res.content) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use") {
      tool = { id: block.id, name: block.name, input: block.input as Record<string, unknown> };
    }
  }
  return {
    content: text.trim(),
    toolUse: tool,
    tokensIn: res.usage?.input_tokens ?? 0,
    tokensOut: res.usage?.output_tokens ?? 0,
  };
}
