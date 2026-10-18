/*
 * 画像から撮影メタデータ（位置情報・機種・撮影日時・コメント）を落とす。
 *
 * 使うのはメール転送の受信（`parseInboundMail`）。転送された写真は
 * `toritavi-inbox` に**最長 30 日**置かれ、運営の画面からも取り出せる。
 * 置く前に落とさないと、**撮影した場所がサーバに残る**（2026-10-18 の
 * 週次検査 4-1。それまでは受け取ったバイト列をそのまま置いていた）。
 *
 * ## やり方 —— 作り直さない・切り取るだけ
 *
 * 画素には触らない（再エンコードしない）。メタデータの入れ物だけを抜く。
 * 依存を足さず、画質も変えない。
 *
 * | 種類 | 抜くもの | 残すもの |
 * |---|---|---|
 * | JPEG | APP1（EXIF・XMP）・APP13（IPTC）・その他の APPn・COM・**画像の終わり（EOI）より後ろ**（iPhone の MPF が付ける 2 枚目以降の画像） | APP0（JFIF）・ICC プロファイル（APP2）・Adobe（APP14。色の変換に要る）・画像本体 |
 * | PNG | eXIf・tEXt・zTXt・iTXt（XMP はここに入る）・tIME・IEND より後ろ | それ以外のチャンク |
 * | WebP | EXIF・XMP チャンク（VP8X の印も下ろす）・RIFF より後ろ | それ以外のチャンク |
 * | GIF | コメント・アプリケーション拡張（NETSCAPE2.0 / ANIMEXTS1.0 のループ指定は残す） | 画像・色表・描画の拡張 |
 *
 * ## 🔴 JPEG の向きの印（Orientation）だけは書き戻す
 *
 * iPhone の写真は画素を横長のまま持ち、「90° 回して見せよ」という印を EXIF に
 * 付けている。EXIF を丸ごと落とすと**印も消えて横倒しの画素だけが残り**、
 * アプリが正立できない（`toritavi_app` の `image_orientation.dart` 冒頭。
 * 2026-10-08 に横倒しのまま AI に届いて便名を読み違えた）。
 * だから Orientation が 2〜8 なら、**その 1 項目だけの EXIF** を作って入れ直す。
 * アプリが読むのは JPEG の印だけなので、PNG・WebP・GIF には書き戻さない。
 *
 * ## 🔴 読めない画像は投げる（呼び出し側が置かない）
 *
 * 構造を辿れなければ、どこにメタデータがあるか分からない。
 * **落とせたか分からないものは置かない**（フェイルクローズ）。
 */
import type { DetectedKind } from "./file-validate.ts";

export class ImageMetadataError extends Error {
  constructor(reason: string) {
    super(`image metadata: ${reason}`);
    this.name = "ImageMetadataError";
  }
}

export type ImageKind = Exclude<DetectedKind, "application/pdf">;

