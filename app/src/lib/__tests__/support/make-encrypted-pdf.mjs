// 暗号化された PDF の検体を作る。
//
//   node src/lib/__tests__/support/make-encrypted-pdf.mjs
//
// ## なぜ合成なのか
//
// **実物を置けない。** きっかけになった Emirates の控えは利用者の実データで、
// 氏名・便名・予約番号が入っている。リポジトリに入れない。
//
// ## なぜ生成器も置くのか
//
// 検体だけ置くと、**中身が何なのか誰にも分からない箱**になる。
// ここを読めば「R=3 / 128bit / 利用者パスワードは空（または `secret`）」だと
// 分かるようにしておく。作り直せることが、検体を信用できる根拠になる。
//
// 🔴 **これは判定を試すための最小の構造で、ビューアで開ける PDF ではない。**
// ストリームを実際に暗号化していない（本文が無い）。
// `inspectPdfEncryption` が見るのは暗号化辞書と `/ID` だけなので、それで足りる。
// **実物での確認は別に行う**（作業時に手元の Emirates 控えで実測した）。
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PAD = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56,
  0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const md5 = (...p) => {
  const h = createHash("md5");
  for (const x of p) h.update(x);
  return h.digest();
};

function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  let a = 0, b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 0xff;
    b = (b + s[a]) & 0xff;
    [s[a], s[b]] = [s[b], s[a]];
    out[k] = data[k] ^ s[(s[a] + s[b]) & 0xff];
  }
  return out;
}

/** 利用者パスワードを 32 バイトに詰める（アルゴリズム 2 の入口）。 */
const padded = (pw) => Buffer.concat([Buffer.from(pw, "latin1"), PAD]).subarray(0, 32);

/** /U を作る（R = 3 のアルゴリズム 5）。 */
function makeU({ password, o, p, id, n }) {
  let key = md5(padded(password), o, int32le(p), id);
  for (let i = 0; i < 50; i++) key = md5(key.subarray(0, n));
  key = key.subarray(0, n);
  let x = rc4(key, md5(PAD, id));
  for (let i = 1; i <= 19; i++) {
    x = rc4(Buffer.from(key.map((b) => b ^ i)), x);
  }
  // 後半 16 バイトは任意（仕様どおり詰め物）。
  return Buffer.concat([x, Buffer.alloc(16, 0x00)]);
}

function int32le(n) {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n, 0);
  return b;
}

const hex = (b) => `<${Buffer.from(b).toString("hex").toUpperCase()}>`;

/** xref を正しい位置で組み立てた、1 ページの最小 PDF。 */
function buildPdf({ o, u, p, r, length, id }) {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
    `<< /Filter /Standard /V 2 /R ${r} /Length ${length} /P ${p} ` +
      `/O ${hex(o)} /U ${hex(u)} >>`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((dict, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${dict}\nendobj\n`;
  });
  const xrefAt = body.length;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  const trailer =
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Encrypt 4 0 R ` +
    `/ID [${hex(id)} ${hex(id)}] >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, "latin1");
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "fixtures");
mkdirSync(outDir, { recursive: true });

// 値は固定。**毎回同じ検体が出る**（差分がノイズにならない）。
const o = Buffer.alloc(32, 0x5a);
const id = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
const p = -1324; // 印刷可・抽出可・変更不可（実物の Emirates 控えと同じ）
const n = 16; // 128bit

for (const [name, password] of [
  ["pdf-encrypted-open.pdf", ""],        // 利用者パスワードが空＝何も訊かれず開く
  ["pdf-encrypted-locked.pdf", "secret"], // 本当にパスワードが要る
]) {
  const u = makeU({ password, o, p, id, n });
  writeFileSync(join(outDir, name), buildPdf({ o, u, p, r: 3, length: 128, id }));
  console.log(`${name}: 利用者パスワード = ${password === "" ? "（空）" : password}`);
}
