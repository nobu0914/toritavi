/**
 * OCR の入力制限と、消費件数・原価の見積り。**数字はここ 1 か所に置く。**
 *
 * 確定仕様（2026-08-22）:
 * - 1 ファイル最大 10MB / 1 リクエスト合計 20MB
 * - PDF は最大 20 ページ。**5 ページごとに 1 件**（1-5→1 / 6-10→2 / 11-15→3 / 16-20→4）
 * - AI 入力は最大 60,000 トークン
 *
 * 🔴 **`/api/ocr/preflight` は存在しない。** ここには長らく「実行前に見せる
 * 消費件数は preflight がこの計算で返す」と書いてあったが、**そのルートは
 * 一度も作られていない**（2026-09-13 の週次検査レーン 8 の所見 1）。
 * その間、アプリには送る前に件数を知る手段が無く、**11 ページの PDF を
 * 1 つ送ると残数が 3 減る**ことを利用者は知らなかった。
 *
 * 🔴 **`PAGES_PER_UNIT` と `MAX_PDF_PAGES` はアプリ側に写しがある**
 * （`toritavi_app` の `lib/features/scan/data/ocr_units.dart`）。
 * ここには以前「アプリ側にこの数字を写さない」と書いてあり、理由も正しい
 * —— 端末に持たせると、サーバを変えた日に画面だけが嘘をつく。
 * **写すと決めたのは利用者**（2026-09-13）。preflight を作るまでの間、
 * 利用者に何も見せないことの方が害が大きいと判断した。
 *
 * 🔴 **代わりに、ずれたら落ちる検査がアプリ側にある** ——
 * `test/features/scan/ocr_units_contract_test.dart` が**このファイルを
 * 実際に読み**、定数と `pdfUnits` の実装（切り上げ・`pages < 1` の扱い）を
 * 突き合わせる。**この 2 つと関数名を変えると、アプリの検査が落ちる。**
 * 落ちたら、写し（`ocr_units.dart`）も一緒に直すこと。
 */

/** 1 ファイルの上限（バイト）。 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** 1 リクエスト合計の上限（バイト）。 */
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
/** 1 リクエストのファイル数。 */
export const MAX_FILES = 10;
/** PDF 1 ファイルの最大ページ数。 */
export const MAX_PDF_PAGES = 20;
/** 何ページで 1 件と数えるか。 */
export const PAGES_PER_UNIT = 5;
/** 貼り付けテキストの最大文字数。 */
export const MAX_TEXT_CHARS = 20_000;
/** AI へ渡す入力トークンの上限。**原価の実効的な天井はこれ。** */
export const MAX_INPUT_TOKENS = 60_000;
/** 出力の上限（Anthropic 呼び出しの max_tokens）。 */
export const MAX_OUTPUT_TOKENS = 4096;

/** claude-sonnet-4-6（vision）の単価。1M トークンあたりのセント。 */
export const INPUT_CENTS_PER_MTOK = 300;
export const OUTPUT_CENTS_PER_MTOK = 1500;

/**
 * 画像 1 枚のトークン数の見積り。
 *
 * Anthropic の vision は概ね `幅 × 高さ / 750` トークンで、長辺は 1568px に
 * 縮小される。**上界だけ要るので、縮小後の最大面積で頭打ちにする。**
 * 実測より高めに出るのは意図的（見積りが実費を下回ると予算を超える）。
 */
