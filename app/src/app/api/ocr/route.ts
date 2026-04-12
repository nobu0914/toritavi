import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { buildOcrRulesPrompt } from "@/lib/ocr-rules";

const SYSTEM_PROMPT = `あなたは旅行・予約文書の情報抽出専門家です。
画像から予約情報を読み取り、以下のJSON形式で返してください。

## カテゴリ判定
まず文書の種類を判定してください:
- 飛行機: 搭乗券、航空券、フライト予約
- 列車: 新幹線、特急、鉄道予約
- 宿泊: ホテル、旅館予約
- 病院: 診察予約、受診案内
- 商談: 会議案内、ビジネスアポイント
- 食事: レストラン予約
- バス: バス予約、乗車券
- 観光: チケット、イベント、コンサート
- その他: 上記に該当しない

## 出力形式（JSONのみ返すこと）

往復予約など1文書に複数予定が含まれる場合はsteps配列に複数要素を返す。
通常は1要素。

{
  "steps": [
    {
      "category": "飛行機|列車|宿泊|病院|商談|食事|バス|観光|その他",
      "fixed": {
        "title": "タイトル（便名/列車名/施設名等）",
        "date": "開始日（YYYY-MM-DD）",
        "endDate": "終了日（YYYY-MM-DD、宿泊checkout・複数日イベント等。同日ならnull）",
        "startTime": "開始時刻（HH:MM）",
        "endTime": "終了時刻（HH:MM）",
        "from": "出発地・場所",
        "to": "到着地",
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
  - 飛行機/列車/バスで出発地または到着地が不明
  - 宿泊でチェックアウト日が不明
  - 確認番号が見つからない
  - 推定値が2つ以上ある

${buildOcrRulesPrompt()}

## 最終規則
- 読み取れない固定項目はnullを返す（推測しない）
- JSONのみ返す（説明文不要）
`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  try {
    const { images } = await request.json() as { images: string[] };

    if (!images || images.length === 0) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 });
    }

    const client = new Anthropic({ apiKey });

    const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [];

    for (const img of images) {
      const match = img.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) continue;
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: match[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: match[2],
        },
      });
    }

    content.push({ type: "text", text: "この文書から予約情報を抽出してください。" });

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock?.type === "text" ? textBlock.text : "";

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "Failed to parse response", raw }, { status: 500 });
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
