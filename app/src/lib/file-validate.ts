/**
 * AI へ渡す前のファイル検証。**バイト列の実体だけを信じる。**
 *
 * 申告された MIME も拡張子も、攻撃者が自由に決められる。ここで見るのは
 * 先頭のマジックバイトと、コンテナを実際に開いた結果だけ。
 *
 * 拒否するもの（確定仕様 2026-08-22）:
 * - 10MB 超 / 20 ページ超
 * - パスワード付き・暗号化 PDF / 壊れた PDF
 * - 拡張子・申告 MIME・実体が一致しないファイル
 * - 異常な画像寸法（展開後の容量爆弾）
 * - 許可外形式
 */
import { MAX_FILE_BYTES, MAX_PDF_PAGES } from "./ocr-limits.ts";

export type DetectedKind = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf";

export type ValidateOk = {
  ok: true;
  kind: DetectedKind;
  bytes: number;
  /** PDF のみ。 */
  pages?: number;
  /** 画像のみ。 */
  width?: number;
  height?: number;
};

export type ValidateNg = {
  ok: false;
  /** 利用者に見せる区分。**内部の詳細は載せない。** */
  reason:
    | "too_large"
    | "unsupported_format"
    | "mime_mismatch"
    | "pdf_encrypted"
    | "pdf_corrupt"
    // 🔴 **こちら側の問題**。利用者のファイルのせいにしない
    | "pdf_unreadable"
    | "pdf_too_many_pages"
    | "image_dimensions";
};

export type ValidateResult = ValidateOk | ValidateNg;

/** 画像の展開後ピクセル数の上限（圧縮爆弾よけ）。約 40 メガピクセル。 */
const MAX_PIXELS = 40_000_000;
/** 1 辺の上限。極端に細長い画像はデコーダを傷めやすい。 */
const MAX_EDGE = 20_000;

function startsWith(b: Uint8Array, sig: number[], at = 0): boolean {
  if (b.length < at + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[at + i] !== sig[i]) return false;
  return true;
}

/** マジックバイトだけで種別を決める。**申告値は見ない。** */
export function detectKind(b: Uint8Array): DetectedKind | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  // PDF は先頭に BOM やゴミが入ることがあるので、先頭 1KB から探す。
  const head = b.subarray(0, 1024);
  for (let i = 0; i + 4 < head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46)
      return "application/pdf";
  }
  return null;
}

