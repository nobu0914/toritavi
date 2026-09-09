/**
 * 🔴 **暗号化された PDF を「壊れている」と言わない**（2026-09-09）。
 *
 * 航空会社の e チケットは、所有者パスワードだけを掛けて改変を禁じた形が多い。
 * 利用者パスワードは空なので、どのビューアでも何も訊かれずに開く。
 * **2026-08-24 の `fb57a2f` から、これを弾いていた。**
 *
 * ここで固定するのは 2 つ:
 *   1. 空パスワードの暗号化 PDF は**通る**（陽性対照）
 *   2. 本当にパスワードが要るものは**通さず、正しい文言になる**（陰性対照）
 *
 * ## 検体について
 *
 * 実物（Emirates の控え）は利用者の実データなので置いていない。
 * 検体は `support/make-encrypted-pdf.mjs` で作った合成物で、
 * **中身が何かはその生成器を読めば分かる。**
 * 実物での確認は、直した日に手元で実測した（`/V 2 /R 3 /Length 128`・
 * `P=-1324`・空パスワード・3 ページ）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPdfEncryption } from "../pdf-encryption";
import { readPdfPages, REJECT_MESSAGE } from "../file-validate";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) =>
  new Uint8Array(readFileSync(join(here, "fixtures", n)));

/** 暗号化していない、素の 1 ページ PDF。 */
const PLAIN = new Uint8Array(
  Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n" +
      "trailer\n<< /Size 4 /Root 1 0 R >>\n%%EOF\n",
    "latin1",
  ),
);

test("陰性対照: 暗号化していない PDF は encrypted:false", () => {
  const r = inspectPdfEncryption(PLAIN);
  assert.equal(r.encrypted, false);
});

test("🔴 空パスワードの暗号化 PDF は「開ける」と判定する", () => {
  const r = inspectPdfEncryption(fixture("pdf-encrypted-open.pdf"));
  assert.equal(r.encrypted, true);
  assert.equal(r.encrypted && r.userPasswordEmpty, true);
  assert.equal(r.encrypted && r.revision, 3);
});

test("🔴 パスワードが要る PDF は「開けない」と判定する", () => {
  const r = inspectPdfEncryption(fixture("pdf-encrypted-locked.pdf"));
  assert.equal(r.encrypted, true);
  assert.equal(r.encrypted && r.userPasswordEmpty, false);
});

test("🔴 空パスワードの暗号化 PDF は、ページ数まで取れる（通る）", async () => {
  const r = await readPdfPages(fixture("pdf-encrypted-open.pdf"));
  assert.deepEqual(r, { pages: 1 });
});

/**
 * 🔴 **ここが今回の本体。**
 * 直す前は、暗号化 PDF がすべて `pdf_corrupt`（＝「ファイルが壊れている
 * 可能性があります」）に落ちていた。`pdf-lib` の `EncryptedPDFError` が
 * ES5 の継承で壊れており、`instanceof` が**原理的に true にならない**ため。
 */
test("🔴 パスワードが要る PDF は pdf_encrypted（「壊れている」と言わない）", async () => {
  const r = await readPdfPages(fixture("pdf-encrypted-locked.pdf"));
  assert.deepEqual(r, { error: "pdf_encrypted" });
  const msg = REJECT_MESSAGE.pdf_encrypted;
  assert.ok(msg.includes("パスワード"), `文言が違う: ${msg}`);
  assert.ok(!msg.includes("壊れている"), `壊れていると言っている: ${msg}`);
});

test("🔴 pdf-lib の EncryptedPDFError は instanceof で捕まえられない（前提の記録）", async () => {
  const lib = await import("pdf-lib");
  let caught: unknown;
  try {
    await lib.PDFDocument.load(fixture("pdf-encrypted-open.pdf"), {
      ignoreEncryption: false,
      updateMetadata: false,
    });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, "暗号化なのに例外が出ていない");
  // **この前提が崩れた（＝pdf-lib が直った）ら、ここが落ちて教えてくれる。**
  assert.equal(
    caught instanceof lib.EncryptedPDFError,
    false,
    "pdf-lib が直ったかもしれない。file-validate.ts の注記を見直すこと",
  );
});
