// ============================================================================
// 画像の撮影メタデータを落とす（メール転送の受信・2026-10-18 の週次検査 4-1）。
//
// 🔴 **固定するのは「落ちた」ことと「壊していない」ことの両方。**
//    落とすだけなら全部捨てれば通る。画像の本体が 1 バイトでも変われば
//    読み取れない画像を置くことになる。向きの印を失えば横倒しで AI に届く。
//
// 検体はすべて合成。位置情報の代わりに目印の文字列を埋め、出力に
// **1 バイトも残っていない**ことを見る。
// ============================================================================
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ImageMetadataError, stripImageMetadata } from "../image-metadata.ts";
import { parseInboundMail } from "../inbound-mail.ts";
import { concatBytes, fakeJpegWithGps, fakePng, multipartMail } from "./support/mime-fixtures.ts";

const SECRET = "GPS-35.6812N-139.7671E";
const enc = (s: string) => new TextEncoder().encode(s);

function contains(hay: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let k = 0; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer;
    return true;
  }
  return false;
}

/** JPEG の区切りを先頭から順に（SOS まで）。 */
function jpegMarkers(b: Uint8Array): number[] {
  const out: number[] = [];
  let i = 2;
  while (i + 4 <= b.length) {
    const m = b[i + 1];
    out.push(m);
    if (m === 0xda) break;
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return out;
}

describe("JPEG", () => {
  test("🔴 EXIF の GPS・XMP・IPTC・コメント・MPF・EOI の後ろの 2 枚目が消える", () => {
    const { bytes } = fakeJpegWithGps({ secret: SECRET });
    assert.ok(contains(bytes, enc(SECRET)), "検体に目印が入っていない");
    const out = stripImageMetadata("image/jpeg", bytes);
    assert.equal(contains(out, enc(SECRET)), false, "位置情報（の目印）が残っている");
    assert.equal(contains(out, enc("Exif")), false, "向きが 1 なら EXIF ごと要らない");
  });

  test("🔴 画像の本体は 1 バイトも変えない（詰め物 FF00・RST を含む）", () => {
    const { bytes, scan } = fakeJpegWithGps({ secret: SECRET });
    const out = stripImageMetadata("image/jpeg", bytes);
    assert.ok(contains(out, scan), "本体が変わった");
    assert.deepEqual([...out.subarray(-2)], [0xff, 0xd9], "EOI で終わる");
    // 残すのは JFIF・ICC・DQT・SOF・DHT・SOS だけ（この順）。
    assert.deepEqual(jpegMarkers(out), [0xe0, 0xe2, 0xdb, 0xc0, 0xc4, 0xda]);
    assert.ok(contains(out, enc("ICC_PROFILE\0")), "色の情報は残す");
  });

  test("🔴 向きの印（2〜8）は、その 1 項目だけの EXIF にして APP0 の直後へ戻す", () => {
    const { bytes } = fakeJpegWithGps({ secret: SECRET, orientation: 6 });
    const out = stripImageMetadata("image/jpeg", bytes);
    assert.equal(contains(out, enc(SECRET)), false);
    assert.deepEqual(jpegMarkers(out).slice(0, 2), [0xe0, 0xe1]);
    // APP1 の中身: Exif\0\0 + MM + IFD0 に 0x0112 = 6 の 1 項目だけ。
    const app1 = 2 + 2 + ((out[4] << 8) | out[5]);
    const seg = out.subarray(app1, app1 + 36);
    assert.deepEqual([...seg.subarray(0, 4)], [0xff, 0xe1, 0x00, 0x22]);
    assert.deepEqual([...seg.subarray(4, 10)], [...enc("Exif\0\0")]);
    assert.deepEqual([...seg.subarray(18, 20)], [0x00, 0x01], "項目は 1 つ");
    assert.deepEqual([...seg.subarray(20, 22)], [0x01, 0x12], "Orientation");
    assert.deepEqual([...seg.subarray(28, 30)], [0x00, 0x06], "値は元のまま 6");
  });

  test("EOI が無いまま切れた JPEG も、区切りは落として本体は残す", () => {
    const { bytes, scan } = fakeJpegWithGps({ secret: SECRET });
    // 1 枚目の EOI の手前で切る
    let cut = 0;
    for (let i = 2; i + 1 < bytes.length; i++) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
        cut = i;
        break;
      }
    }
    assert.ok(cut > 0);
    const out = stripImageMetadata("image/jpeg", bytes.subarray(0, cut));
    assert.equal(contains(out, enc(SECRET)), false);
    assert.ok(contains(out, scan));
  });

  test("🔴 辿れない JPEG は投げる（置かない）", () => {
    assert.throws(() => stripImageMetadata("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff])), ImageMetadataError);
    // 区切りの長さが末尾を越える
    assert.throws(
      () => stripImageMetadata("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, 1, 2])),
      ImageMetadataError,
    );
    // 画像の本体（SOS）が無い
    assert.throws(
      () => stripImageMetadata("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9])),
      ImageMetadataError,
    );
  });
});

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(enc(type), 4);
  out.set(data, 8);
  return out;
}

function pngTypes(b: Uint8Array): string[] {
  const out: string[] = [];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = new DataView(b.buffer, b.byteOffset).getUint32(i);
    out.push(String.fromCharCode(...b.subarray(i + 4, i + 8)));
    i += 12 + len;
  }
  return out;
}

describe("PNG", () => {
  test("🔴 eXIf・tEXt・zTXt・iTXt（XMP）・tIME と IEND の後ろが消え、残りはそのまま", () => {
    const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = pngChunk("IHDR", new Uint8Array(13));
    const idat = pngChunk("IDAT", new Uint8Array([1, 2, 3, 4, 5]));
    const iend = pngChunk("IEND", new Uint8Array(0));
    const png = concatBytes(
      sig,
      ihdr,
      pngChunk("eXIf", enc(`MM\0*${SECRET}`)),
      pngChunk("iTXt", enc(`XML:com.adobe.xmp\0\0\0\0\0${SECRET}`)),
      pngChunk("tEXt", enc(`Comment\0${SECRET}`)),
      pngChunk("zTXt", enc(`Raw\0\0${SECRET}`)),
      pngChunk("tIME", new Uint8Array(7)),
      idat,
      iend,
      enc(SECRET),
    );
    const out = stripImageMetadata("image/png", png);
    assert.equal(contains(out, enc(SECRET)), false);
    assert.deepEqual(pngTypes(out), ["IHDR", "IDAT", "IEND"]);
    assert.deepEqual(out, concatBytes(sig, ihdr, idat, iend), "残したチャンクはバイトごと同じ");
  });

  test("メタデータが無ければ入力と同じバイト列", () => {
    const png = fakePng(3000);
    assert.deepEqual(stripImageMetadata("image/png", png), png);
  });

  test("🔴 辿れない PNG は投げる", () => {
    const broken = fakePng(3000).slice(0, 50); // IDAT の途中で切れている
    assert.throws(() => stripImageMetadata("image/png", broken), ImageMetadataError);
  });
});

function riff(chunks: Uint8Array[]): Uint8Array {
  const body = concatBytes(enc("WEBP"), ...chunks);
  const head = new Uint8Array(8);
  head.set(enc("RIFF"));
  new DataView(head.buffer).setUint32(4, body.length, true);
  return concatBytes(head, body);
}

function webpChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const pad = data.length & 1;
  const out = new Uint8Array(8 + data.length + pad);
  out.set(enc(fourcc));
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

describe("WebP", () => {
  test("🔴 EXIF・XMP チャンクが消え、VP8X の印と RIFF の大きさが合う", () => {
    const vp8x = new Uint8Array(10);
    vp8x[0] = 0x0c | 0x20; // EXIF・XMP・ICC
    const image = webpChunk("VP8 ", new Uint8Array([9, 8, 7, 6, 5]));
    const webp = concatBytes(
      riff([
        webpChunk("VP8X", vp8x),
        webpChunk("ICCP", new Uint8Array([1, 2])),
        image,
        webpChunk("EXIF", enc(`MM\0*${SECRET}`)),
        webpChunk("XMP ", enc(SECRET)),
      ]),
      enc(SECRET), // RIFF の後ろ
    );
    const out = stripImageMetadata("image/webp", webp);
    assert.equal(contains(out, enc(SECRET)), false);
    const dv = new DataView(out.buffer, out.byteOffset);
    assert.equal(dv.getUint32(4, true), out.length - 8, "RIFF の大きさ");
    assert.equal(out[20], 0x20, "EXIF・XMP の印は下ろし、ICC の印は残す");
    assert.ok(contains(out, image), "画像のチャンクはそのまま");
  });

  test("🔴 辿れない WebP は投げる", () => {
    const bad = riff([webpChunk("VP8 ", new Uint8Array(4))]);
    new DataView(bad.buffer).setUint32(16, 999, true); // チャンクの長さが RIFF を越える
    assert.throws(() => stripImageMetadata("image/webp", bad), ImageMetadataError);
  });
});

describe("GIF", () => {
  test("🔴 コメントと XMP の拡張が消え、ループ指定と画像は残る", () => {
    const header = concatBytes(enc("GIF89a"), new Uint8Array([1, 0, 1, 0, 0x80, 0, 0]), new Uint8Array(6));
    const loop = concatBytes(new Uint8Array([0x21, 0xff, 11]), enc("NETSCAPE2.0"), new Uint8Array([3, 1, 0, 0, 0]));
    const image = new Uint8Array([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0]);
    const gif = concatBytes(
      header,
      new Uint8Array([0x21, 0xfe, SECRET.length]),
      enc(SECRET),
      new Uint8Array([0]),
      new Uint8Array([0x21, 0xff, 11]),
      enc("XMP DataXMP"),
      new Uint8Array([SECRET.length]),
      enc(SECRET),
      new Uint8Array([0]),
      loop,
      image,
      new Uint8Array([0x3b]),
      enc(SECRET),
    );
    const out = stripImageMetadata("image/gif", gif);
    assert.equal(contains(out, enc(SECRET)), false);
    assert.deepEqual(out, concatBytes(header, loop, image, new Uint8Array([0x3b])));
  });
});

describe("🔴 受信（parseInboundMail）が置くもの", () => {
  test("転送された写真は、位置情報を落としてから置く", async () => {
    const { bytes } = fakeJpegWithGps({ secret: SECRET, orientation: 6, padTo: 80 * 1024 });
    const raw = multipartMail({
      from: "a@example.com",
      subject: "写真",
      text: "写真です",
      parts: [{ contentType: "image/jpeg", disposition: 'attachment; filename="IMG_0001.JPG"', bytes }],
    });
    const mail = await parseInboundMail(raw);
    assert.equal(mail.attachments.length, 1);
    const stored = mail.attachments[0].bytes;
    assert.equal(contains(stored, enc(SECRET)), false, "🔴 位置情報がサーバに置かれる");
    assert.deepEqual(jpegMarkers(stored).slice(0, 2), [0xe0, 0xe1], "向きの印は残る");
  });

  test("🔴 辿れない画像は置かない（数えて捨てる）", async () => {
    const broken = new Uint8Array(80 * 1024).fill(0x11);
    broken.set([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]); // 長さが末尾を越える APP1
    const raw = multipartMail({
      from: "a@example.com",
      subject: "写真",
      text: "写真です",
      parts: [{ contentType: "image/jpeg", disposition: 'attachment; filename="IMG_0002.JPG"', bytes: broken }],
    });
    const mail = await parseInboundMail(raw);
    assert.equal(mail.attachments.length, 0);
    assert.equal(mail.skipped.unstrippable, 1);
  });

  test("PDF には触らない", async () => {
    const pdf = concatBytes(enc("%PDF-1.4\n"), new Uint8Array(4000).fill(0x20));
    const raw = multipartMail({
      from: "a@example.com",
      subject: "予約票",
      text: "予約票",
      parts: [{ contentType: "application/pdf", disposition: 'attachment; filename="booking.pdf"', bytes: pdf }],
    });
    const mail = await parseInboundMail(raw);
    assert.deepEqual(mail.attachments[0].bytes, pdf);
  });
});
