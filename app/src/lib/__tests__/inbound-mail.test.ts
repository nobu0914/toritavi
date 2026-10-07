// ============================================================================
// メール転送の受信 —— 署名・宛先・MIME・本文・添付・Gmail の転送確認。
//
// 🔴 **ここは「出ないのに落ちない」が起きやすい場所**（CLAUDE.md §6-1）。
//    文字化けしても、添付を全部捨てても、例外は出ない。受信箱に
//    空の行が並ぶだけ。だから**取れた中身そのもの**を固定する。
//
// 検体はすべて合成（support/mime-fixtures.ts）。実物の予約メールは置かない。
// ============================================================================
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";

import {
  INBOUND_MAX_BYTES,
  MAX_INBOX_ATTACHMENTS,
  SIGNATURE_MAX_SKEW_SEC,
  extractAliasToken,
  extractGmailForwardCode,
  htmlToText,
  inboundMessageKey,
  parseInboundMail,
  signInbound,
  truncateCodePoints,
  verifyInboundSignature,
} from "../inbound-mail.ts";
import { MAX_TEXT_CHARS } from "../ocr-limits.ts";
import {
  concatBytes,
  encodeIso2022jp,
  encodeShiftJis,
  encodedWord,
  fakePdf,
  fakePng,
  multipartMail,
} from "./support/mime-fixtures.ts";

const SECRET = "test-inbound-secret";
const TO = "trips-abcdefghijkmnpqr@junros.com";

// ---------------------------------------------------------------------------
describe("署名", () => {
  const now = 1_800_000_000;
  const base = (over: Partial<Parameters<typeof verifyInboundSignature>[0]> = {}) => {
    const ts = String(now);
    return {
      secret: SECRET,
      timestamp: ts,
      to: TO,
      from: "sender@example.com",
      signature: signInbound(SECRET, ts, TO, "sender@example.com", 1234),
      bodyByteLength: 1234,
      nowSec: now,
      ...over,
    };
  };

  test("正しい署名は通る", () => {
    assert.deepEqual(verifyInboundSignature(base()), { ok: true });
  });

  test("大文字の hex でも通る", () => {
    const b = base();
    assert.deepEqual(
      verifyInboundSignature({ ...b, signature: b.signature!.toUpperCase() }),
      { ok: true },
    );
  });

  test("🔴 秘密が無ければ通さない（フェイルクローズ）", () => {
    assert.deepEqual(verifyInboundSignature(base({ secret: undefined })), {
      ok: false,
      reason: "no_secret",
    });
    assert.deepEqual(verifyInboundSignature(base({ secret: "" })), {
      ok: false,
      reason: "no_secret",
    });
  });

  test("別の秘密で作った署名は通らない", () => {
    const ts = String(now);
    const r = verifyInboundSignature(
      base({ signature: signInbound("other", ts, TO, "sender@example.com", 1234) }),
    );
    assert.deepEqual(r, { ok: false, reason: "mismatch" });
  });

  test("🔴 本文の長さが違えば通らない（長さは受け取った実物で数える）", () => {
    assert.deepEqual(verifyInboundSignature(base({ bodyByteLength: 1235 })), {
      ok: false,
      reason: "mismatch",
    });
  });

  test("🔴 宛先を書き換えたら通らない（別の人の受信箱へ入れられない）", () => {
    assert.deepEqual(
      verifyInboundSignature(base({ to: "trips-zzzzzzzzzzzzzzzz@junros.com" })),
      { ok: false, reason: "mismatch" },
    );
  });

  test("時刻のずれが 300 秒を超えたら通らない", () => {
    const ts = String(now - SIGNATURE_MAX_SKEW_SEC - 1);
    const r = verifyInboundSignature(
      base({ timestamp: ts, signature: signInbound(SECRET, ts, TO, "sender@example.com", 1234) }),
    );
    assert.deepEqual(r, { ok: false, reason: "skew" });
    const ts2 = String(now - SIGNATURE_MAX_SKEW_SEC);
    assert.deepEqual(
      verifyInboundSignature(
        base({ timestamp: ts2, signature: signInbound(SECRET, ts2, TO, "sender@example.com", 1234) }),
      ),
      { ok: true },
    );
  });

  test("ヘッダが欠けていたら通らない／送信元が空（バウンス）は通る", () => {
    assert.equal(verifyInboundSignature(base({ timestamp: null })).ok, false);
    assert.equal(verifyInboundSignature(base({ to: null })).ok, false);
    assert.equal(verifyInboundSignature(base({ from: null })).ok, false);
    assert.equal(verifyInboundSignature(base({ signature: null })).ok, false);
    const ts = String(now);
    assert.deepEqual(
      verifyInboundSignature(base({ from: "", signature: signInbound(SECRET, ts, TO, "", 1234) })),
      { ok: true },
    );
  });

  test("形の崩れた署名・時刻は通らない", () => {
    assert.deepEqual(verifyInboundSignature(base({ signature: "abc" })), {
      ok: false,
      reason: "bad_format",
    });
    assert.deepEqual(verifyInboundSignature(base({ timestamp: "12a" })), {
      ok: false,
      reason: "bad_format",
    });
  });
});