/** メタデータを落とした新しいバイト列。辿れなければ [ImageMetadataError]。 */
export function stripImageMetadata(kind: ImageKind, bytes: Uint8Array): Uint8Array {
  switch (kind) {
    case "image/jpeg":
      return stripJpeg(bytes);
    case "image/png":
      return stripPng(bytes);
    case "image/webp":
      return stripWebp(bytes);
    case "image/gif":
      return stripGif(bytes);
  }
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const EXIF_ID = ascii("Exif\0\0");
const ICC_ID = ascii("ICC_PROFILE\0");
const ADOBE_ID = ascii("Adobe");

function hasPrefix(b: Uint8Array, at: number, end: number, sig: number[]): boolean {
  if (end - at < sig.length) return false;
  for (let k = 0; k < sig.length; k++) if (b[at + k] !== sig[k]) return false;
  return true;
}

/** 区切りの 2 バイトだけで、長さを持たないマーカー。 */
function isStandalone(m: number): boolean {
  return m === 0x01 || (m >= 0xd0 && m <= 0xd7);
}

/** 長さ付きの区切り 1 つを、残すかどうか。 */
function keepJpegSegment(marker: number, b: Uint8Array, data: number, end: number): boolean {
  if (marker === 0xe0) return true; // APP0（JFIF）
  if (marker === 0xe2) return hasPrefix(b, data, end, ICC_ID); // ICC だけ。MPF・FPXR は落とす
  if (marker === 0xee) return hasPrefix(b, data, end, ADOBE_ID); // 色の変換（YCCK など）に要る
  if (marker >= 0xe1 && marker <= 0xef) return false; // EXIF・XMP・IPTC・その他の APPn
  if (marker === 0xfe) return false; // COM
  return true; // DQT・DHT・SOF・DRI・SOS など、画像の本体
}

function stripJpeg(b: Uint8Array): Uint8Array {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw new ImageMetadataError("jpeg: no SOI");
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let orientation = 1;
  let app0End = -1; // 先頭が APP0 なら、その直後に向きの印を入れる
  let i = 2;
  let inScan = false;
  let scanStart = 0;
  let sawSos = false;
  let sawEoi = false;

  while (i < b.length) {
    if (inScan) {
      // 画像の本体。0xFF の後ろが 00（詰め物）・RST・0xFF なら本体の続き。
      if (b[i] !== 0xff || i + 1 >= b.length) {
        i++;
        continue;
      }
      const n = b[i + 1];
      if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) {
        i += 2;
        continue;
      }
      if (n === 0xff) {
        i++;
        continue;
      }
      parts.push(b.subarray(scanStart, i));
      inScan = false;
      continue;
    }

    if (b[i] !== 0xff) throw new ImageMetadataError("jpeg: expected marker");
    const marker = b[i + 1];
    if (marker === undefined) throw new ImageMetadataError("jpeg: truncated marker");
    if (marker === 0xff) {
      i++; // 詰め物の 0xFF
      continue;
    }
    if (marker === 0xd9) {
      if (!sawSos) throw new ImageMetadataError("jpeg: EOI before image data");
      parts.push(b.subarray(i, i + 2));
      sawEoi = true;
      break; // 🔴 EOI より後ろは捨てる（MPF の 2 枚目以降・末尾のゴミ）
    }
    if (isStandalone(marker)) {
      parts.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > b.length) throw new ImageMetadataError("jpeg: truncated segment");
    const len = (b[i + 2] << 8) | b[i + 3];
    const end = i + 2 + len;
    if (len < 2 || end > b.length) throw new ImageMetadataError("jpeg: bad segment length");

    if (marker === 0xe1 && orientation === 1 && hasPrefix(b, i + 4, end, EXIF_ID)) {
      orientation = orientationInTiff(b, i + 4 + EXIF_ID.length, end);
    }
    if (keepJpegSegment(marker, b, i + 4, end)) {
      if (marker === 0xe0 && parts.length === 1) app0End = 1;
      parts.push(b.subarray(i, end));
    }
    i = end;
    if (marker === 0xda) {
      sawSos = true;
      inScan = true;
      scanStart = i;
    }
  }
  if (!sawSos) throw new ImageMetadataError("jpeg: no image data");
  // EOI が無いまま終わった（途中で切れた JPEG）。本体はそのまま残す ——
  // メタデータは区切りにしか入らず、区切りは全部見終えている。
  if (inScan && !sawEoi) parts.push(b.subarray(scanStart));

  if (orientation >= 2 && orientation <= 8) {
    const at = app0End === -1 ? 1 : app0End + 1;
    parts.splice(at, 0, orientationOnlyApp1(orientation));
  }
  return concat(parts);
}

/** TIFF の先頭 `[t, end)` から IFD0 の Orientation を読む。無い・読めなければ 1。 */
function orientationInTiff(b: Uint8Array, t: number, end: number): number {
  if (end - t < 8) return 1;
  let little: boolean;
  if (b[t] === 0x49 && b[t + 1] === 0x49) little = true;
  else if (b[t] === 0x4d && b[t + 1] === 0x4d) little = false;
  else return 1;
  const dv = new DataView(b.buffer, b.byteOffset + t, end - t);
  if (dv.getUint16(2, little) !== 0x002a) return 1;
  const ifd0 = dv.getUint32(4, little);
  if (ifd0 < 8 || ifd0 + 2 > dv.byteLength) return 1;
  const count = dv.getUint16(ifd0, little);
  for (let n = 0; n < count; n++) {
    const e = ifd0 + 2 + n * 12;
    if (e + 12 > dv.byteLength) return 1;
    if (dv.getUint16(e, little) !== 0x0112) continue;
    const type = dv.getUint16(e + 2, little);
    const v = type === 3 ? dv.getUint16(e + 8, little) : type === 4 ? dv.getUint32(e + 8, little) : 1;
    return v >= 1 && v <= 8 ? v : 1;
  }
  return 1;
}

