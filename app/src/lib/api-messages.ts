/**
 * 利用者に見せる API の文言（日本語 / 英語）。**1 か所に置く。**
 *
 * ## なぜ要るか（2026-09-21）
 *
 * アプリは **952 キー全訳済み**で端末の言語に追随するのに、
 * **サーバが返す `message` だけが日本語固定**だった。読み取りで上限や混雑に
 * 当たると、画面はサーバの `message` を優先して出すので
 * （`scan_screen.dart` の `_friendly`）、**英語の利用者が日本語のエラーを読む。**
 *
 * 無料枠は月 15 件で、**上限に当たるのは珍しくない。**
 * 英語圏へ配信する前に塞ぐ（`toritavi_app/docs/overseas-distribution.md`）。
 *
 * ## 言語をどこから取るか
 *
 * 🔴 **第一は `auth.users.raw_user_meta_data.lang`。** アプリが表示言語を
 * 変えるたびに `syncMailLanguage()` が同期しており、**サーバは検証済み
 * トークンから追加の往復なしに読める**（`supabase-server.ts` の `userMetadata`）。
 * 認証メールの出し分けと**同じ源**なので、メールと画面で言語がずれない。
 *
 * 🔴 **`Accept-Language` は、利用者が確定できないときだけの予備。**
 * メール（`email-templates.ts`）は**クライアントから言語を受け取らない** ——
 * 送れると第三者が本人の受け取る言語を選べるため。**ここは事情が違う** ——
 * 応答は要求した本人にしか返らないので、詐称しても自分の画面が変わるだけ。
 * **メールの規則をここへ持ち込まない**（持ち込むと未ログインの 401 が
 * 必ず日本語になる）。
 *
 * ## 追加するときの約束
 *
 * 🔴 **`ja` と `en` を同時に書く。** 片方だけ足せる形にしない ——
 * 型が両方を要求するので、**足し忘れはコンパイルで落ちる。**
 * `api-messages.test.ts` が「空文字が無い」ことも見張る。
 */

/** 出し分けできる言語。**アプリの `supportedLocales` と対**（`[en, ja]`）。 */
export type Lang = "ja" | "en";

/** 固定の文言。 */
export type L = { ja: string; en: string };

/** 数を埋める文言。 */
export type LN = { ja: (n: number) => string; en: (n: number) => string };

/** 既定は日本語。**判定できないときは倒す先を 1 つに決めておく。** */
export const DEFAULT_LANG: Lang = "ja";

/**
 * 利用者の言語を決める。
 *
 * 🔴 **`userMetadata` を先に見る。** そこに `lang` があれば、それが
 * 利用者自身がアプリで選んだ表示言語（`syncMailLanguage()` が同期）。
 *
 * `acceptLanguage` は**利用者が分からないときだけ**の予備
 * （ヘッダの先頭が `en` で始まるかだけを見る。品質値は見ない ——
 * ここで細かく解釈しても、出し分けは 2 言語しか無い）。
 */
export function resolveLang(args: {
  userMetadata?: Record<string, unknown> | null;
  acceptLanguage?: string | null;
}): Lang {
  const meta = args.userMetadata;
  if (meta && typeof meta.lang === "string") {
    return meta.lang.toLowerCase().startsWith("en") ? "en" : "ja";
  }
  const al = (args.acceptLanguage ?? "").trim().toLowerCase();
  if (al.startsWith("en")) return "en";
  return DEFAULT_LANG;
}

/** `L` から 1 つ選ぶ。 */
export function pick(msg: L, lang: Lang): string {
  return msg[lang];
}

/** `LN` から 1 つ選んで数を埋める。 */
export function pickN(msg: LN, lang: Lang, n: number): string {
  return msg[lang](n);
}

/**
 * 経路ごとの文言。**`error` コードと 1 対 1 にする。**
 *
 * 🔴 **`error` は翻訳しない。** あれは機械が読む識別子で、
 * アプリの分岐（`scan_screen.dart`）がそれを見ている。翻訳するのは
 * `message` だけ。
 */