// ---------------------------------------------------------------------------
describe("宛先 → トークン", () => {
  test("正しい形からトークンを取り出す", () => {
    assert.equal(extractAliasToken(TO, "junros.com"), "abcdefghijkmnpqr");
  });

  test("ドメインは大文字小文字を区別しない", () => {
    assert.equal(
      extractAliasToken("trips-abcdefghijkmnpqr@JUNROS.com", "junros.com"),
      "abcdefghijkmnpqr",
    );
  });

  test("🔴 トークンは区別する（発行は小文字だけ）", () => {
    assert.equal(extractAliasToken("trips-ABCDEFGHIJKMNPQR@junros.com", "junros.com"), null);
  });

  test("使わない文字（l / o / 0 / 1）・長さ違い・別ドメインは null", () => {
    for (const bad of [
      "trips-abcdefghijklmnpq@junros.com", // l
      "trips-abcdefghijkmnopq@junros.com", // o
      "trips-abcdefghijkmnp0q@junros.com", // 0
      "trips-abcdefghijkmnp1q@junros.com", // 1
      "trips-abcdefghijkmnpq@junros.com", // 15
      "trips-abcdefghijkmnpqrs@junros.com", // 17
      "trips-abcdefghijkmnpqr@junros.co",
      "trips-abcdefghijkmnpqr@in.junros.com",
      "trips-abcdefghijkmnpqr@junros.com.evil.example",
      "x-trips-abcdefghijkmnpqr@junros.com",
      "abcdefghijkmnpqr@junros.com",
      "",
    ]) {
      assert.equal(extractAliasToken(bad, "junros.com"), null, bad);
    }
    assert.equal(extractAliasToken(null, "junros.com"), null);
  });

  test("環境変数 MAIL_IMPORT_DOMAIN が既定を置き換える", () => {
    const prev = process.env.MAIL_IMPORT_DOMAIN;
    try {
      process.env.MAIL_IMPORT_DOMAIN = "example.test";
      assert.equal(extractAliasToken("trips-abcdefghijkmnpqr@example.test"), "abcdefghijkmnpqr");
      assert.equal(extractAliasToken(TO), null);
      delete process.env.MAIL_IMPORT_DOMAIN;
      assert.equal(extractAliasToken(TO), "abcdefghijkmnpqr");
    } finally {
      if (prev === undefined) delete process.env.MAIL_IMPORT_DOMAIN;
      else process.env.MAIL_IMPORT_DOMAIN = prev;
    }
  });
});

// ---------------------------------------------------------------------------
describe("日本語の文字コード", () => {
  test("🔴 ISO-2022-JP の件名と本文が読める", async () => {
    const subject = "【予約確認】東京発 那覇行き 搭乗のご案内";
    const body = "お客様のご予約が確定しました。\r\n便名：ＪＬ９０３\r\n出発：羽田空港\r\n";
    const raw = concatBytes(
      "From: =?ISO-2022-JP?B?",
      Buffer.from(encodeIso2022jp("予約センター")).toString("base64"),
      "?= <booking@airline.example>\r\n",
      `To: ${TO}\r\n`,
      `Subject: ${encodedWord("ISO-2022-JP", encodeIso2022jp(subject))}\r\n`,
      "MIME-Version: 1.0\r\n",
      "Content-Type: text/plain; charset=ISO-2022-JP\r\n",
      "Content-Transfer-Encoding: 7bit\r\n\r\n",
      encodeIso2022jp(body),
    );
    const m = await parseInboundMail(raw);
    assert.equal(m.subject, subject);
    assert.equal(m.fromAddress, "booking@airline.example");
    assert.equal(m.bodySource, "plain");
    assert.ok(m.bodyText?.includes("便名：ＪＬ９０３"), m.bodyText ?? "(null)");
    assert.ok(m.bodyText?.includes("羽田空港"));
    assert.equal(m.status, "pending");
  });

  test("🔴 Shift_JIS の本文（quoted-printable ではなく 8bit）が読める", async () => {
    const body = "ご宿泊日：2026年11月3日\nホテル名：那覇ベイホテル\n";
    const raw = concatBytes(
      "From: hotel@example.jp\r\n",
      `Subject: ${encodedWord("Shift_JIS", encodeShiftJis("ご予約内容の確認"))}\r\n`,
      "Content-Type: text/plain; charset=Shift_JIS\r\n",
      "Content-Transfer-Encoding: 8bit\r\n\r\n",
      encodeShiftJis(body),
    );
    const m = await parseInboundMail(raw);
    assert.equal(m.subject, "ご予約内容の確認");
    assert.ok(m.bodyText?.includes("那覇ベイホテル"), m.bodyText ?? "(null)");
    assert.ok(m.bodyText?.includes("2026年11月3日"));
  });
});

