// AI へ渡す前の実体検証。**申告値ではなくバイト列を信じているか。**
//
// 攻撃者は拡張子も Content-Type も自由に決められる。ここが実体を見て
// いなければ、Polyglot（複数形式として妥当なファイル）や圧縮爆弾が通る。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { detectKind, readImageSize, validateFile } from "../file-validate.ts";

/** 最小の PNG（1x1）。IHDR まであれば寸法は読める。 */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const dv = new DataView(b.buffer);
  dv.setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  dv.setUint32(16, width);
  dv.setUint32(20, height);
  return b;
}

function gif(width: number, height: number): Uint8Array {
  const b = new Uint8Array(16);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  const dv = new DataView(b.buffer);
  dv.setUint16(6, width, true);
  dv.setUint16(8, height, true);
  return b;
}

function pdf(pageCount: number): Uint8Array {
  const kids = Array.from({ length: pageCount }, (_, i) => `${i + 3} 0 R`).join(" ");
  const pages = Array.from(
    { length: pageCount },
    (_, i) => `${i + 3} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n`,
  ).join("");
  const src =
    `%PDF-1.4\n` +
    `1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n` +
    `2 0 obj<</Type/Pages/Kids[${kids}]/Count ${pageCount}>>endobj\n` +
    pages +
    `trailer<</Root 1 0 R>>`;
  return new Uint8Array(Buffer.from(src, "latin1"));
}

describe("種別はマジックバイトだけで決める", () => {
  test("PNG / GIF / PDF を見分ける", () => {
    assert.equal(detectKind(png(10, 10)), "image/png");
    assert.equal(detectKind(gif(10, 10)), "image/gif");
    assert.equal(detectKind(pdf(1)), "application/pdf");
  });

  test("知らない先頭バイトは null（許可外形式）", () => {
    assert.equal(detectKind(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), null);
  });
});

describe("寸法はヘッダから読む", () => {
  test("PNG / GIF", () => {
    assert.deepEqual(readImageSize("image/png", png(640, 480)), { width: 640, height: 480 });
    assert.deepEqual(readImageSize("image/gif", gif(320, 200)), { width: 320, height: 200 });
  });
});

describe("拒否する条件", () => {
  test("🔴 申告 MIME と実体が違えば拒否（Polyglot / 偽装）", async () => {
    const r = await validateFile(png(10, 10), "application/pdf");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "mime_mismatch");
  });

  test("🔴 許可外の形式は拒否", async () => {
    const r = await validateFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), null);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "unsupported_format");
  });

  test("🔴 展開後が巨大な画像は拒否（圧縮爆弾）", async () => {
    // ヘッダ上は 30000×30000 = 9 億画素。バイト数は 33 バイトしかない。
    const r = await validateFile(png(30000, 30000), "image/png");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "image_dimensions");
  });

  test("🔴 寸法が読めない画像は通さない（分からないものを通さない）", async () => {
    const broken = png(10, 10).slice(0, 12); // IHDR の手前で切る
    const r = await validateFile(broken, "image/png");
    assert.equal(r.ok, false);
  });

  test("🔴 10MB 超は拒否", async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const r = await validateFile(big, "image/png");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "too_large");
  });

  test("空ファイルは拒否", async () => {
    const r = await validateFile(new Uint8Array(0), null);
    assert.equal(r.ok, false);
  });
});

describe("PDF", () => {
  test("ページ数を数えられる（20 ページ境界は通る）", async () => {
    const r = await validateFile(pdf(20), "application/pdf");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.pages, 20);
  });

  test("🔴 21 ページは拒否", async () => {
    const r = await validateFile(pdf(21), "application/pdf");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "pdf_too_many_pages");
  });

  test("🔴 壊れた PDF は拒否（AI へ渡さない）", async () => {
    const broken = new Uint8Array(Buffer.from("%PDF-1.4\nthis is not a pdf body", "latin1"));
    const r = await validateFile(broken, "application/pdf");
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.reason === "pdf_corrupt" || r.reason === "pdf_encrypted");
  });
});
