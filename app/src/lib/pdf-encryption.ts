/**
 * 暗号化された PDF の「利用者パスワードが空か」を判定する。
 *
 * ## なぜ要るか（2026-09-09）
 *
 * 航空会社の e チケットは、**所有者パスワードだけを掛けて改変を禁じる**形が多い。
 * 利用者パスワードは空なので、どのビューアでも何も訊かれずに開く。
 * 実際に届いた Emirates の控えがこれだった（`/V 2 /R 3 /Length 128`・
 * 権限 `P=-1324` ＝ 印刷可・抽出可・変更不可）。
 *
 * 🔴 **2026-08-24 の `fb57a2f` で、これが読めなくなっていた。**
 * それまでは `pdfjs` に `password: ""` を渡しており、**pdfjs が内部で
 * この判定をしていた**ので通っていた。pdf-lib に替えたとき、
 * 「暗号化されているか」しか見なくなり、**開けるものまで弾いた。**
 *
 * ## なぜ pdf-lib の `ignoreEncryption: true` では足りないか
 *
 * あれは**判定を飛ばすだけ**で、復号はしない。本当にパスワードが要る PDF も
 * 「読めた」ことになり、**中身を読めないまま Claude へ送って枠を消費する。**
 * ここで持ち主のパスワードを確かめるのは、その取り違えを起こさないため。
 *
 * ## 対応している範囲
 *
 * 標準セキュリティハンドラの **R = 2 / 3 / 4**（MD5 + RC4 系の鍵導出）。
 * これは PDF 1.7 までの形で、航空券・ホテルの控えはここに収まる。
 *
 * 🔴 **R ≥ 5（AES-256）は判定しない。** `null`（分からない）を返し、
 * 呼び出し側は**パスワードが要るもの**として扱う —— フェイルクローズ。
 * 「たぶん空だろう」で通すと、読めないファイルで枠を消費する。
 * 実物に当たったら、そのときに 2.B のハッシュを実装する。
 *
 * ## 出典
 *
 * PDF 32000-1:2008 §7.6.3.3（アルゴリズム 2 = 鍵の導出）、
 * §7.6.3.4（アルゴリズム 4 / 5 = 利用者パスワードの照合）。
 */
import { createHash } from "node:crypto";

/** アルゴリズム 2 で使う 32 バイトの詰め物（仕様に定数として載っている）。 */
const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56,
  0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

export type PdfEncryption =
  | { encrypted: false }
  | {
      encrypted: true;
      /** 空パスワードで開けるか。**`null` は「判定できない」**（＝開けない扱い）。 */
      userPasswordEmpty: boolean | null;
      revision: number;
    };

/** バイト列を 1 バイト = 1 文字として読む（走査のためだけ。復元はしない）。 */
function toLatin1(b: Uint8Array): string {
  let s = "";
  // 大きいファイルでも積めるよう、少しずつ繋ぐ。
  const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) {
    s += String.fromCharCode(...b.subarray(i, i + CH));
  }
  return s;
}

/**
 * `<<` から対応する `>>` までを切り出す。
 *
 * 🔴 **文字列の中の `>>` で切らない。** `/O` と `/U` は 32 バイトの生バイト列で、
 * `>` や `)` がそのまま入りうる。正規表現の非貪欲一致だと**途中で切れる**。
 */
function sliceDict(s: string, open: number): string | null {
  let i = open + 2;
  let depth = 1;
  while (i < s.length) {
    const c = s[i];
    if (c === "(") {
      // リテラル文字列。`\` の次は必ず本文として読み飛ばす。
      let d = 1;
      i++;
      while (i < s.length && d > 0) {
        if (s[i] === "\\") i += 2;
        else {
          if (s[i] === "(") d++;
          else if (s[i] === ")") d--;
          i++;
        }
      }
      continue;
    }
    if (c === "<" && s[i + 1] === "<") {
      depth++;
      i += 2;
      continue;
    }
    if (c === "<") {
      // 16 進文字列。
      const end = s.indexOf(">", i);
      if (end < 0) return null;
      i = end + 1;
      continue;
    }
    if (c === ">" && s[i + 1] === ">") {
      depth--;
      i += 2;
      if (depth === 0) return s.slice(open, i);
      continue;
    }
    i++;
  }
  return null;
}

/** 辞書の中の `key` の値を、バイト列として取り出す（リテラルと 16 進の両方）。 */
function readString(dict: string, key: string): Uint8Array | null {
  const re = new RegExp(`${key}\\s*(\\(|<[^<])`);
  const m = re.exec(dict);
  if (!m) return null;
  const at = m.index + m[0].length - m[1].length;
  if (dict[at] === "<") {
    const end = dict.indexOf(">", at);
    if (end < 0) return null;
    const hex = dict.slice(at + 1, end).replace(/\s+/g, "");
    const out = new Uint8Array(Math.floor(hex.length / 2));
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return out;
  }
  // リテラル文字列。エスケープを戻す。
  const out: number[] = [];
  let i = at + 1;
  let depth = 1;
  while (i < dict.length) {
    const c = dict[i];
    if (c === "\\") {
      const n = dict[i + 1];
      const simple: Record<string, number> = {
        n: 10, r: 13, t: 9, b: 8, f: 12,
      };
      if (n in simple) {
        out.push(simple[n]);
        i += 2;
      } else if (n >= "0" && n <= "7") {
        let oct = "";
        i++;
        while (i < dict.length && dict[i] >= "0" && dict[i] <= "7" && oct.length < 3) {
          oct += dict[i];
          i++;
        }
        out.push(parseInt(oct, 8) & 0xff);
      } else if (n === "\n") {
        i += 2; // 行継続
      } else {
        out.push(n.charCodeAt(0));
        i += 2;
      }
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") {
      depth--;
      if (depth === 0) break;
    }
    out.push(c.charCodeAt(0) & 0xff);
    i++;
  }
  return Uint8Array.from(out);
}

