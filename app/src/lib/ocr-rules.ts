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
  format: "HH:MM（24時間制）",
  ampm: "AM/PMは24時間制に変換する（例: 2:30PM → 14:30）",

  timezone: {
    rule: "国際線・海外予約の場合、出発地と到着地それぞれの現地時間で返す",
    field: "timezoneフィールドに出発地のタイムゾーン略称を入れる（例: JST, CET, EST）",
    arrival: "到着時刻のタイムゾーンが異なる場合、endTimezoneとして変動項目に入れる",
    domestic: "国内の場合はtimezoneは省略する（JSTが前提）",
  },

  // UI表示ルール
  display: {
    primary: "「現地時間」「日本時間」をラベルとして使う",
    noAbbreviation: "JST/CET等の略称だけでは表示しない。補助情報として小さく添える",
    domestic: "国内予定はタイムゾーン表示不要。時刻のみ表示",
    international: "国際線は現地時間を主表示。必要に応じ日本時間を併記",
    nextDay: "+1 や翌日がある場合は必ず明示する",
  },
} as const;

/* ====== 時刻表示ヘルパー（UI用） ====== */

/**
 * 国際線かどうかを判定する
 */
export function isInternational(timezone?: string): boolean {
  if (!timezone) return false;
  const tz = timezone.toUpperCase().trim();
  return tz !== "" && tz !== "JST" && tz !== "Asia/Tokyo";
}

/**
 * 時刻を表示用にフォーマットする
 * @param time HH:MM
 * @param timezone タイムゾーン略称（国際線のみ）
 * @param isArrival 到着時刻か
 * @param crossDay 翌日到着か
 */
export function formatTimeDisplay(
  time: string,
  options?: {
    timezone?: string;
    crossDay?: boolean;
    compact?: boolean; // カード等のスペースが狭い場合
  },
): string {
  if (!time) return "";
  const { timezone, crossDay, compact } = options || {};

  if (!isInternational(timezone)) {
    // 国内: 時刻のみ
    return time;
  }

  // 国際線
  if (compact) {
    return crossDay ? `${time} 現地 +1` : `${time} 現地`;
  }
  return crossDay ? `${time}（現地時間・翌日）` : `${time}（現地時間）`;
}

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

/* ====== カテゴリ別固定項目定義（UI共有） ====== */

export type FixedFieldDef = {
  key: string;
  label: string;
  placeholder: string;
};

export const CATEGORY_FIXED_FIELDS: Record<string, FixedFieldDef[]> = {
  飛行機: [
    { key: "title", label: "便名", placeholder: "NH225" },
    { key: "date", label: "出発日", placeholder: "2026-04-15" },
    { key: "startTime", label: "出発時刻", placeholder: "10:00" },
    { key: "endDate", label: "到着日", placeholder: "2026-04-15" },
    { key: "endTime", label: "到着時刻", placeholder: "12:00" },
    { key: "from", label: "出発地", placeholder: "NRT" },
    { key: "to", label: "到着地", placeholder: "KIX" },
    { key: "timezone", label: "タイムゾーン", placeholder: "JST（国内は省略可）" },
    { key: "confNumber", label: "確認番号", placeholder: "ANA-882541" },
  ],
  列車: [
    { key: "title", label: "列車名", placeholder: "のぞみ 225号" },
    { key: "date", label: "乗車日", placeholder: "2026-04-15" },
    { key: "startTime", label: "出発時刻", placeholder: "10:00" },
    { key: "endTime", label: "到着時刻", placeholder: "12:30" },
    { key: "from", label: "出発駅", placeholder: "東京" },
    { key: "to", label: "到着駅", placeholder: "新大阪" },
    { key: "confNumber", label: "確認番号", placeholder: "TK-882541" },
  ],
  宿泊: [
    { key: "title", label: "施設名", placeholder: "ホテル大阪ベイ" },
    { key: "date", label: "チェックイン日", placeholder: "2026-04-15" },
    { key: "startTime", label: "チェックイン時刻", placeholder: "15:00" },
    { key: "endDate", label: "チェックアウト日", placeholder: "2026-04-17" },
    { key: "endTime", label: "チェックアウト時刻", placeholder: "11:00" },
    { key: "confNumber", label: "確認番号", placeholder: "HB-394021" },
  ],
  バス: [
    { key: "title", label: "路線名", placeholder: "関西空港交通バス" },
    { key: "date", label: "乗車日", placeholder: "2026-04-15" },
    { key: "startTime", label: "出発時刻", placeholder: "7:30" },
    { key: "endTime", label: "到着時刻", placeholder: "8:45" },
    { key: "from", label: "出発地", placeholder: "大阪駅前" },
    { key: "to", label: "到着地", placeholder: "関西空港" },
    { key: "confNumber", label: "確認番号", placeholder: "KB-553012" },
  ],
  食事: [
    { key: "title", label: "店名", placeholder: "レストランオルフェ" },
    { key: "date", label: "予約日", placeholder: "2026-04-16" },
    { key: "startTime", label: "予約時刻", placeholder: "19:00" },
    { key: "guests", label: "人数", placeholder: "4名" },
    { key: "confNumber", label: "確認番号", placeholder: "RF-120456" },
  ],
  病院: [
    { key: "title", label: "施設名", placeholder: "田中内科クリニック" },
    { key: "date", label: "受診日", placeholder: "2026-04-18" },
    { key: "startTime", label: "予約時刻", placeholder: "10:30" },
    { key: "department", label: "診療科", placeholder: "内科" },
    { key: "confNumber", label: "診察券番号", placeholder: "58234" },
  ],
  商談: [
    { key: "title", label: "タイトル", placeholder: "ABC社 商談" },
    { key: "date", label: "日付", placeholder: "2026-04-17" },
    { key: "startTime", label: "開始時刻", placeholder: "14:00" },
    { key: "endTime", label: "終了時刻", placeholder: "16:00" },
    { key: "from", label: "場所", placeholder: "グランフロント大阪" },
    { key: "confNumber", label: "確認番号", placeholder: "" },
  ],
  観光: [
    { key: "title", label: "イベント名", placeholder: "Mr.Children DOME TOUR" },
    { key: "date", label: "日付", placeholder: "2026-04-20" },
    { key: "startTime", label: "開演時刻", placeholder: "18:00" },
    { key: "from", label: "会場", placeholder: "東京ドーム" },
    { key: "confNumber", label: "確認番号", placeholder: "TC-440291" },
  ],
  その他: [
    { key: "title", label: "タイトル", placeholder: "内容" },
    { key: "date", label: "日付", placeholder: "2026-04-15" },
    { key: "startTime", label: "時刻", placeholder: "10:00" },
    { key: "confNumber", label: "確認番号", placeholder: "" },
  ],
};

