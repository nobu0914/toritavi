/**
 * メールの検体を組み立てる道具（`inbound-mail*.test.ts` 用）。
 *
 * 🔴 **実物の予約メールは置かない**（氏名・予約番号が入る）。全部ここで合成する。
 *
 * Node には ISO-2022-JP / Shift_JIS の**符号化器が無い**（TextDecoder は
 * 復号だけ）。そこで、JIS X 0208 の 2 バイトを総当たりで**復号して**
 * 「文字 → バイト」の表を作る。復号器そのものを鏡にするので、
 * 表の写し間違いが起きない。
 */

let jisTable: Map<string, [number, number]> | null = null;
let sjisTable: Map<string, [number, number]> | null = null;

function buildJis(): Map<string, [number, number]> {
  const dec = new TextDecoder("iso-2022-jp");
  const m = new Map<string, [number, number]>();
  for (let a = 0x21; a <= 0x7e; a++) {
    for (let b = 0x21; b <= 0x7e; b++) {
      const s = dec.decode(new Uint8Array([0x1b, 0x24, 0x42, a, b, 0x1b, 0x28, 0x42]));
      if (s.length === 1 && s !== "�" && !m.has(s)) m.set(s, [a, b]);
    }
  }
  return m;
}

function buildSjis(): Map<string, [number, number]> {
  const dec = new TextDecoder("shift_jis");
  const m = new Map<string, [number, number]>();
  const leads = [];
  for (let a = 0x81; a <= 0x9f; a++) leads.push(a);
  for (let a = 0xe0; a <= 0xef; a++) leads.push(a);
  for (const a of leads) {
    for (let b = 0x40; b <= 0xfc; b++) {
      if (b === 0x7f) continue;
      const s = dec.decode(new Uint8Array([a, b]));
      if (s.length === 1 && s !== "�" && !m.has(s)) m.set(s, [a, b]);
    }
  }
  return m;
}

/** 文字列を ISO-2022-JP（7bit）にする。ASCII 以外は JIS X 0208 にある字だけ。 */
export function encodeIso2022jp(s: string): Uint8Array {
  jisTable ??= buildJis();
  const out: number[] = [];
  let kanji = false;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) {
      if (kanji) {
        out.push(0x1b, 0x28, 0x42);
        kanji = false;
      }
      out.push(c);
      continue;
    }
    const pair = jisTable.get(ch);
    if (!pair) throw new Error(`JIS X 0208 に無い字: ${ch}`);
    if (!kanji) {
      out.push(0x1b, 0x24, 0x42);
      kanji = true;
    }
    out.push(pair[0], pair[1]);
  }
  if (kanji) out.push(0x1b, 0x28, 0x42);
  return new Uint8Array(out);
}

/** 文字列を Shift_JIS にする。 */
export function encodeShiftJis(s: string): Uint8Array {
  sjisTable ??= buildSjis();
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) {
      out.push(c);
      continue;
    }
    const pair = sjisTable.get(ch);
    if (!pair) throw new Error(`Shift_JIS に無い字: ${ch}`);
    out.push(pair[0], pair[1]);
  }
  return new Uint8Array(out);
}

/** RFC 2047 の B 符号化（`=?charset?B?...?=`）。 */
export function encodedWord(charset: string, bytes: Uint8Array): string {
  return `=?${charset}?B?${Buffer.from(bytes).toString("base64")}?=`;
}

/** 文字列（UTF-8 で書く・RFC 6532 の生の UTF-8 ヘッダも作れる）とバイト列をつなぐ。 */
export function concatBytes(...parts: Array<string | Uint8Array>): Uint8Array {
  const bufs = parts.map((p) =>
    typeof p === "string" ? Buffer.from(p, "utf8") : Buffer.from(p),
  );
  return new Uint8Array(Buffer.concat(bufs));
}

