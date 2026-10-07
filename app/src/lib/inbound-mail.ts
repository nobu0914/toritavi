/**
 * メール転送での取り込み —— 受信の純粋な部品（署名・宛先・MIME・本文・添付）。
 *
 * 設計の正本: `toritavi_app/docs/mail-import-design.md` §11。
 * 表とバケット: `toritavi_app/supabase/mail_import.sql`。
 *
 * ## 🔴 ここで AI は呼ばない
 *
 * 受け取ったら**本文と添付を置くだけ**。読み取りは、利用者がアプリの受信箱で
 * 「読み取る」を押したときに既存の `/api/ocr` を通す（§11-1）。
 * 許諾・月の上限・伏せ字・ファイル検証を**撮影と同じ 1 本の経路**に通すため、
 * ここではファイルを**種類（先頭バイト）と大きさでしか選ばない**。
 * ページ数・暗号化・寸法の判定は `/api/ocr` 側の `validateFile` が行う
 * —— ここで複製すると「複製した側に修正が入らない」（CLAUDE.md §6）。
 *
 * ## 🔴 ログに中身を出さない
 *
 * 件名・本文・アドレス・ファイル名・トークンは、氏名や予約番号そのもの。
 * この関数群は**何もログに出さない**。呼ぶ側も種類と件数だけを出すこと。
 *
 * ## 本文のリンクは開かない
 *
 * HTML をテキストにするときも、`href` も画像も取りに行かない（追跡・悪意ある
 * リンク）。ここは**文字列の加工だけ**で、ネットワークに触れない。
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import PostalMime from "postal-mime";

import { detectKind, type DetectedKind } from "./file-validate.ts";
import { MAX_FILE_BYTES, MAX_TEXT_CHARS } from "./ocr-limits.ts";

// ---------------------------------------------------------------------------
// 上限
// ---------------------------------------------------------------------------

/**
 * 1 通の生の MIME の上限。Email Worker は 4,000,000 バイトを超えたら拒否する
 * ので、こちらはそれより少し大きく取る（Vercel の関数の本文上限 4.5 MB の手前）。
 */
export const INBOUND_MAX_BYTES = 4 * 1024 * 1024;

/** 置き場所（`mail_import.sql` と対）。 */
export const INBOX_BUCKET = "toritavi-inbox";
export const INBOX_TABLE = "toritavi_inbox_items";
export const ALIAS_TABLE = "toritavi_mail_aliases";

/** 1 人 24 時間あたりの受信数（§11-2）。漏れたアドレスへの大量送信で溢れさせない。 */
export const MAX_PER_USER_PER_DAY = 20;
/** 未処理（pending / forward_confirm）の上限。 */
export const MAX_OPEN_PER_USER = 50;

/** 署名の時刻のずれの許容（秒）。 */
export const SIGNATURE_MAX_SKEW_SEC = 300;

/** 1 通あたりの添付の上限（表の check と対）。 */
export const MAX_INBOX_ATTACHMENTS = 5;

/** 件名・送信元の上限（表の check と対。どちらも code point 数）。 */
export const MAX_SUBJECT_CHARS = 300;
export const MAX_FROM_CHARS = 320;

/** これより小さい画像は追跡用の 1 px 画像やアイコンとみなして捨てる。 */
export const MIN_IMAGE_BYTES = 2 * 1024;

/**
 * 本文の HTML から参照される（`cid:`）か、`inline` と宣言された画像のうち、
 * これより小さいものはロゴ・帯の飾りとみなして捨てる。
 *
 * 🔴 **アプリは「添付があれば添付を、無ければ本文を」読み取りへ渡す**（§11-1）。
 *    飾りの画像を残すと、**本文ではなくロゴを読み取ることになる。**
 *    64 KB は目安で `[要確認]` —— 大きな広告帯は残りうる。実物の予約メールで
 *    確かめてから詰めること。写真を貼った転送（iPhone のメールは画像を
 *    inline で付ける）は普通 64 KB を大きく超えるので残る。
 */
export const MAX_DECORATIVE_IMAGE_BYTES = 64 * 1024;

/** 既定の受信ドメイン（§11 の決定）。 */
export const DEFAULT_MAIL_IMPORT_DOMAIN = "junros.com";

/** 環境変数 `MAIL_IMPORT_DOMAIN`（無ければ junros.com）。 */
export function mailImportDomain(): string {
  const d = (process.env.MAIL_IMPORT_DOMAIN ?? "").trim().toLowerCase();
  return d || DEFAULT_MAIL_IMPORT_DOMAIN;
}