// ---------------------------------------------------------------------------
describe("本文", () => {
  test("text/plain があればそちらを使う", async () => {
    const m = await parseInboundMail(
      multipartMail({
        from: "a@example.com",
        subject: "x",
        text: "PLAIN 本文",
        html: "<p>HTML 本文</p>",
      }),
    );
    assert.equal(m.bodySource, "plain");
    assert.equal(m.bodyText, "PLAIN 本文");
  });

  test("🔴 HTML だけなら、style・script・リンク先を落としてテキストにする", async () => {
    const html =
      "<html><head><style>.x{color:red}</style><title>t</title></head><body>" +
      "<script>track()</script><p>ご予約番号&nbsp;:&nbsp;ABC123</p>" +
      '<a href="https://tracker.example/click?id=999">こちら</a>' +
      "<table><tr><td>出発</td><td>10:30</td></tr></table>" +
      '<img src="https://tracker.example/pixel.gif">&amp;&#x3042;&#12354;</body></html>';
    const m = await parseInboundMail(multipartMail({ from: "a@example.com", subject: "x", html }));
    assert.equal(m.bodySource, "html");
    const t = m.bodyText ?? "";
    assert.ok(t.includes("ご予約番号 : ABC123"), t);
    assert.ok(t.includes("出発 10:30"), t);
    assert.ok(t.includes("こちら"));
    assert.ok(t.includes("&ああ"), t);
    for (const bad of ["color:red", "track()", "tracker.example", "pixel.gif", "<"]) {
      assert.ok(!t.includes(bad), `残っている: ${bad}`);
    }
  });

  test("🔴 20,000 文字（MAX_TEXT_CHARS）で切る・code point で数える", async () => {
    const long = "😀".repeat(MAX_TEXT_CHARS + 10);
    const m = await parseInboundMail(
      multipartMail({ from: "a@example.com", subject: "x", text: long }),
    );
    assert.equal(Array.from(m.bodyText ?? "").length, MAX_TEXT_CHARS);
    assert.ok(!m.bodyText!.endsWith("\ud83d"), "サロゲートを割っている");
  });

  test("🔴 NUL を落とす（Postgres の text は U+0000 で insert ごと失敗する）", async () => {
    const m = await parseInboundMail(
      multipartMail({ from: "a@example.com", subject: "a\u0000b", text: "x\u0000y" }),
    );
    assert.equal(m.bodyText, "xy");
    assert.ok(!m.subject?.includes("\u0000"));
  });

  test("件名は 300 文字で切る", async () => {
    const m = await parseInboundMail(
      multipartMail({ from: "a@example.com", subject: "あ".repeat(400), text: "x" }),
    );
    assert.equal(Array.from(m.subject ?? "").length, 300);
  });

  test("htmlToText は閉じタグの無い要素が大量でも線形で終わる", () => {
    const evil = "<style>".repeat(50_000) + "x".repeat(1000);
    const t0 = Date.now();
    htmlToText(evil);
    htmlToText("<script ".repeat(50_000));
    htmlToText("<!--".repeat(50_000));
    assert.ok(Date.now() - t0 < 2000, `遅すぎる: ${Date.now() - t0} ms`);
  });

  test("truncateCodePoints は上限以内ならそのまま返す", () => {
    assert.equal(truncateCodePoints("abc", 3), "abc");
    assert.equal(truncateCodePoints("abcd", 3), "abc");
  });
});

