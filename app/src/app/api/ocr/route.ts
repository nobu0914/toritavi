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
  "fields": {
    // カテゴリに応じたフィールドを返す（以下参照）
  }
}

### 飛行機
{ "flightNo": "便名", "departure": "出発空港コード", "departureTime": "出発時刻HH:MM", "arrival": "到着空港コード", "arrivalTime": "到着時刻HH:MM", "gate": "ゲート", "seat": "座席", "confNumber": "確認番号" }

### 列車
{ "trainName": "列車名と号数", "fromStation": "乗車駅", "departureTime": "発車時刻HH:MM", "toStation": "降車駅", "arrivalTime": "到着時刻HH:MM", "car": "号車", "seat": "座席", "confNumber": "確認番号" }

### 宿泊
{ "hotelName": "施設名", "checkin": "チェックイン時刻HH:MM", "checkout": "チェックアウト時刻HH:MM", "roomType": "部屋タイプ", "confNumber": "確認番号" }

### 病院
{ "hospitalName": "病院名", "department": "診療科", "date": "予約日", "time": "予約時刻HH:MM", "cardNo": "診察券番号" }

### 商談
{ "company": "相手先", "location": "場所", "startTime": "開始時刻HH:MM", "endTime": "終了時刻HH:MM", "confNumber": "確認番号" }

### 食事
{ "shopName": "店名", "time": "予約時刻HH:MM", "guests": "人数", "confNumber": "確認番号" }

### バス
{ "routeName": "路線名", "departureTime": "発車時刻HH:MM", "arrivalTime": "到着時刻HH:MM", "confNumber": "確認番号" }

### 観光
{ "eventName": "イベント名", "venue": "会場", "date": "日付", "time": "開演時刻HH:MM", "seat": "座席", "confNumber": "確認番号" }

### その他
{ "title": "タイトル", "time": "時刻HH:MM", "detail": "詳細", "confNumber": "確認番号" }

## 規則
- 読み取れない項目はnullを返す（推測しない）
- JSONのみ返す（説明文不要）
- 時刻はHH:MM形式で統一
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
      // img is base64 data URL like "data:image/png;base64,..."
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

    // Extract JSON from response
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
