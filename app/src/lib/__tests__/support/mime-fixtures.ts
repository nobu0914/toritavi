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

/** 指定の大きさの PNG らしきバイト列（先頭は本物の PNG の署名と IHDR）。 */
export function fakePng(size: number): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  // 幅・高さ 100x100
  b.set([0, 0, 0, 100, 0, 0, 0, 100], 16);
  return b;
}

/** 指定の大きさの PDF らしきバイト列（判定は先頭の %PDF だけを見る）。 */
export function fakePdf(size: number): Uint8Array {
  const b = new Uint8Array(size).fill(0x20);
  b.set(new TextEncoder().encode("%PDF-1.4\n"));
  return b;
}