export const API_MESSAGES = {
  // ---- 共通 -------------------------------------------------------------
  plan_unavailable: {
    ja: "混み合っています。しばらくしてからお試しください。",
    en: "We are busy right now. Please try again in a moment.",
  },
  usage_unavailable: {
    ja: "利用状況を取得できませんでした。",
    en: "We could not load your usage.",
  },

  // ---- /api/ocr の入口 ---------------------------------------------------
  ai_consent_required: {
    ja: "AI 送信の許諾が必要です",
    en: "Your permission is required before sending to AI.",
  },
  registration_required: {
    ja: "読み取りのご利用には、メールアドレスでのご登録が必要です。",
    en: "Scanning requires an account. Please sign up with your email address.",
  },
  request_id_required: {
    ja: "リクエストを識別できませんでした。もう一度お試しください。",
    en: "We could not identify this request. Please try again.",
  },
  ambiguous_input: {
    ja: "画像とテキストは同時に送れません。",
    en: "Images and text cannot be sent together.",
  },
  payload_too_large_text: {
    ja: "テキストが長すぎます。必要な部分だけ貼り付けてください。",
    en: "That text is too long. Please paste only the part you need.",
  },

  // ---- /api/ocr の処理中 -------------------------------------------------
  timeout: {
    ja: "時間内に処理できませんでした。もう一度お試しください。",
    en: "We could not finish in time. Please try again.",
  },
  // 🔴 **「回数は消費していません」を落とさない。** 上限が月 15 件なので、
  //    消費したかどうかは利用者にとって金額に近い意味を持つ。
  timeout_not_charged: {
    ja: "時間内に処理できませんでした。回数は消費していません。",
    en: "We could not finish in time. This did not use any of your scans.",
  },
  reserve_failed: {
    ja: "読み取りの準備に失敗しました。しばらくしてからお試しください。",
    en: "We could not start the scan. Please try again in a moment.",
  },
  too_large_to_read: {
    ja: "読み取る量が多すぎます。ページ数を減らすか、ファイルを分けてお試しください。",
    en: "There is too much to read. Please use fewer pages, or split the file.",
  },
  in_flight: {
    ja: "処理中です。しばらくお待ちください。",
    en: "This is still being processed. Please wait a moment.",
  },
  already_processed: {
    ja: "この読み取りは完了済みです。旅程をご確認ください。",
    en: "This scan is already done. Please check your itinerary.",
  },
  settle_failed: {
    ja: "読み取りは完了しましたが、記録に失敗しました。しばらくしてからもう一度お試しください。",
    en: "The scan finished but we could not record it. Please try again in a moment.",
  },
  ai_unavailable: {
    ja: "読み取りに失敗しました。回数は消費していません。",
    en: "The scan failed. This did not use any of your scans.",
  },

  // ---- 利用停止・自動読み取りの停止 ---------------------------------------
  account_blocked_fallback: {
    ja: "ご利用を停止しています。",
    en: "Your account is currently suspended.",
  },
  ocr_suspended: {
    ja: "ただいま自動読み取りをご利用いただけません。しばらくしてからお試しください。",
    en: "Automatic scanning is unavailable right now. Please try again later.",
  },
} as const satisfies Record<string, L>;

export type ApiMessageKey = keyof typeof API_MESSAGES;

/** 経路の文言を 1 つ取る。 */
export function apiMessage(key: ApiMessageKey, lang: Lang): string {
  return API_MESSAGES[key][lang];
}

/**
 * 数を埋める経路の文言。**カタログに置けない（引数があるため）ものだけ。**
 */
export const API_MESSAGES_N = {
  too_many_images: {
    ja: (n: number) => `ファイルは一度に最大 ${n} 件までです。`,
    en: (n: number) => `You can send up to ${n} files at a time.`,
  },
  // 🔴 ゲスト向け。**「今月」「翌月 1 日」と言わない** ——
  //    お試し枠にリセットは無く、待てば戻ると読ませる（2026-08-31 に実機で発覚）。
  guest_remaining: {
    ja: (n: number) =>
      `お試しでご利用いただけるのは残り ${n} 件です。ページ数を減らすか、無料登録してお試しください。`,
    en: (n: number) =>
      `You have ${n} trial scans left. Use fewer pages, or sign up for free to continue.`,
  },
} as const satisfies Record<string, LN>;

export type ApiMessageNKey = keyof typeof API_MESSAGES_N;

/** 数を埋める経路の文言を 1 つ取る。 */
export function apiMessageN(
  key: ApiMessageNKey,
  lang: Lang,
  n: number,
): string {
  return API_MESSAGES_N[key][lang](n);
}
