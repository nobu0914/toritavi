import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

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
{
  "category": "飛行機|列車|宿泊|病院|商談|食事|バス|観光|その他",
  "fixed": {
    // カテゴリに応じた基本固定項目（以下参照）
  },
  "variable": [
    // 文書から読み取れた追加の重要情報（固定項目以外）
    { "label": "項目名（日本語）", "value": "値" }
  ]
}

## 固定項目（カテゴリごと）

### 飛行機
{ "title": "便名（例: NH225）", "date": "出発日（YYYY-MM-DD）", "startTime": "出発時刻（HH:MM）", "endTime": "到着時刻（HH:MM）", "from": "出発地（空港コードまたは空港名）", "to": "到着地（空港コードまたは空港名）", "confNumber": "確認番号" }

### 列車
{ "title": "列車名（例: のぞみ225号）", "date": "乗車日（YYYY-MM-DD）", "startTime": "発車時刻（HH:MM）", "endTime": "到着時刻（HH:MM）", "from": "乗車駅", "to": "降車駅", "confNumber": "確認番号" }

### 宿泊
{ "title": "施設名", "date": "チェックイン日（YYYY-MM-DD）", "startTime": "チェックイン時刻（HH:MM）", "endTime": "チェックアウト時刻（HH:MM）", "confNumber": "確認番号" }

### 病院
{ "title": "病院名", "date": "予約日（YYYY-MM-DD）", "startTime": "予約時刻（HH:MM）", "confNumber": "診察券番号" }

### 商談
{ "title": "相手先・件名", "date": "日付（YYYY-MM-DD）", "startTime": "開始時刻（HH:MM）", "endTime": "終了時刻（HH:MM）", "from": "場所", "confNumber": "確認番号" }

### 食事
{ "title": "店名", "date": "予約日（YYYY-MM-DD）", "startTime": "予約時刻（HH:MM）", "confNumber": "確認番号" }

### バス
{ "title": "路線名", "date": "乗車日（YYYY-MM-DD）", "startTime": "発車時刻（HH:MM）", "endTime": "到着時刻（HH:MM）", "from": "出発地", "to": "到着地", "confNumber": "確認番号" }

### 観光
{ "title": "イベント名", "date": "日付（YYYY-MM-DD）", "startTime": "開演時刻（HH:MM）", "from": "会場", "confNumber": "確認番号" }

### その他
{ "title": "タイトル", "date": "日付（YYYY-MM-DD）", "startTime": "時刻（HH:MM）", "confNumber": "確認番号" }

## 変動項目（variable）のルール
- 固定項目以外で、文書に記載されている重要な情報を抽出する
- 例: 座席、ゲート、号車、部屋タイプ、人数、診療科、料金、備考など
- labelは日本語で、ユーザーにわかりやすい表記にする
- 最大10件まで。重要度の高い順に並べる
- 値が空やnullの項目は含めない

## 規則
- 読み取れない固定項目はnullを返す（推測しない）
- JSONのみ返す（説明文不要）
- 時刻はHH:MM形式、日付はYYYY-MM-DD形式で統一
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
      max_tokens: 2048,
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
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
