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
    // 🔴 **到着日は印字を写す。計算しない**（2026-10-08・実データ検査 #5）。
    //    「翌日着なら endDate」とだけ書いていたため、モデルが時差と所要時間から
    //    到着日を**計算**していた。羽田 21:15 発→シアトル 13:20 着（日付変更線を
    //    東へ越えて**同じ日**に着く）を、表に「26DEC25」と印字されているのに
    //    28 日と読んだ。到着日の書かれていない搭乗券でも「翌日着」を埋めていた。
    飛行機:
      "出発日をdate。到着日は**書類に印字された到着日をそのまま** endDate に入れる" +
      "（日付変更線を東へ越える便は出発日と同じ日や前日に着く。印字がそうなら、それが正しい。" +
      "時差・所要時間から計算して直さない）。" +
      "**到着日が書類に書かれていなければ endDate は null**（搭乗券は到着日が無いことが多い。" +
      "「翌日着のはず」で埋めない）",
    列車: "乗車日をdate。日をまたぐ夜行の場合はendDateに到着日を入れる",
    船: "乗船日をdate。夜行便で日をまたぐ場合はendDateに到着日を入れる",
    観光: "イベント開始日をdate。フェス等の複数日はendDateに最終日を入れる",
    アポ: "開始日をdate。複数日にまたがる場合はendDateに最終日を入れる",
  },

  // 🔴 **endDate を計算・推測で埋めたら inferred に入れる**（2026-10-08）。
  //    アプリは inferred を見て「要確認」を出す。入れ忘れると、推測の日付が
  //    「読み取れた日付」として確認の機会なく保存される。
  endDateSource:
    "endDate は書類に書かれた日付だけを入れる。泊数・所要時間などから計算して入れたときは、" +
    "必ず inferred に \"endDate\" を入れる",

  // 相対日付の変換
  relative: "「明日」「来週月曜」等の相対表現は変換せずそのまま返す。確定日付のみYYYY-MM-DDにする",
} as const;