/** Orientation の 1 項目だけを持つ APP1（ビッグエンディアン・34 バイト）。 */
function orientationOnlyApp1(orientation: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xe1, 0x00, 0x22, // APP1・長さ 34
    ...EXIF_ID,
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // TIFF ヘッダ（MM・IFD0 は 8）
    0x00, 0x01, // 項目 1 つ
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, // 0x0112・SHORT・1 個
    0x00, orientation, 0x00, 0x00, // 値
    0x00, 0x00, 0x00, 0x00, // 次の IFD なし
  ]);
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(b: Uint8Array): Uint8Array {
  if (!hasPrefix(b, 0, b.length, PNG_SIG)) throw new ImageMetadataError("png: no signature");
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 8;
  let first = true;
  while (true) {
    if (i + 12 > b.length) throw new ImageMetadataError("png: truncated chunk");
    const len = dv.getUint32(i);
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new ImageMetadataError("png: bad chunk type");
    if (first && type !== "IHDR") throw new ImageMetadataError("png: IHDR is not first");
    first = false;
    const end = i + 12 + len;
    if (end > b.length) throw new ImageMetadataError("png: bad chunk length");
    if (!PNG_DROP.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") break; // 🔴 IEND より後ろは捨てる
  }
  return concat(parts);
}

// ---------------------------------------------------------------------------
// WebP（RIFF）
// ---------------------------------------------------------------------------

function stripWebp(b: Uint8Array): Uint8Array {
  if (b.length < 12 || !hasPrefix(b, 0, b.length, ascii("RIFF")) || !hasPrefix(b, 8, b.length, ascii("WEBP"))) {
    throw new ImageMetadataError("webp: no RIFF/WEBP header");
  }
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const riffEnd = 8 + dv.getUint32(4, true);
  if (riffEnd > b.length || riffEnd < 12) throw new ImageMetadataError("webp: bad RIFF size");
  const chunks: Uint8Array[] = [];
  let i = 12;
  while (i < riffEnd) {
    if (i + 8 > riffEnd) throw new ImageMetadataError("webp: truncated chunk");
    const fourcc = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    const size = dv.getUint32(i + 4, true);
    const end = i + 8 + size + (size & 1); // 奇数長は 1 バイト詰める
    if (end > riffEnd) throw new ImageMetadataError("webp: bad chunk length");
    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      const c = b.slice(i, end);
      // VP8X の印から EXIF（0x08）と XMP（0x04）を下ろす。残すと
      // 「あるはずの入れ物が無い」ファイルになる。
      if (fourcc === "VP8X" && size >= 1) c[8] &= ~0x0c;
      chunks.push(c);
    }
    i = end;
  }
  if (chunks.length === 0) throw new ImageMetadataError("webp: no chunks");
  const body = concat(chunks);
  const head = new Uint8Array(12);
  head.set(b.subarray(0, 12));
  new DataView(head.buffer).setUint32(4, 4 + body.length, true);
  return concat([head, body]); // 🔴 RIFF より後ろは捨てる
}

// ---------------------------------------------------------------------------
// GIF
// ---------------------------------------------------------------------------

/** 残すアプリケーション拡張（アニメーションのループ指定）。 */
const GIF_KEEP_APP = new Set(["NETSCAPE2.0", "ANIMEXTS1.0"]);

function stripGif(b: Uint8Array): Uint8Array {
  if (b.length < 13 || !hasPrefix(b, 0, b.length, ascii("GIF8"))) throw new ImageMetadataError("gif: no header");
  const parts: Uint8Array[] = [];
  const need = (n: number) => {
    if (n > b.length) throw new ImageMetadataError("gif: truncated");
  };
  // サブブロックの並び（長さ 0 で終わる）の終わりの位置。
  const skipSubBlocks = (at: number): number => {
    let j = at;
    while (true) {
      need(j + 1);
      const n = b[j];
      j += 1 + n;
      if (n === 0) return j;
    }
  };
  const colorTable = (flags: number) => ((flags & 0x80) !== 0 ? 3 * (1 << ((flags & 0x07) + 1)) : 0);

  let i = 13 + colorTable(b[10]); // ヘッダ 6 ＋ 論理画面 7 ＋ 全体の色表
  need(i);
  parts.push(b.subarray(0, i));
  while (true) {
    need(i + 1);
    const tag = b[i];
    if (tag === 0x3b) {
      parts.push(b.subarray(i, i + 1));
      break; // 🔴 終わりの印より後ろは捨てる
    }
    if (tag === 0x2c) {
      need(i + 10);
      let j = i + 10 + colorTable(b[i + 9]);
      need(j + 1);
      j = skipSubBlocks(j + 1); // LZW の最小符号長 1 バイトの後ろ
      parts.push(b.subarray(i, j));
      i = j;
      continue;
    }
    if (tag === 0x21) {
      need(i + 2);
      const label = b[i + 1];
      const end = skipSubBlocks(i + 2);
      let keep = label !== 0xfe; // コメントは落とす
      if (label === 0xff) {
        const n = b[i + 2];
        const id = n >= 11 ? String.fromCharCode(...b.subarray(i + 3, i + 14)) : "";
        keep = GIF_KEEP_APP.has(id); // XMP などは落とす
      }
      if (keep) parts.push(b.subarray(i, end));
      i = end;
      continue;
    }
    throw new ImageMetadataError("gif: unknown block");
  }
  return concat(parts);
}

// ---------------------------------------------------------------------------

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