/** base64 を 76 桁で折り返す（MIME の作法）。 */
export function b64(bytes: Uint8Array): string {
  return (Buffer.from(bytes).toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

export type Part = {
  contentType: string;
  /** 例: `attachment; filename="x.pdf"` */
  disposition?: string;
  contentId?: string;
  bytes: Uint8Array;
};

/** multipart/mixed のメールを組み立てる（添付は base64）。 */
export function multipartMail(opts: {
  from: string;
  subject: string;
  text?: string;
  html?: string;
  parts?: Part[];
  /** 付けると `Message-ID: <…>` ヘッダを足す。 */
  messageId?: string;
}): Uint8Array {
  const boundary = "----junros-test-boundary";
  const alt = "----junros-test-alt";
  const chunks: Array<string | Uint8Array> = [
    `From: ${opts.from}\r\n`,
    "To: trips-abcdefghijkmnpqr@junros.com\r\n",
    `Subject: ${opts.subject}\r\n`,
    ...(opts.messageId ? [`Message-ID: <${opts.messageId}>\r\n`] : []),
    "MIME-Version: 1.0\r\n",
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`,
  ];
  if (opts.text != null || opts.html != null) {
    chunks.push(`--${boundary}\r\n`, `Content-Type: multipart/alternative; boundary="${alt}"\r\n\r\n`);
    if (opts.text != null) {
      chunks.push(
        `--${alt}\r\n`,
        "Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n",
        b64(new TextEncoder().encode(opts.text)),
        "\r\n",
      );
    }
    if (opts.html != null) {
      chunks.push(
        `--${alt}\r\n`,
        "Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n",
        b64(new TextEncoder().encode(opts.html)),
        "\r\n",
      );
    }
    chunks.push(`--${alt}--\r\n`);
  }
  for (const p of opts.parts ?? []) {
    chunks.push(`--${boundary}\r\n`, `Content-Type: ${p.contentType}\r\n`);
    if (p.disposition) chunks.push(`Content-Disposition: ${p.disposition}\r\n`);
    if (p.contentId) chunks.push(`Content-ID: <${p.contentId}>\r\n`);
    chunks.push("Content-Transfer-Encoding: base64\r\n\r\n", b64(p.bytes), "\r\n");
  }
  chunks.push(`--${boundary}--\r\n`);
  return concatBytes(...chunks);
}

/**
 * 指定の大きさの PNG らしきバイト列。**チャンクの並びは本物と同じ**
 * （署名・IHDR 100x100・IDAT・IEND）で、中身と CRC は 0。
 *
 * 🔴 並びを本物にしてあるのは、受信が画像を**チャンク単位で辿って**撮影
 *    メタデータを落とすから（`image-metadata.ts`）。辿れない画像は置かない。
 *    57 バイト未満は並びを作れないので、署名と IHDR の頭だけ（小さすぎる
 *    画像として先に捨てられる検体）。
 */
export function fakePng(size: number): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  // 幅・高さ 100x100
  b.set([0, 0, 0, 100, 0, 0, 0, 100], 16);
  const idat = size - 8 - 25 - 12 - 12;
  if (idat < 0) return b;
  const dv = new DataView(b.buffer);
  dv.setUint32(33, idat);
  b.set([0x49, 0x44, 0x41, 0x54], 37); // IDAT
  const iend = 33 + 12 + idat;
  dv.setUint32(iend, 0);
  b.set([0x49, 0x45, 0x4e, 0x44], iend + 4); // IEND
  return b;
}

/**
 * 撮影メタデータ入りの JPEG（合成）。EXIF に向き [orientation] と GPS、
 * XMP・IPTC・コメント・EOI の後ろの 2 枚目（MPF の形）に [secret] を埋める。
 * 画像の本体（[scan]）は 0xFF 00 の詰め物と RST を含む。
 */
export function fakeJpegWithGps(opts: {
  secret: string;
  orientation?: number;
  scan?: Uint8Array;
  padTo?: number;
}): { bytes: Uint8Array; scan: Uint8Array } {
  const enc = (s: string) => new TextEncoder().encode(s);
  const seg = (marker: number, data: Uint8Array) => {
    const out = new Uint8Array(4 + data.length);
    out.set([0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff]);
    out.set(data, 4);
    return out;
  };
  // TIFF（II）: IFD0 = [Orientation, GPSInfo → GPS IFD]、GPS IFD に緯度の文字列。
  const s = enc(opts.secret);
  const tiff = new Uint8Array(8 + 2 + 24 + 4 + 2 + 12 + 4 + s.length);
  const t = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00]);
  t.setUint32(4, 8, true);
  t.setUint16(8, 2, true);
  t.setUint16(10, 0x0112, true); // Orientation
  t.setUint16(12, 3, true);
  t.setUint32(14, 1, true);
  t.setUint16(18, opts.orientation ?? 1, true);
  t.setUint16(22, 0x8825, true); // GPSInfo
  t.setUint16(24, 4, true);
  t.setUint32(26, 1, true);
  const gps = 8 + 2 + 24 + 4;
  t.setUint32(30, gps, true);
  t.setUint32(34, 0, true);
  t.setUint16(gps, 1, true);
  t.setUint16(gps + 2, 0x0002, true); // GPSLatitude（ここでは文字列で代用）
  t.setUint16(gps + 4, 2, true);
  t.setUint32(gps + 6, s.length, true);
  t.setUint32(gps + 10, gps + 2 + 12 + 4, true);
  tiff.set(s, gps + 2 + 12 + 4);
  const exif = concatBytes(enc("Exif\0\0"), tiff);
  const scan =
    opts.scan ?? new Uint8Array([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78, 0x9a]);
  const parts = [
    new Uint8Array([0xff, 0xd8]),
    seg(0xe0, concatBytes(enc("JFIF\0"), new Uint8Array([1, 1, 0, 0, 1, 0, 1, 0, 0]))),
    seg(0xe1, exif),
    seg(0xe1, enc(`http://ns.adobe.com/xap/1.0/\0<x:xmpmeta exif:GPSLatitude="${opts.secret}"/>`)),
    seg(0xe2, enc(`MPF\0${opts.secret}`)),
    seg(0xe2, concatBytes(enc("ICC_PROFILE\0"), new Uint8Array([1, 1, 9, 9]))),
    seg(0xed, enc(`Photoshop 3.0\0${opts.secret}`)),
    seg(0xfe, enc(`comment ${opts.secret}`)),
    seg(0xdb, new Uint8Array(65)), // DQT
    seg(0xc0, new Uint8Array([8, 0, 16, 0, 16, 1, 1, 0x11, 0])), // SOF0 16x16
    seg(0xc4, new Uint8Array(20)), // DHT
    seg(0xda, new Uint8Array([1, 1, 0, 0, 63, 0])), // SOS
    scan,
    new Uint8Array([0xff, 0xd9]), // EOI
    // MPF の 2 枚目（EOI の後ろ）
    new Uint8Array([0xff, 0xd8]),
    seg(0xe1, concatBytes(enc("Exif\0\0"), enc(opts.secret))),
    new Uint8Array([0xff, 0xd9]),
  ];
  const bytes = concatBytes(...parts);
  if (opts.padTo && bytes.length < opts.padTo) {
    // 大きさを稼ぐのは画像の本体の中（詰め物にしないと構造が変わる）。
    const extra = new Uint8Array(opts.padTo - bytes.length).fill(0x11);
    return fakeJpegWithGps({ ...opts, padTo: undefined, scan: concatBytes(scan, extra) });
  }
  return { bytes, scan };
}

/** 指定の大きさの PDF らしきバイト列（判定は先頭の %PDF だけを見る）。 */
export function fakePdf(size: number): Uint8Array {
  const b = new Uint8Array(size).fill(0x20);
  b.set(new TextEncoder().encode("%PDF-1.4\n"));
  return b;
}