export const TIME_RULES = {
  format: "HH:MM（24時間制）",
  ampm: "AM/PMは24時間制に変換する（例: 2:30PM → 14:30）",

  // 🔴 **「国内」という概念を使わない**（2026-09-07・JR000221）。
  //
  //    ここは長く `domestic: "国内の場合はtimezoneは省略する（JSTが前提）"` だった。
  //    日本だけに配信していたときは、**省略＝日本時間**で正しかった。
  //
  //    **省略されたゾーンは、端末のゾーンとして解釈される**
  //    （アプリの `reminder_builder.dart` の `_toUtc` が `local.toUtc()` に落ちる）。
  //    日本は単一タイムゾーンで、利用者もたいてい国内に居るので当たっていた。
  //
  //    🔴 **米国は 6 つ、カナダも豪州もタイムゾーンが複数ある。**
  //    ニューヨークに居る人がロサンゼルス発の便を登録すると、
  //    **出発時刻が 3 時間ずれたまま通知が飛ぶ。** 落ちも警告も出ない
  //    （`CLAUDE.md` §6-1「出ないのに落ちない」）。
  //
  //    **省略してよいのは「本当に特定できないとき」だけ**にする。
  timezone: {
    rule: "時刻は出発地の現地時間（壁時計）で返す。到着地のゾーンが違う場合は到着も現地時間",
    field:
      "timezone に出発地のタイムゾーンを入れる。IANA ID を優先" +
      "（例 Asia/Tokyo, America/Los_Angeles, Europe/London, Australia/Sydney）。" +
      "判らなければ略称（JST, PST, GMT, AEST）",
    arrival: "到着地のゾーンが出発地と違う場合、endTimezone として変動項目に入れる",
    unknown:
      "書類にも地名にも手がかりが無く、出発地のゾーンを特定できないときだけ timezone を省略する。" +
      "推測で埋めない",
  },

  // UI表示ルール。
  // 🔴 **ここはプロンプトに入らない。** `buildOcrRulesPrompt` は timezone.* だけを使う。
  //    使っているのは `src/app/trips/[id]/TripDetailClient.tsx`（**Web 版・開発停止**）
  //    の `formatTimeDisplay` / `isInternational` だけ。**iOS アプリは参照しない。**
  //    日本前提（「日本時間を併記」）が残っているが、**出荷物に影響しない**ので
  //    ここでは触らない。Web 版を再開する日に直すこと。
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
  // 🔴 **区間の数だけ返す**（2026-10-08・実データ検査 #2）。
  //    「通常は1要素、往復時は2要素」と書いていたため、乗継を含む往復
  //    （HND→DXB→SAW と SAW→DXB→HND の 4 区間）を 2 要素にまとめ、
  //    乗継便を variable の「乗り継ぎ情報」へ押し込んでいた。読むたびに
  //    4・3・2 区間と変わり、実アプリでは 2 区間が予定から消えた。
  roundTrip: {
    rule: "往復の予約書類は行きと帰りを別々のStepとして返す",
    output:
      "stepsは**区間（便名・列車名ひとつ）ごとに1要素**。片道の直行なら1要素、往復なら2要素、" +
      "乗継を含むなら区間の数だけ（例: 東京→シンガポール→ロンドンの往復なら4要素）",
    examples: [
      "往復航空券 → 行きフライト + 帰りフライト",
      "往復新幹線 → 行き列車 + 帰り列車",
      "乗継のある航空券 → 1区間ずつ（HND→SIN と SIN→LHR は別の予定）",
    ],
    connection:
      "**乗継便を variable（乗り継ぎ情報）にまとめない。**書類の旅程表に載っている区間は全部 steps に入れる。" +
      "返す前に、書類の区間（便名）の数と steps の数が一致しているか数え直す",
  },

  // 分割しないケース
  noSplit: [
    "宿泊（IN/OUTは1つのStepのdate/endDateで管理）",
    "複数日イベント（date/endDateで管理）",
    "同じ便名のまま経由地に寄る場合（経由地は変動項目に記載、Step自体は1つ）",
  ],

  // 「分割しない」の例外。**1 つの Step は便名を 1 つしか持てない。**
  // 乗り継ぎを常に 1 つへまとめる規則にしていたため、"GA 318" と "GA 31" の
  // 乗り継ぎで片方の便名が消えていた（搭乗券は 2 枚あるのにカードは 1 枚）。
  splitOnDifferentVehicle:
    "便名・列車名が変わるなら、同じ予約番号でも別の予定として分ける",
} as const;

/* ====== 予定の無いページ ====== */

// 🔴 **予定の無いページから予定を作らない**（2026-10-08・実データ検査 #7）。
//    e チケット控えの運賃明細・手荷物・注意書きのページから、日付の無い
//    「(無題)」「ANA」の予定が返っていた。航空会社名と予約番号は
//    どのページにも印字されているので、それだけで予定を作ってしまう。
export const PAGE_RULES = {
  noSchedule:
    "便・列車・宿泊・予約の**日付も時刻も書かれていないページ**（運賃明細・支払い・手荷物・" +
    "約款・注意書きだけのページ）からは予定を作らない。そのときは {\"steps\": []} を返す。" +
    "**日付が書かれた書類（期限・締切・受取期限の案内を含む）はこの規則の対象外**で、今までどおり予定にする",
  notEnough:
    "航空会社名・予約番号・乗客名・運賃だけでは予定にならない。日付も時刻も無い step は返さない",
} as const;

/* ====== 便名（タイトル）の形 ====== */