// ---------------------------------------------------------------------------
// 署名
// ---------------------------------------------------------------------------

/**
 * 署名の対象。**本文そのものは含めず、長さだけを入れる。**
 *
 * Worker の無料プランは CPU 10 ms なので、4 MB の本文をハッシュしない
 * （Worker 側の `workers/inbound-mail/src/lib.ts` と同じ形）。
 * 🔴 そのぶん、**通信路の途中で 1 回分を盗まれると、5 分以内なら
 *    同じ長さの別の本文で再送できる。** TLS の内側の話なので受け入れる。
 *    宛先（＝トークン）は署名に入っているので、別の人の受信箱へは入れられない。
 */
export function inboundSigningPayload(
  timestamp: string,
  to: string,
  from: string,
  bodyByteLength: number,
): string {
  return `${timestamp}.${to}.${from}.${bodyByteLength}`;
}

/** hex の HMAC-SHA256（テストと検証で共有）。 */
export function signInbound(
  secret: string,
  timestamp: string,
  to: string,
  from: string,
  bodyByteLength: number,
): string {
  return createHmac("sha256", secret)
    .update(inboundSigningPayload(timestamp, to, from, bodyByteLength))
    .digest("hex");
}

export type SignatureVerdict =
  | { ok: true }
  | { ok: false; reason: "no_secret" | "missing" | "bad_format" | "skew" | "mismatch" };

/**
 * Worker からの署名を確かめる。
 *
 * 🔴 **秘密が無ければ通さない**（フェイルクローズ）。設定漏れで
 *    「誰でも任意の受信箱へ書ける」状態にしない。
 */
export function verifyInboundSignature(args: {
  secret: string | undefined;
  timestamp: string | null;
  to: string | null;
  from: string | null;
  signature: string | null;
  bodyByteLength: number;
  nowSec?: number;
}): SignatureVerdict {
  const { secret, timestamp, to, from, signature, bodyByteLength } = args;
  if (!secret) return { ok: false, reason: "no_secret" };
  // `from` は空文字がありうる（バウンスの MAIL FROM:<>）。null だけを欠落とする。
  if (timestamp == null || to == null || from == null || signature == null) {
    return { ok: false, reason: "missing" };
  }
  if (!/^\d{1,12}$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(signature)) {
    return { ok: false, reason: "bad_format" };
  }
  const now = args.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > SIGNATURE_MAX_SKEW_SEC) {
    return { ok: false, reason: "skew" };
  }
  const expected = Buffer.from(
    signInbound(secret, timestamp, to, from, bodyByteLength),
    "hex",
  );
  const provided = Buffer.from(signature.toLowerCase(), "hex");
  // 長さは上の正規表現で 32 バイトに揃っている。念のため比べてから定数時間比較。
  if (provided.length !== expected.length) return { ok: false, reason: "mismatch" };
  return timingSafeEqual(provided, expected)
    ? { ok: true }
    : { ok: false, reason: "mismatch" };
}

// ---------------------------------------------------------------------------
// 宛先 → トークン
// ---------------------------------------------------------------------------

/** トークンの文字（l / o / 0 / 1 を除く 32 種・表の check と同じ）。 */
const TOKEN_CLASS = "[a-km-np-z2-9]";

/**
 * `trips-<16 文字>@<domain>` からトークンを取り出す。合わなければ null。
 *
 * ドメインは大文字小文字を区別しない（DNS と同じ）。**トークンは区別する**
 * —— 発行するのは小文字だけなので、大文字は存在しないアドレス。
 */