/** カテゴリに応じた固定項目定義を返す */
export function getFixedFields(category: string): FixedFieldDef[] {
  return CATEGORY_FIXED_FIELDS[category] || CATEGORY_FIXED_FIELDS["その他"];
}

/* ====== 要確認判定ロール ====== */

export type NeedsReviewReason = {
  field: string;
  reason: string;
};

/** Stepの要確認理由を判定する */
export function checkNeedsReview(
  category: string,
  fixed: Record<string, string | null | undefined>,
  inferred?: string[],
): NeedsReviewReason[] {
  const reasons: NeedsReviewReason[] = [];

  // 必須項目チェック
  if (!fixed.title) reasons.push({ field: "title", reason: "未読取" });
  if (!fixed.date && !fixed.startTime) reasons.push({ field: "date", reason: "日時未読取" });

  // カテゴリ固有チェック
  if (category === "飛行機" || category === "列車" || category === "バス") {
    if (!fixed.from) reasons.push({ field: "from", reason: "出発地なし" });
    if (!fixed.to) reasons.push({ field: "to", reason: "到着地なし" });
  }
  if (category === "宿泊") {
    if (!fixed.endDate) reasons.push({ field: "endDate", reason: "チェックアウト日なし" });
  }
  if (!fixed.confNumber) reasons.push({ field: "confNumber", reason: "確認番号なし" });

  // 推定値チェック
  if (inferred && inferred.length > 0) {
    for (const f of inferred) {
      reasons.push({ field: f, reason: "推定値" });
    }
  }

  return reasons;
}

/* ====== 推定フィールドのラベル変換 ====== */

const GENERIC_INFERRED_LABELS: Record<string, string> = {
  title: "タイトル",
  date: "日付",
  endDate: "終了日",
  startTime: "開始時刻",
  time: "開始時刻",
  endTime: "終了時刻",
  from: "出発地",
  to: "到着地",
  confNumber: "確認番号",
  timezone: "タイムゾーン",
  memo: "メモ",
};

/** inferredフィールド名を、カテゴリに応じた表示ラベルに変換する */
export function formatInferredFields(inferred: string[] | undefined, category?: string): string {
  if (!inferred || inferred.length === 0) return "";
  const fixed = category ? CATEGORY_FIXED_FIELDS[category] : undefined;
  const byKey: Record<string, string> = {};
  if (fixed) {
    for (const f of fixed) byKey[f.key] = f.label;
  }
  return inferred
    .map((f) => byKey[f] ?? (f === "time" ? byKey["startTime"] : undefined) ?? GENERIC_INFERRED_LABELS[f] ?? f)
    .join("、");
}

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