// 便名の形が読むたびに揺れていた（「Delta Air Lines フライト 2844」と「DL2844」）。
// 同じ便が別の名前で並ぶと、利用者には別の予定に見える。
export const TITLE_RULES = {
  flight:
    "飛行機の title は**航空会社の2文字コード + 半角スペース + 便名の数字**（例 \"DL 1234\"、\"NH 10\"、" +
    "\"ZG 051\"）。数字は書類の表記のまま（先頭の 0 を消さない）。航空会社名や「フライト」「便」を付けない。" +
    "コードシェア便は書類の便名（予約した便名）を title にし、運航便名は variable に入れる（\"EK 1234 / FZ0567\" としない）。" +
    "**便名が書類に無ければ航空会社名を title にする**。便名の数字の部分は数字だけ（末尾に英字 1 つまで）で、" +
    "英字の混じった予約番号・確認番号（\"NH-AB12CD\" など）を便名の形（\"NH AB12CD\"）にしない",
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
    "乗り継ぎ情報（同じ便名のまま寄る経由地だけ。別の便名の区間は steps に入れる）",
    "到着地タイムゾーン（出発地とゾーンが違う場合）",
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

// 🔴 **どこからも参照されていない**（2026-09-07 に実測）。プロンプトにも UI にも
//    出ていない。消さずに残すのは、読み取り確認画面を作り直すときの下敷きに
//    なるため。**ここを直しても本番の挙動は変わらない。**
export const CATEGORY_FIXED_FIELDS: Record<string, FixedFieldDef[]> = {
  飛行機: [
    { key: "title", label: "便名", placeholder: "NH225" },
    { key: "airline", label: "運行航空会社", placeholder: "Air New Zealand" },
    { key: "date", label: "出発日", placeholder: "2026-04-15" },
    { key: "startTime", label: "出発時刻", placeholder: "10:00" },
    { key: "endDate", label: "到着日", placeholder: "2026-04-15" },
    { key: "endTime", label: "到着時刻", placeholder: "12:00" },
    { key: "from", label: "出発地", placeholder: "NRT" },
    { key: "to", label: "到着地", placeholder: "KIX" },
    { key: "timezone", label: "タイムゾーン", placeholder: "Asia/Tokyo・America/Los_Angeles など" },
    { key: "confNumber", label: "確認番号", placeholder: "ANA-882541" },
  ],
  列車: [
    { key: "title", label: "列車名", placeholder: "のぞみ 225号" },
    { key: "date", label: "乗車日", placeholder: "2026-04-15" },
    { key: "startTime", label: "出発時刻", placeholder: "10:00" },
    { key: "endDate", label: "到着日", placeholder: "2026-04-15" },
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
    { key: "from", label: "住所", placeholder: "大阪市港区海岸通1-2-3" },
    { key: "guests", label: "人数", placeholder: "2名" },
    { key: "confNumber", label: "確認番号", placeholder: "HB-394021" },
  ],
  バス: [
    { key: "title", label: "路線名", placeholder: "関西空港交通バス" },
    { key: "date", label: "乗車日", placeholder: "2026-04-15" },
    { key: "startTime", label: "出発時刻", placeholder: "7:30" },
    { key: "endDate", label: "到着日", placeholder: "2026-04-15" },
    { key: "endTime", label: "到着時刻", placeholder: "8:45" },
    { key: "from", label: "出発地", placeholder: "大阪駅前" },
    { key: "to", label: "到着地", placeholder: "関西空港" },
    { key: "confNumber", label: "予約番号", placeholder: "KB-553012" },
  ],
  車: [
    { key: "title", label: "レンタカー会社・車種", placeholder: "トヨタレンタカー" },
    { key: "date", label: "利用日", placeholder: "2026-04-15" },
    { key: "startTime", label: "出発時刻", placeholder: "9:00" },
    { key: "from", label: "出発地", placeholder: "関西空港店" },
    { key: "to", label: "到着地", placeholder: "京都駅前店" },
    { key: "confNumber", label: "予約番号", placeholder: "CR-771203" },
  ],
  船: [
    { key: "title", label: "航路・便名", placeholder: "さんふらわあ" },
    { key: "date", label: "乗船日", placeholder: "2026-04-15" },
    { key: "startTime", label: "出発時刻", placeholder: "19:00" },
    { key: "endDate", label: "到着日", placeholder: "2026-04-16" },
    { key: "endTime", label: "到着時刻", placeholder: "7:30" },
    { key: "from", label: "出発港", placeholder: "大阪南港" },
    { key: "to", label: "到着港", placeholder: "別府港" },
    { key: "confNumber", label: "予約番号", placeholder: "FB-330845" },
  ],
  徒歩: [
    { key: "title", label: "メモ", placeholder: "駅まで徒歩" },
    { key: "date", label: "日付", placeholder: "2026-04-15" },
    { key: "startTime", label: "時刻", placeholder: "9:00" },
    { key: "from", label: "出発地", placeholder: "ホテル" },
    { key: "to", label: "到着地", placeholder: "京都駅" },
  ],
  食事: [
    { key: "title", label: "店名", placeholder: "レストランオルフェ" },
    { key: "date", label: "予約日", placeholder: "2026-04-16" },
    { key: "startTime", label: "予約時刻", placeholder: "19:00" },
    { key: "from", label: "場所", placeholder: "大阪市中央区道頓堀1-2-3" },
    { key: "guests", label: "人数", placeholder: "4名" },
    { key: "confNumber", label: "確認番号", placeholder: "RF-120456" },
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
    { key: "title", label: "イベント・ツアー名", placeholder: "東京ドーム公演 / 現地ツアー" },
    { key: "date", label: "日付", placeholder: "2026-04-20" },
    { key: "endDate", label: "最終日", placeholder: "2026-04-21" },
    { key: "startTime", label: "開演時刻", placeholder: "18:00" },
    { key: "from", label: "会場", placeholder: "東京ドーム" },
    { key: "confNumber", label: "確認番号", placeholder: "TC-440291" },
  ],
  アポ: [
    { key: "title", label: "タイトル", placeholder: "ABC社 打ち合わせ" },
    { key: "date", label: "日付", placeholder: "2026-04-17" },
    { key: "startTime", label: "開始時刻", placeholder: "14:00" },
    { key: "endTime", label: "終了時刻", placeholder: "15:00" },
    { key: "from", label: "場所", placeholder: "グランフロント大阪" },
    { key: "confNumber", label: "確認番号", placeholder: "A-12345" },
  ],
  その他: [
    { key: "title", label: "タイトル", placeholder: "〇〇展示会 入場券" },
    { key: "date", label: "日付", placeholder: "2026-04-15" },
    { key: "startTime", label: "開始時刻", placeholder: "10:00" },
    { key: "endTime", label: "終了時刻", placeholder: "11:00" },
    { key: "from", label: "場所", placeholder: "東京ビッグサイト" },
    { key: "confNumber", label: "確認番号", placeholder: "EX-1024" },
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
  if (
    category === "飛行機" ||
    category === "列車" ||
    category === "バス" ||
    category === "車" ||
    category === "船"
  ) {
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
- ${DATE_RULES.endDateSource}
- ${DATE_RULES.relative}
- カテゴリ別のdate/endDate使い分け:
${Object.entries(DATE_RULES.split).map(([k, v]) => `  - ${k}: ${v}`).join("\n")}

## 時刻ルール
- 時刻は${TIME_RULES.format}で返す
- ${TIME_RULES.ampm}
- ${TIME_RULES.timezone.rule}
- ${TIME_RULES.timezone.field}
- ${TIME_RULES.timezone.arrival}
- ${TIME_RULES.timezone.unknown}

## 文書分割ルール
- ${SPLIT_RULES.roundTrip.rule}
- ${SPLIT_RULES.roundTrip.output}
- ${SPLIT_RULES.roundTrip.connection}
- 分割する例: ${SPLIT_RULES.roundTrip.examples.join("、")}
- 分割しない: ${SPLIT_RULES.noSplit.join("、")}
- ${SPLIT_RULES.splitOnDifferentVehicle}

## 予定の無いページ
- ${PAGE_RULES.noSchedule}
- ${PAGE_RULES.notEnough}

## 便名（タイトル）の形
- ${TITLE_RULES.flight}

## カテゴリ判定
${CATEGORY_RULES.priority.map((r) => `- ${r}`).join("\n")}

## 変動項目
- 優先度順: ${VARIABLE_RULES.priorityOrder.join(" > ")}
- 最大${VARIABLE_RULES.maxItems}件
- 固定項目と重複する情報は含めない
`.trim();
}