// ---------------------------------------------------------------------------
describe("添付", () => {
  test("🔴 PDF と画像を残し、それ以外を捨てる（申告ではなく先頭バイトで）", async () => {
    const m = await parseInboundMail(
      multipartMail({
        from: "a@example.com",
        subject: "x",
        text: "本文",
        parts: [
          { contentType: "application/pdf", disposition: 'attachment; filename="eticket.pdf"', bytes: fakePdf(5000) },
          // 申告は PDF だが中身は PNG → PNG として残す
          { contentType: "application/pdf", disposition: 'attachment; filename="photo.pdf"', bytes: fakePng(80_000) },
          // 申告は画像だが中身はただの文字 → 捨てる
          { contentType: "image/png", disposition: 'attachment; filename="x.png"', bytes: new TextEncoder().encode("not an image".repeat(500)) },
          { contentType: "application/zip", disposition: 'attachment; filename="a.zip"', bytes: new Uint8Array([0x50, 0x4b, 3, 4, ...new Array(3000).fill(0)]) },
        ],
      }),
    );
    assert.deepEqual(
      m.attachments.map((a) => [a.mime, a.ext, a.name]),
      [
        ["application/pdf", "pdf", "eticket.pdf"],
        ["image/png", "png", "photo.pdf"],
      ],
    );
    assert.equal(m.skipped.unsupported, 2);
  });

  test("🔴 追跡用の小さな画像・本文の飾り（cid / inline の小さな画像）は捨てる", async () => {
    const m = await parseInboundMail(
      multipartMail({
        from: "a@example.com",
        subject: "x",
        html: '<img src="cid:logo1">本文',
        parts: [
          { contentType: "image/png", disposition: "attachment", bytes: fakePng(500) },
          { contentType: "image/png", disposition: "inline", contentId: "logo1", bytes: fakePng(20_000) },
          // 大きな inline 画像（iPhone のメールは写真を inline で付ける）は残す
          { contentType: "image/png", disposition: 'inline; filename="IMG_0001.png"', bytes: fakePng(300_000) },
        ],
      }),
    );
    assert.equal(m.attachments.length, 1);
    assert.equal(m.attachments[0].name, "IMG_0001.png");
    assert.equal(m.skipped.tiny_image, 1);
    assert.equal(m.skipped.decorative_image, 1);
  });

  test("5 件まで（6 件目以降は捨てる）", async () => {
    const parts = Array.from({ length: 7 }, (_, i) => ({
      contentType: "application/pdf",
      disposition: `attachment; filename="p${i}.pdf"`,
      bytes: fakePdf(3000),
    }));
    const m = await parseInboundMail(
      multipartMail({ from: "a@example.com", subject: "x", text: "y", parts }),
    );
    assert.equal(m.attachments.length, MAX_INBOX_ATTACHMENTS);
    assert.equal(m.skipped.over_count, 2);
  });

  test("ファイル名の区切り文字・制御文字は落とす", async () => {
    const m = await parseInboundMail(
      multipartMail({
        from: "a@example.com",
        subject: "x",
        text: "y",
        parts: [
          { contentType: "application/pdf", disposition: 'attachment; filename="../../etc/passwd.pdf"', bytes: fakePdf(3000) },
        ],
      }),
    );
    assert.ok(!m.attachments[0].name?.includes("/"));
  });

  test("上限の定数がプラットフォームの上限より小さい", () => {
    // Vercel の関数の本文上限は 4.5 MB。超えるとこちらのコードが動く前に落ちる。
    assert.ok(INBOUND_MAX_BYTES < 4.5 * 1024 * 1024);
    // Worker は 4,000,000 で弾く。こちらが先に弾くと、Worker を通った正規の
    // メールを 413 で黙って捨てることになる。
    assert.ok(INBOUND_MAX_BYTES >= 4_000_000);
  });
});