function readInt(dict: string, key: string): number | null {
  const m = new RegExp(`${key}\\s*(-?\\d+)`).exec(dict);
  return m ? parseInt(m[1], 10) : null;
}

/** RC4。**復号のためではなく照合のため**にしか使わない。 */
function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  let a = 0;
  let b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 0xff;
    b = (b + s[a]) & 0xff;
    [s[a], s[b]] = [s[b], s[a]];
    out[k] = data[k] ^ s[(s[a] + s[b]) & 0xff];
  }
  return out;
}

function md5(...parts: Uint8Array[]): Uint8Array {
  const h = createHash("md5");
  for (const p of parts) h.update(p);
  return Uint8Array.from(h.digest());
}

function le32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n, true);
  return b;
}

/**
 * PDF が暗号化されているか、されているなら空パスワードで開けるかを返す。
 *
 * 🔴 **判定できないときは `userPasswordEmpty: null`。**
 * 「たぶん空」で通さない（`CLAUDE.md` §5 フェイルクローズ）。
 */
export function inspectPdfEncryption(bytes: Uint8Array): PdfEncryption {
  const s = toLatin1(bytes);

  // 暗号化辞書は「`/Filter` が `/Standard`」の辞書。まずそこを探す。
  const std = /\/Filter\s*\/Standard\b/.exec(s);
  if (!std) {
    // `/Encrypt` があるのに標準ハンドラでない＝独自の暗号化。判定できない。
    if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(s) || /\/Encrypt\s*<</.test(s)) {
      return { encrypted: true, userPasswordEmpty: null, revision: -1 };
    }
    return { encrypted: false };
  }

  // その `/Filter` を含む辞書の開き `<<` まで戻る。
  const open = s.lastIndexOf("<<", std.index);
  if (open < 0) return { encrypted: true, userPasswordEmpty: null, revision: -1 };
  const dict = sliceDict(s, open);
  if (!dict) return { encrypted: true, userPasswordEmpty: null, revision: -1 };

  const r = readInt(dict, "/R");
  const p = readInt(dict, "/P");
  const o = readString(dict, "/O");
  const u = readString(dict, "/U");
  if (r === null || p === null || !o || !u) {
    return { encrypted: true, userPasswordEmpty: null, revision: r ?? -1 };
  }
  // 🔴 R ≥ 5（AES-256）はここでは判定しない。上の注記を参照。
  if (r < 2 || r > 4) {
    return { encrypted: true, userPasswordEmpty: null, revision: r };
  }

  // 鍵の長さ。/Length はビット数（既定 40）。
  const lengthBits = r === 2 ? 40 : readInt(dict, "/Length") ?? 40;
  const n = Math.max(5, Math.min(16, Math.floor(lengthBits / 8)));

  // /ID の 1 つ目。トレーラにある（暗号化辞書の中ではない）。
  const idm = /\/ID\s*\[\s*(<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\))/.exec(s);
  const id = idm ? readString(`/X ${idm[1]}`, "/X") : new Uint8Array(0);
  if (!id) return { encrypted: true, userPasswordEmpty: null, revision: r };

  // アルゴリズム 2: 鍵を導く（利用者パスワードは空＝詰め物そのもの）。
  const metaFalse = r >= 4 && /\/EncryptMetadata\s+false/.test(dict);
  const parts = [PAD, o.subarray(0, 32), le32(p), id];
  if (metaFalse) parts.push(Uint8Array.from([0xff, 0xff, 0xff, 0xff]));
  let key = md5(...parts);
  if (r >= 3) {
    for (let i = 0; i < 50; i++) key = md5(key.subarray(0, n));
  }
  key = key.subarray(0, n);

  if (r === 2) {
    // アルゴリズム 4: RC4(鍵, 詰め物) が /U と一致するか（32 バイト全部）。
    const want = rc4(key, PAD);
    return {
      encrypted: true,
      userPasswordEmpty: eq(want, u.subarray(0, 32), 32),
      revision: r,
    };
  }

  // アルゴリズム 5: MD5(詰め物 + ID) を 20 回 RC4 に掛け、先頭 16 バイトを比べる。
  let x = rc4(key, md5(PAD, id));
  for (let i = 1; i <= 19; i++) {
    const k2 = new Uint8Array(key.length);
    for (let j = 0; j < key.length; j++) k2[j] = key[j] ^ i;
    x = rc4(k2, x);
  }
  return {
    encrypted: true,
    userPasswordEmpty: eq(x, u.subarray(0, 16), 16),
    revision: r,
  };
}

function eq(a: Uint8Array, b: Uint8Array, len: number): boolean {
  if (a.length < len || b.length < len) return false;
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) return false;
  return true;
}