export function extractAliasToken(
  to: string | null | undefined,
  domain: string = mailImportDomain(),
): string | null {
  if (!to) return null;
  const at = to.trim().lastIndexOf("@");
  if (at < 0) return null;
  const local = to.trim().slice(0, at);
  const host = to.trim().slice(at + 1);
  if (host.toLowerCase() !== domain.toLowerCase()) return null;
  const m = new RegExp(`^trips-(${TOKEN_CLASS}{16})$`).exec(local);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// 文字列の整え
// ---------------------------------------------------------------------------

/**
 * code point 単位で切る。**DB の `char_length` は code point を数える**ので、
 * JS の `.length`（UTF-16）で切ると絵文字を割ったり、上限の判定がずれたりする。
 */
export function truncateCodePoints(s: string, max: number): string {
  // 速い道: UTF-16 で上限以内なら code point でも上限以内。
  if (s.length <= max) return s;
  const cps = Array.from(s);
  return cps.length <= max ? s : cps.slice(0, max).join("");
}

/**
 * 🔴 **NUL を落とす。** Postgres の text は U+0000 を受け付けず、
 * insert ごと失敗する（＝1 文字のせいでメール全体が入らない）。
 * ほかの制御文字は改行・タブを残して落とす。
 */
function stripControls(s: string, keepNewlines: boolean): string {
  return keepNewlines
    ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    : s.replace(/[\u0000-\u001f\u007f]/g, " ");
}

/** 1 行の値（件名・ファイル名）。空なら null。 */
export function cleanLine(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  const v = stripControls(s, false).replace(/\s+/g, " ").trim();
  return v ? truncateCodePoints(v, max) : null;
}

// ---------------------------------------------------------------------------
// HTML → テキスト
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  yen: "¥",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  laquo: "«",
  raquo: "»",
  middot: "·",
  times: "×",
  rarr: "→",
  larr: "←",
  bull: "•",
  euro: "€",
  pound: "£",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (all, body: string) => {
    if (body[0] === "#") {
      const cp =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
        return " ";
      }
      return String.fromCodePoint(cp);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? all;
  });
}

/** 中身ごと消す要素。 */
const DROP_ELEMENTS = ["script", "style", "head", "title", "noscript", "template", "svg", "xml"];

/**
 * 中身ごと消す要素を取り除く。
 *
 * 🔴 **正規表現の `<script[\s\S]*?</script>` を使わない。** 閉じタグの無い
 *    開始タグが大量にあると、毎回末尾まで走査して O(n²) になる（4 MB で
 *    関数が時間切れになる）。ここは indexOf で 1 回ずつ進むので線形。
 *    閉じタグが無ければ、そこから先は全部捨てる（飾りが壊れているだけ）。
 */
function dropElements(html: string): string {
  const lower = html.toLowerCase();
  const open = new RegExp(`<(${DROP_ELEMENTS.join("|")})\\b`, "g");
  let out = "";
  let pos = 0;
  for (;;) {
    open.lastIndex = pos;
    const m = open.exec(lower);
    if (!m) break;
    out += html.slice(pos, m.index) + " ";
    const close = lower.indexOf(`</${m[1]}`, m.index + m[0].length);
    if (close < 0) {
      pos = html.length;
      break;
    }
    const gt = lower.indexOf(">", close);
    pos = gt < 0 ? html.length : gt + 1;
  }
  return out + html.slice(pos);
}

/** コメントを消す（閉じが無ければ末尾まで）。線形。 */
function dropComments(html: string): string {
  let out = "";
  let pos = 0;
  for (;;) {
    const start = html.indexOf("<!--", pos);
    if (start < 0) break;
    out += html.slice(pos, start) + " ";
    const end = html.indexOf("-->", start + 4);
    if (end < 0) return out;
    pos = end + 3;
  }
  return out + html.slice(pos);
}

/**
 * HTML を読めるテキストにする。**リンク先も画像も取りに行かない。**
 *
 * postal-mime の `text`（HTML しか無いメールでは自動で作られる）を使わないのは、
 * `<style>` の中身が残り、`(https://追跡用の長い URL)` が本文に挿し込まれるため。
 * 予約メールの HTML はこれだけで 20,000 文字の枠を使い切ることがある。
 */
export function htmlToText(html: string): string {
  let s = dropComments(html);
  s = dropElements(s);
  s = s
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(
      /<\/?(p|div|tr|li|ul|ol|h[1-6]|table|tbody|thead|section|article|header|footer|blockquote|center|dl|dt|dd|hr)\b[^>]*>/gi,
      "\n",
    )
    .replace(/<\/?(td|th)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "");
  s = decodeEntities(s);
  return normalizeText(s);
}

