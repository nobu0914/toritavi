import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { buildOcrRulesPrompt } from "@/lib/ocr-rules";
import { authenticateRequest } from "@/lib/supabase-server";
import { enforceAiLimits, OCR_GUARD } from "@/lib/ai-guard";
import { recordOcrUsage } from "@/lib/ai-usage-record";
import { assertActiveOr403 } from "@/lib/moderation";
import { ALLOWED_ORIGINS } from "@/lib/allowed-origins";

const SYSTEM_PROMPT = `あなたは旅行・予約文書の情報抽出専門家です。
画像から予約情報を読み取り、以下のJSON形式で返してください。

## カテゴリ判定
まず文書の種類を判定してください:
- 飛行機: 搭乗券、航空券、フライト予約
- 列車: 新幹線、特急、鉄道予約
- バス: バス予約、乗車券
- 車: レンタカー予約
- 船: フェリー・客船予約、乗船券
- 宿泊: ホテル、旅館予約
- 観光: チケット・イベント・コンサート・現地ツアー/アクティビティ（入場券・予約バウチャー。観光地巡りそのものは含めない）
- 食事: レストラン予約
- アポ: 会議・商談・打ち合わせ等のアポイント（医療機関の診察・受診予約は本サービスの対象外。診察券・受診予約票等の医療関連書類は「その他」とし、診療科・病名・受診の事実など医療に関する項目は抽出しない）
- その他: 上記に該当しない

## 出力形式（JSONのみ返すこと）

往復予約など1文書に複数予定が含まれる場合はsteps配列に複数要素を返す。
通常は1要素。

{
  "steps": [
    {
      "category": "飛行機|列車|バス|車|船|宿泊|観光|食事|アポ|その他",
      "fixed": {
        "title": "タイトル（便名/列車名/施設名等）",
        "date": "開始日（YYYY-MM-DD）",
        "endDate": "終了日（YYYY-MM-DD、宿泊checkout・複数日イベント等。同日ならnull）",
        "startTime": "開始時刻（HH:MM）",
        "endTime": "終了時刻（HH:MM）",
        "from": "出発地・場所",
        "to": "到着地",
        "airline": "運行航空会社（飛行機のみ。コードシェア便は実運航キャリア名。例: ANA便名 NZ90 で Air New Zealand 運航表記あり → 'Air New Zealand'。明記なし・非飛行機はnull）",
        "confNumber": "確認番号",
        "timezone": "タイムゾーン略称（国際線のみ。国内はnull）"
      },
      "variable": [
        { "label": "項目名（日本語）", "value": "値" }
      ],
      "inferred": ["推定したフィールド名をリストで返す。確実に読み取れた値は含めない"],
      "needsReview": true
    }
  ]
}

## inferred/needsReviewルール
- inferred: 文書に明記されておらず文脈から推定した値のフィールド名を配列で返す
  - 例: タイムゾーンを空港コードから推定 → ["timezone"]
  - 例: 到着日を出発日+所要時間から推定 → ["endDate"]
  - 確実に読み取れた項目は含めない
- needsReview: 以下のいずれかに該当する場合 true
  - 必須項目（title, date/startTime）が読み取れない
  - 飛行機/列車/バス/車/船で出発地または到着地が不明
  - 宿泊でチェックアウト日が不明
  - 確認番号が見つからない
  - 推定値が2つ以上ある

${buildOcrRulesPrompt()}

## 最終規則
- 読み取れない固定項目はnullを返す（推測しない）
- JSONのみ返す（説明文不要）
`;

// Anthropic pricing for claude-sonnet-4-6 (vision):
//   input  $3 / Mtok, output $15 / Mtok → 300/1500 cents per Mtok.
const SONNET_INPUT_CENTS_PER_MTOK = 300;
const SONNET_OUTPUT_CENTS_PER_MTOK = 1500;
// レート/コストの上限は @/lib/ai-guard (OCR_GUARD) に統一・env 化。

