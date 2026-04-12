/**
 * OCR処理ルール定義
 *
 * AI OCR（Claude API）が文書から情報を抽出する際の
 * 判定ルール・変換ルール・分割ルールを定義する。
 * このファイルの内容はAPIプロンプトに反映される。
 */

/* ====== 日付・時刻ルール ====== */

export const DATE_RULES = {
  // 日付フォーマット
  format: "YYYY-MM-DD",

  // 開始日(date)と終了日(endDate)の使い分け
  split: {
    宿泊: "チェックイン日をdate、チェックアウト日をendDateに分離する",
    飛行機: "出発日をdate。到着が翌日の場合はendDateに到着日を入れる",
    列車: "乗車日をdate。日をまたぐ夜行の場合はendDateに到着日を入れる",
    商談: "開始日をdate。複数日にまたがる場合はendDateに最終日を入れる",
    観光: "イベント開始日をdate。フェス等の複数日はendDateに最終日を入れる",
    病院: "受診日をdate。入院の場合はendDateに退院日を入れる",
  },

  // 相対日付の変換
  relative: "「明日」「来週月曜」等の相対表現は変換せずそのまま返す。確定日付のみYYYY-MM-DDにする",
} as const;

export const TIME_RULES = {
  // 時刻フォーマット
  format: "HH:MM（24時間制）",

  // AM/PM変換
  ampm: "AM/PMは24時間制に変換する（例: 2:30PM → 14:30）",

  // タイムゾーン
  timezone: {
    rule: "国際線・海外予約の場合、出発地と到着地それぞれの現地時間で返す",
    field: "timezoneフィールドに出発地のタイムゾーン略称を入れる（例: JST, CET, EST）",
    arrival: "到着時刻のタイムゾーンが異なる場合、endTimezoneとして変動項目に入れる",
    domestic: "国内の場合はtimezoneは省略する（JSTが前提）",
  },
} as const;

/* ====== 文書分割ルール ====== */

export const SPLIT_RULES = {
  // 1枚の文書から複数Stepを生成するケース
  roundTrip: {
    rule: "往復の予約書類は行きと帰りを別々のStepとして返す",
    output: "stepsを配列で返す（通常は1要素、往復時は2要素）",
    examples: [
      "往復航空券 → 行きフライト + 帰りフライト",
      "往復新幹線 → 行き列車 + 帰り列車",
    ],
  },

  // 分割しないケース
  noSplit: [
    "宿泊（IN/OUTは1つのStepのdate/endDateで管理）",
    "複数日イベント（date/endDateで管理）",
    "乗り継ぎ便（経由地は変動項目に記載、Step自体は1つ）",
  ],
} as const;

/* ====== カテゴリ判定の優先ルール ====== */

export const CATEGORY_RULES = {
  priority: [
    "文書内に複数カテゴリの情報がある場合、主題となるカテゴリを選ぶ",
    "ホテル付きツアーパック → 最初の移動手段（飛行機/列車）をカテゴリとし、宿泊情報は変動項目に入れる",
    "レンタカー付き宿泊 → 宿泊をカテゴリとし、レンタカー情報は変動項目に入れる",
  ],
} as const;

/* ====== 変動項目の抽出ルール ====== */

export const VARIABLE_RULES = {
  // 優先度順に抽出
  priorityOrder: [
    "座席・号車（座席指定がある場合）",
    "ゲート（空港の場合）",
    "部屋タイプ（宿泊の場合）",
    "人数",
    "料金・合計金額",
    "予約者名",
    "乗り継ぎ情報",
    "到着地タイムゾーン（国際線の場合）",
    "食事・プラン情報",
    "キャンセルポリシー",
    "緊急連絡先",
    "備考・特記事項",
  ],

  maxItems: 10,

  // 除外項目（固定項目と重複するもの）
  exclude: [
    "タイトルと同じ情報",
    "日付と同じ情報",
    "開始/終了時刻と同じ情報",
    "出発地/到着地と同じ情報",
    "確認番号と同じ情報",
  ],
} as const;

/* ====== プロンプト生成 ====== */

/**
 * OCRルールをAIプロンプト用テキストに変換する
 */
export function buildOcrRulesPrompt(): string {
  return `
## 日付ルール
- 日付は${DATE_RULES.format}形式で返す
- ${DATE_RULES.relative}
- カテゴリ別のdate/endDate使い分け:
${Object.entries(DATE_RULES.split).map(([k, v]) => `  - ${k}: ${v}`).join("\n")}

## 時刻ルール
- 時刻は${TIME_RULES.format}で返す
- ${TIME_RULES.ampm}
- ${TIME_RULES.timezone.rule}
- ${TIME_RULES.timezone.field}
- ${TIME_RULES.timezone.arrival}
- ${TIME_RULES.timezone.domestic}

## 文書分割ルール
- ${SPLIT_RULES.roundTrip.rule}
- ${SPLIT_RULES.roundTrip.output}
- 分割する例: ${SPLIT_RULES.roundTrip.examples.join("、")}
- 分割しない: ${SPLIT_RULES.noSplit.join("、")}

## カテゴリ判定
${CATEGORY_RULES.priority.map((r) => `- ${r}`).join("\n")}

## 変動項目
- 優先度順: ${VARIABLE_RULES.priorityOrder.join(" > ")}
- 最大${VARIABLE_RULES.maxItems}件
- 固定項目と重複する情報は含めない
`.trim();
}