/** 空白を詰める。行頭行末の空白を落とし、空行は 1 つまで。 */
export function normalizeText(s: string): string {
  return stripControls(s.replace(/\r\n?/g, "\n"), true)
    .replace(/[ \t 　]+/g, (m) => (m.includes("　") ? "　" : " "))
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Gmail の自動転送の確認メール
// ---------------------------------------------------------------------------

export const GMAIL_FORWARDING_SENDER = "forwarding-noreply@google.com";

/**
 * 確認コードを取り出す。見つからなければ null。
 *
 * `[要確認]` **実物の文面を手元で確かめていない。** 記憶にある形は
 *   - 件名: `(#123456789) Gmail Forwarding Confirmation - Receive Mail from …`
 *   - 件名: `(#123456789) Gmail の転送の確認 - … からメールを受信`
 *   - 本文: `Confirmation code: 123456789` ／ `確認コード: 123456789`
 * どれか 1 つが当たれば取れるよう、**件名の `(#数字)` を先に、本文の
 * 見出し語を次に**見る。桁数は表の check と同じ 6〜12。
 * 実物を受けたら、このテストの検体を実物の文面に差し替えること。
 */
export function extractGmailForwardCode(
  subject: string | null | undefined,
  text: string | null | undefined,
): string | null {
  const s = subject ?? "";
  const m1 = /\(#\s*(\d{6,12})\s*\)/.exec(s);
  if (m1) return m1[1];
  const label = /(?:confirmation\s*code|確認コード|確認用コード)\s*[:：]?\s*(\d{6,12})(?!\d)/i;
  const m2 = label.exec(text ?? "") ?? label.exec(s);
  return m2 ? m2[1] : null;
}

// ---------------------------------------------------------------------------
// MIME → 受信箱の 1 行
// ---------------------------------------------------------------------------

const EXT: Record<DetectedKind, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export type InboundAttachment = {
  bytes: Uint8Array;
  mime: DetectedKind;
  ext: string;
  /** 表示用。**ログに出さない。** */
  name: string | null;
};

/** 捨てた添付の理由（ログには件数だけ出す）。 */
export type SkipReason =
  | "unsupported"
  | "too_large"
  | "tiny_image"
  | "decorative_image"
  | "over_count";

export type ParsedInbound = {
  status: "pending" | "forward_confirm";
  subject: string | null;
  fromAddress: string | null;
  bodyText: string | null;
  confirmCode: string | null;
  attachments: InboundAttachment[];
  skipped: Partial<Record<SkipReason, number>>;
  /** 本文をどこから作ったか（ログ用）。 */
  bodySource: "plain" | "html" | "none";
  /**
   * 再送で同じメールが 2 行にならない鍵（表の `message_key`・利用者ごとに一意）。
   * Message-ID（前後の `<>` と空白を除く）の SHA-256。無ければ生のメールの SHA-256。
   * **ログに出さない**（Message-ID は送信元のドメインを含む）。
   */
  messageKey: string;
};

/**
 * 冪等の鍵を作る。
 *
 * 🔴 **Worker の再送で 2 行にしない。** サーバが行を入れた後に 5xx を返すと
 *    （応答の途中で関数が切れた等）、Worker が例外を投げ、送信側が同じ
 *    メールをもう一度送る。
 *
 * Message-ID を先に使うのは、再送の途中で経路のヘッダ（Received など）が
 * 変わっても同じ値になるため。無いメールだけ生のバイト列で代える
 * （再送はバイト列ごと同じなので、それで足りる）。
 */
export function inboundMessageKey(messageId: string | null | undefined, raw: Uint8Array): string {
  const id = (messageId ?? "").trim().replace(/^<+/, "").replace(/>+$/, "").trim();
  const h = createHash("sha256");
  if (id) h.update(id, "utf8");
  else h.update(raw);
  return h.digest("hex");
}

/**
 * 生の MIME に `text/plain` の部分が実際にあるか。
 *
 * postal-mime は HTML しか無いメールでも `text` を**自動で作る**ので、
 * `email.text` があるだけでは「本物の text/plain」と区別できない。
 * ヘッダを見て決める（添付の .txt にも当たるが、そのときは postal-mime の
 * 変換結果を使うだけで、壊れはしない）。
 */
function hasPlainPart(raw: Uint8Array): boolean {
  // latin1 で読めばバイトのまま 1 文字になる（ヘッダは ASCII）。
  const head = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("latin1");
  return /^content-type:[ \t]*(?:\r?\n[ \t]+)?"?text\/plain/im.test(head);
}

function toBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === "string") return new Uint8Array(Buffer.from(content, "utf8"));
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

function firstMailbox(addr: unknown): string | null {
  const a = addr as { address?: string; group?: Array<{ address?: string }> } | undefined;
  if (!a) return null;
  if (a.address) return a.address;
  return a.group?.find((g) => g.address)?.address ?? null;
}

/**
 * 生の MIME を受信箱の 1 行の材料にする。**ネットワークに触れない。**
 *
 * 日本語の文字コード（ISO-2022-JP・Shift_JIS・EUC-JP）は postal-mime が
 * `TextDecoder` で解く。Node は full-icu 同梱なので Vercel でも同じ
 * （`inbound-mail.test.ts` が ISO-2022-JP と Shift_JIS の検体で固定する）。
 */
export async function parseInboundMail(raw: Uint8Array): Promise<ParsedInbound> {
  const email = await PostalMime.parse(raw, {
    // 壊れた・悪意ある入れ子でメモリを食わせない（既定より絞る）。
    maxNestingDepth: 32,
    maxPartCount: 500,
    maxRfc822NestingDepth: 3,
    attachmentEncoding: "arraybuffer",
  });

  const messageKey = inboundMessageKey(email.messageId, raw);
  const subject = cleanLine(email.subject, MAX_SUBJECT_CHARS);
  const fromRaw = firstMailbox(email.from);
  const fromClean = cleanLine(fromRaw, MAX_FROM_CHARS + 1);
  // アドレスを途中で切ると別のアドレスになる。長すぎるものは持たない。
  const fromAddress =
    fromClean && Array.from(fromClean).length <= MAX_FROM_CHARS ? fromClean : null;

  let bodySource: ParsedInbound["bodySource"] = "none";
  let body = "";
  if (email.html && !(email.text && hasPlainPart(raw))) {
    body = htmlToText(email.html);
    bodySource = "html";
  } else if (email.text) {
    body = normalizeText(email.text);
    bodySource = "plain";
  }
  const bodyText = body ? truncateCodePoints(body, MAX_TEXT_CHARS) : null;

  // ---- Gmail の転送確認: コードだけを持ち、添付も本文も持たない ----
  //
  // 🔴 送信元の From ヘッダは偽れる。偽った場合に起きるのは
  //    「受信箱に数字が 1 つ出る」だけで、読み取りにも旅程にも入らない。
  //    本文を持たないのは、確認用のリンク（押すと転送が有効になる）を
  //    受信箱に置かないため。コードは Gmail の設定画面に打ち込んで使う。
  if (fromAddress && fromAddress.toLowerCase() === GMAIL_FORWARDING_SENDER) {
    const code = extractGmailForwardCode(email.subject, email.text ?? bodyText);
    if (code) {
      return {
        status: "forward_confirm",
        subject,
        fromAddress,
        bodyText: null,
        confirmCode: code,
        attachments: [],
        skipped: {},
        bodySource,
        messageKey,
      };
    }
    // コードが取れなければ普通のメールとして置く（本人が本文を読める）。
  }

  const attachments: InboundAttachment[] = [];
  const skipped: ParsedInbound["skipped"] = {};
  const skip = (r: SkipReason) => {
    skipped[r] = (skipped[r] ?? 0) + 1;
  };

  for (const att of email.attachments) {
    const bytes = toBytes(att.content);
    // 🔴 **申告の MIME もファイル名も信じない。先頭バイトだけで決める。**
    const kind = detectKind(bytes);
    if (!kind) {
      skip("unsupported");
      continue;
    }
    if (bytes.byteLength > MAX_FILE_BYTES) {
      skip("too_large");
      continue;
    }
    if (kind !== "application/pdf") {
      if (bytes.byteLength < MIN_IMAGE_BYTES) {
        skip("tiny_image");
        continue;
      }
      const decorative = att.related === true || att.disposition === "inline";
      if (decorative && bytes.byteLength < MAX_DECORATIVE_IMAGE_BYTES) {
        skip("decorative_image");
        continue;
      }
    }
    if (attachments.length >= MAX_INBOX_ATTACHMENTS) {
      skip("over_count");
      continue;
    }
    attachments.push({
      bytes,
      mime: kind,
      ext: EXT[kind],
      name: cleanLine(att.filename?.replace(/[\\/]/g, "_"), 200),
    });
  }

  return {
    status: "pending",
    subject,
    fromAddress,
    bodyText,
    confirmCode: null,
    attachments,
    skipped,
    bodySource,
    messageKey,
  };
}

/** Storage のパス（`{user_id}/{item_id}/{n}.{ext}`・n は 1 から）。 */
export function inboxObjectPath(userId: string, itemId: string, n: number, ext: string): string {
  return `${userId}/${itemId}/${n}.${ext}`;
}