// ---------------------------------------------------------------------------
describe("Gmail の自動転送の確認メール", () => {
  // 🔴 [要確認] 文面は記憶による。実物を受けたら差し替えること（inbound-mail.ts の注記）。
  const EN_SUBJECT = "(#123456789) Gmail Forwarding Confirmation - Receive Mail from user@gmail.com";
  const EN_BODY =
    "user@gmail.com has requested to automatically forward mail to your email address " +
    "trips-abcdefghijkmnpqr@junros.com.\nConfirmation code: 123456789\n\n" +
    "To allow user@gmail.com to automatically forward mail to your address, please click " +
    "the link below to confirm the request:\nhttps://mail-settings.google.com/mail/vf-xyz\n";
  const JA_SUBJECT = "(#987654321) Gmail の転送の確認 - user@gmail.com からメールを受信";
  const JA_BODY =
    "user@gmail.com さんから、メールを自動転送するリクエストが届きました。\n" +
    "確認コード: 987654321\n\nリクエストを確認するには、次のリンクをクリックしてください。\n" +
    "https://mail-settings.google.com/mail/vf-abc\n";

  test("🔴 英語: コードだけを持ち、本文（確認リンク）と添付を持たない", async () => {
    const m = await parseInboundMail(
      multipartMail({
        from: "Gmail Team <forwarding-noreply@google.com>",
        subject: EN_SUBJECT,
        text: EN_BODY,
        parts: [{ contentType: "application/pdf", disposition: "attachment", bytes: fakePdf(3000) }],
      }),
    );
    assert.equal(m.status, "forward_confirm");
    assert.equal(m.confirmCode, "123456789");
    assert.equal(m.bodyText, null);
    assert.deepEqual(m.attachments, []);
  });

  test("🔴 日本語: コードを取り出す", async () => {
    const m = await parseInboundMail(
      multipartMail({ from: "forwarding-noreply@google.com", subject: JA_SUBJECT, text: JA_BODY }),
    );
    assert.equal(m.status, "forward_confirm");
    assert.equal(m.confirmCode, "987654321");
  });

  test("件名に (#…) が無くても、本文の見出し語から取れる", () => {
    assert.equal(extractGmailForwardCode("Gmail Forwarding Confirmation", EN_BODY), "123456789");
    assert.equal(extractGmailForwardCode("Gmail の転送の確認", JA_BODY), "987654321");
    assert.equal(extractGmailForwardCode("x", "確認コード：555666777"), "555666777");
    assert.equal(extractGmailForwardCode("x", "no code here 12345"), null);
    // 13 桁は取らない（表の check は 6〜12）
    assert.equal(extractGmailForwardCode("x", "Confirmation code: 1234567890123"), null);
  });

  test("Google 以外からの同じ件名は普通のメール", async () => {
    const m = await parseInboundMail(
      multipartMail({ from: "attacker@example.com", subject: EN_SUBJECT, text: EN_BODY }),
    );
    assert.equal(m.status, "pending");
    assert.equal(m.confirmCode, null);
  });

  test("Google からでもコードが取れなければ普通のメールとして置く（本人が読める）", async () => {
    const m = await parseInboundMail(
      multipartMail({ from: "forwarding-noreply@google.com", subject: "Something else", text: "hello" }),
    );
    assert.equal(m.status, "pending");
    assert.equal(m.bodyText, "hello");
  });
});

// ---------------------------------------------------------------------------
describe("冪等の鍵（message_key）", () => {
  const sha = (x: string | Uint8Array) => createHash("sha256").update(x).digest("hex");

  test("🔴 Message-ID の <> と空白を除いた値の SHA-256（表の check: 64 桁の小文字 hex）", () => {
    const raw = new Uint8Array([1, 2, 3]);
    const k = inboundMessageKey(" <abc@mail.example> ", raw);
    assert.equal(k, sha("abc@mail.example"));
    assert.match(k, /^[0-9a-f]{64}$/);
    assert.equal(inboundMessageKey("abc@mail.example", raw), k, "<> の有無で変わらない");
  });

  test("Message-ID が無ければ生のメールの SHA-256", () => {
    const raw = new TextEncoder().encode("raw mail bytes");
    assert.equal(inboundMessageKey(undefined, raw), sha(raw));
    assert.equal(inboundMessageKey("  <>  ", raw), sha(raw));
  });

  test("🔴 同じ Message-ID なら本文が違っても同じ鍵（再送で経路のヘッダが変わっても 1 行）", async () => {
    const a = await parseInboundMail(
      multipartMail({ from: "a@example.com", subject: "x", text: "1", messageId: "id-1@example.com" }),
    );
    const b = await parseInboundMail(
      multipartMail({ from: "a@example.com", subject: "x", text: "2", messageId: "id-1@example.com" }),
    );
    const c = await parseInboundMail(
      multipartMail({ from: "a@example.com", subject: "x", text: "1", messageId: "id-2@example.com" }),
    );
    assert.equal(a.messageKey, b.messageKey);
    assert.notEqual(a.messageKey, c.messageKey);
    assert.equal(a.messageKey, sha("id-1@example.com"));
  });

  test("転送確認メールにも鍵が付く", async () => {
    const m = await parseInboundMail(
      multipartMail({
        from: "forwarding-noreply@google.com",
        subject: "(#123456789) Gmail Forwarding Confirmation",
        text: "Confirmation code: 123456789",
        messageId: "fwd@google.com",
      }),
    );
    assert.equal(m.status, "forward_confirm");
    assert.equal(m.messageKey, sha("fwd@google.com"));
  });
});