export function estimateImageTokens(width: number, height: number): number {
  const MAX_EDGE = 1568;
  let w = width;
  let h = height;
  if (w > MAX_EDGE || h > MAX_EDGE) {
    const s = MAX_EDGE / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  return Math.max(1, Math.ceil((w * h) / 750));
}

/**
 * PDF 1 ページのトークン見積り。
 *
 * 🔴 **3,000 では足りなかった**（2026-08-22 の外部調査で判明）。
 * Anthropic の PDF 処理は**各ページをテキスト抽出と画像化の両方**にかけ、
 * 両方が課金される。公式資料の内訳:
 *   - テキスト: 1 ページあたり **1,500〜3,000** トークン
 *   - 画像: 28×28 パッチで、standard tier は 1 画像 **最大 1,568** トークン
 * 合計の上界は **約 4,568**。
 *
 * **見積りは必ず実費の上界でなければならない。** 下回ると、予約した額より
 * 実費が大きくなり、予算の判定をすり抜ける（`toritavi_ai_budget` の
 * reserved が足りない状態で AI を呼ぶことになる）。
 * 端数を切り上げて 4,600 を置く。
 */
export const TOKENS_PER_PDF_PAGE = 4600;

/**
 * 🔴 **見積りは「上界」ではない。**
 *
 * 公式が示す 1,500〜3,000 は**典型値であって最大値ではない**（2026-08-22 の
 * 外部レビュー指摘 1）。高密度なページ・隠しテキストを仕込んだ 1 ページ・
 * システムプロンプトとラッパーの分は、この定数では保証できない。
 *
 * そこで**実際の入力トークン数は Anthropic の count_tokens で数える**
 * （`countInputTokens`）。この定数は、count_tokens が使えなかったときの
 * フォールバックとしてだけ使い、そのときは [ESTIMATE_SAFETY_FACTOR] を掛ける。
 *
 * count_tokens は**安価な試行制限を通ったあとにだけ**呼ぶ。前に置くと
 * 「count_tokens だけを連打する」攻撃面になる。
 */
/**
 * `count_tokens` の値に掛ける安全余裕。
 *
 * 計測値と実請求が一致する保証は無い。**予約は多めに、精算は実費で。**
 * 足りないと予算の判定をすり抜ける。
 */
export const COUNT_SAFETY_MARGIN = 1.15;

/** 取りこぼしの吸収（ラッパー・将来のプロンプト追加）。予約に必ず足す。 */
export const OVERHEAD_TOKENS = 2000;

/**
 * 貼り付けテキストのトークン見積り。日本語は 1 文字 ≈ 1 トークンになりうる
 * ので、**文字数をそのまま上界として使う**（英語なら過大評価だが安全側）。
 */
export function estimateTextTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars * 1.2));
}

/** PDF のページ数 → 消費件数。**切り上げ。** */
export function pdfUnits(pages: number): number {
  if (pages < 1) return 1;
  return Math.ceil(pages / PAGES_PER_UNIT);
}

/** 見積り入力トークンから 1 リクエストの原価（セント・切り上げ）。 */
export function estimateCostCents(inputTokens: number): number {
  return Math.ceil(
    (inputTokens * INPUT_CENTS_PER_MTOK +
      MAX_OUTPUT_TOKENS * OUTPUT_CENTS_PER_MTOK) /
      1_000_000,
  );
}

/** 実費（返ってきたトークン数から）。 */
export function actualCostCents(tokensIn: number, tokensOut: number): number {
  return Math.ceil(
    (tokensIn * INPUT_CENTS_PER_MTOK + tokensOut * OUTPUT_CENTS_PER_MTOK) /
      1_000_000,
  );
}

/**
 * 1 リクエストの最大原価。**運用の説明に使う数字。**
 * 入力の上限に達した場合で、`estimateCostCents(MAX_INPUT_TOKENS)`。
 */
export const MAX_COST_CENTS_PER_REQUEST = estimateCostCents(MAX_INPUT_TOKENS);

// ---------------------------------------------------------------------------
// Phase 1 のインライン経路（base64 を本文に載せる）の上限
//
// 🔴 **確定仕様の 10MB / 20MB は、この経路では達成できない。**
//    Vercel Functions の本文上限は 4.5MB で、base64 は 4/3 に膨らむ。
//    10MB のファイルは本文 13.3MB になり、**アプリの実装以前に
//    プラットフォームが 413 を返す**（こちらのコードは動かない）。
//
//    10MB / 20MB は **Phase 2（一時 Storage 経由）で有効になる。**
//    それまではここが実効的な上限。`/api/ocr/preflight` はこの値で答える。
// ---------------------------------------------------------------------------
export const MAX_INLINE_FILE_BYTES = 3 * 1024 * 1024;
export const MAX_INLINE_TOTAL_BYTES = 3 * 1024 * 1024;