/** 画像の寸法をヘッダだけから読む（デコードしない）。 */
export function readImageSize(
  kind: DetectedKind,
  b: Uint8Array,
): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (kind === "image/png") {
      // IHDR は必ず先頭チャンク。幅・高さは 16..24。
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    if (kind === "image/gif") {
      return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
    }
    if (kind === "image/webp") {
      const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (fourcc === "VP8X") {
        const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
        const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
        return { width: w, height: h };
      }
      if (fourcc === "VP8 ") {
        return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
      }
      if (fourcc === "VP8L") {
        const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      return null;
    }
    // JPEG: SOF マーカーを走査する。
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      // SOF0..SOF15（DHT/JPG/DAC は除く）
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      }
      const len = dv.getUint16(i + 2);
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * PDF を実際に開いてページ数を得る。暗号化・破損はここで分かる。
 *
 * `pdfjs-dist` は既に依存に入っている（Web の閲覧で使用）。
 * **新しい依存を足していない。**
 */
export async function readPdfPages(
  b: Uint8Array,
): Promise<
  { pages: number } | { error: "pdf_encrypted" | "pdf_corrupt" | "pdf_unreadable" }
> {
  try {
    const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = mod.getDocument({
      data: b,
      // 外部リソースを一切取りに行かせない。
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      // 空パスワードを試させない（暗号化はここで例外になってほしい）。
      password: "",
    });
    const doc = await task.promise;
    const pages = doc.numPages;
    await doc.destroy();
    if (!Number.isFinite(pages) || pages < 1) return { error: "pdf_corrupt" };
    return { pages };
  } catch (e) {
    const name = (e as { name?: string })?.name ?? "";
    const message = (e as { message?: string })?.message ?? String(e);

    // pdfjs は暗号化 PDF で PasswordException を投げる。
    if (name === "PasswordException") return { error: "pdf_encrypted" };

    // 🔴 **中身が壊れていると言えるのは、pdfjs がそう言ったときだけ。**
    //
    //    もとは**どの例外も pdf_corrupt** にまとめていた。だから
    //    こちら側の問題（実行環境で pdfjs が動かない等）でも
    //    「ファイルが壊れている可能性があります」と表示され、
    //    **利用者は自分のファイルを疑うことになる。**
    //    2026-08-24 に実機で発覚 —— 正常に開ける 3 ページの e チケットが
    //    弾かれた（同じファイルをローカルの pdfjs で開くと通る）。
    //
    //    理由を握り潰していたので、**なぜ落ちたのかを誰も追えなかった。**
    //    JR000108（停止スイッチを「上限超過」と表示していた件）と同じ型。
    if (name === "InvalidPDFException" || name === "MissingPDFException") {
      return { error: "pdf_corrupt" };
    }

    // ここに来たら**原因が分かっていない**。必ず残す。
    console.error("[file-validate] PDF を開けなかった（原因不明）:", name, "|", message);
    return { error: "pdf_unreadable" };
  }
}

/**
 * 1 ファイルを検証する。
 *
 * [declaredMime] は利用者の申告。**一致しなければ拒否**する（Polyglot 対策）。
 * 申告が無い場合は実体だけで判定する。
 */
export async function validateFile(
  bytes: Uint8Array,
  declaredMime?: string | null,
): Promise<ValidateResult> {
  if (bytes.byteLength > MAX_FILE_BYTES) return { ok: false, reason: "too_large" };
  if (bytes.byteLength === 0) return { ok: false, reason: "unsupported_format" };

  const kind = detectKind(bytes);
  if (!kind) return { ok: false, reason: "unsupported_format" };

  if (declaredMime) {
    const d = declaredMime.split(";")[0].trim().toLowerCase();
    if (d && d !== kind) return { ok: false, reason: "mime_mismatch" };
  }

  if (kind === "application/pdf") {
    const r = await readPdfPages(bytes);
    if ("error" in r) return { ok: false, reason: r.error };
    if (r.pages > MAX_PDF_PAGES) return { ok: false, reason: "pdf_too_many_pages" };
    return { ok: true, kind, bytes: bytes.byteLength, pages: r.pages };
  }

  const size = readImageSize(kind, bytes);
  // 寸法が読めない＝ヘッダが壊れている。**分からないものを通さない。**
  if (!size) return { ok: false, reason: "image_dimensions" };
  const { width, height } = size;
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_EDGE ||
    height > MAX_EDGE ||
    width * height > MAX_PIXELS
  ) {
    return { ok: false, reason: "image_dimensions" };
  }
  return { ok: true, kind, bytes: bytes.byteLength, width, height };
}

/** 利用者に見せる文言。**内部の詳細は出さない。** */
export const REJECT_MESSAGE: Record<ValidateNg["reason"], string> = {
  too_large: "ファイルが大きすぎます（1 ファイル 10MB まで）。画像を圧縮するか、PDF をページで分けてお試しください。",
  unsupported_format: "この形式は読み取れません（JPEG / PNG / WebP / GIF / PDF に対応しています）。",
  mime_mismatch: "ファイルの中身と種類が一致しません。別のファイルでお試しください。",
  pdf_encrypted: "パスワード付きの PDF は読み取れません。保護を外してからお試しください。",
  pdf_corrupt: "PDF を開けませんでした。ファイルが壊れている可能性があります。",
  // 🔴 **原因がこちらにある可能性が高い。** 利用者のファイルを疑わせない。
  pdf_unreadable: "PDF を読み取れませんでした。しばらくしてからお試しください。直らないときはお問い合わせください。",
  pdf_too_many_pages: "PDF は 20 ページまでです。必要なページだけを取り出してお試しください。",
  image_dimensions: "画像のサイズが大きすぎます。縮小してからお試しください。",
};