// 1 リクエストの入力上限（コスト/DoS ガード）。日次/月次ガードは「前回までの状態」を
// 見るため、単発の巨大リクエストはここで bound する必要がある。
export const maxDuration = 60; // 関数の最大実行秒数
const MAX_IMAGES = 10;
const MAX_IMAGE_CHARS = 14_000_000; // data URL 文字長 ≈ base64。約 10MB 原本相当。
const MAX_TOTAL_CHARS = 28_000_000; // 1 リクエスト合計。

export async function POST(request: NextRequest) {
  // Reject cross-site callers. Origin is absent on same-origin requests from our UI
  // but present on any browser-initiated cross-site call. Skip when absent.
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Require an authenticated user. Origin can be forged by non-browser clients
  // (curl / fetch with any header), so without this check an attacker could
  // drive Anthropic spend unbounded.
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { sb, userId } = auth;

  // --- モデレーション: 停止/凍結ユーザーは 403（フェイルオープン）---
  const suspended = await assertActiveOr403(sb, userId);
  if (suspended) return suspended;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  // --- AI 利用制限（月予算 → 日次 → 分間。@/lib/ai-guard で OCR/コンシェルジュ共通）---
  const blocked = await enforceAiLimits(sb, userId, OCR_GUARD);
  if (blocked) return blocked;

  try {
    const { images } = (await request.json()) as { images: string[] };

    if (!Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 });
    }
    if (images.length > MAX_IMAGES) {
      return NextResponse.json(
        { error: "too_many_images", message: `画像は一度に最大 ${MAX_IMAGES} 枚までです。` },
        { status: 413 },
      );
    }
    let totalChars = 0;
    for (const img of images) {
      const len = typeof img === "string" ? img.length : 0;
      totalChars += len;
      if (len === 0 || len > MAX_IMAGE_CHARS || totalChars > MAX_TOTAL_CHARS) {
        return NextResponse.json(
          { error: "payload_too_large", message: "画像が大きすぎます。圧縮してお試しください。" },
          { status: 413 },
        );
      }
    }

    const client = new Anthropic({ apiKey });

    const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [];

    for (const img of images) {
      const imgMatch = img.match(/^data:(image\/\w+);base64,(.+)$/);
      if (imgMatch) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: imgMatch[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: imgMatch[2],
          },
        });
        continue;
      }
      // PDF（eチケット等）は document ブロックで渡す（Claude はネイティブに読める）。
      const pdfMatch = img.match(/^data:application\/pdf;base64,(.+)$/);
      if (pdfMatch) {
        content.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: pdfMatch[1],
          },
        });
      }
    }

    content.push({ type: "text", text: "この文書から予約情報を抽出してください。" });

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });

    // --- Count usage / cost (best-effort: failures here don't fail the request) ---
    const tokensIn = response.usage?.input_tokens ?? 0;
    const tokensOut = response.usage?.output_tokens ?? 0;
    const costCents = Math.ceil(
      (tokensIn * SONNET_INPUT_CENTS_PER_MTOK + tokensOut * SONNET_OUTPUT_CENTS_PER_MTOK) / 1_000_000
    );
    // 記録は service_role 専用 RPC 経由（利用者が PostgREST から直接叩いて
    // 共有予算を焼き切れないようにするため）。best-effort は従来どおり。
    await recordOcrUsage({ userId, tokensIn, tokensOut, costCents });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock?.type === "text" ? textBlock.text : "";
    // 抽出結果は予約 PII（氏名/便名/確認番号）を含むため本文はログに出さない。
    console.log("[OCR] parsed response chars:", raw.length);

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[OCR] JSON parse failed (chars:", raw.length, ")");
      return NextResponse.json({ error: "Failed to parse response" }, { status: 500 });
    }

    const result = JSON.parse(jsonMatch[0]);

    // 旧形式（single step）との互換: stepsがなければ旧形式をラップ
    if (!result.steps && result.category) {
      return NextResponse.json({
        steps: [{
          category: result.category,
          fixed: result.fixed || result.fields || {},
          variable: result.variable || [],
        }],
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
