/*
 * POST /api/inbound-mail — メール転送での取り込み（受信側）。
 *
 * 呼ぶのは Cloudflare の Email Worker（`workers/inbound-mail/`）だけ。
 * 本文は生の MIME（`message/rfc822`）、ヘッダに HMAC 署名。
 * 設計の正本: `toritavi_app/docs/mail-import-design.md` §11。
 *
 * ## 🔴 ここで AI は呼ばない
 *
 * 本文と添付を `toritavi_inbox_items` ／ `toritavi-inbox` に置くだけ。
 * 読み取りは、利用者が受信箱で「読み取る」を押したときに `/api/ocr` を通す。
 * **受け取っただけでは外部の AI へ何も送られない。**
 *
 * ## 応答の約束（Worker との取り決め）
 *
 * | 応答 | 意味 | Worker |
 * |---|---|---|
 * | 200 | 受け取った／黙って捨てた（宛先不明・上限・凍結・壊れた MIME） | 何もしない |
 * | 401 | 署名が合わない | **例外を投げる**（設定の誤り。捨てるより再送させる） |
 * | 413 | 大きすぎる | 何もしない（Worker が先に弾いている） |
 * | 5xx | 一時的な失敗・停止中 | **例外を投げる → 送信側が再送する** |
 *
 * 🔴 **捨てるときも 200。** 4xx を返して送信者へ差し戻すと、
 *    「そのアドレスが存在するか」を外から確かめる手段になる。
 *    差し戻し（バウンス）を作らないのも、迷惑メールの踏み台にならないため。
 *
 * 🔴 **停止中（`MAIL_IMPORT_ENABLED` が "true" でない）は 503。**
 *    捨てずに再送させる —— 送信側は数日再送を続けるので、その間に
 *    開ければ失われない。開ける順は `mail_import.sql` の冒頭。
 *
 * ## 🔴 ログに中身を出さない
 *
 * 件名・本文・アドレス・ファイル名・トークン・user_id を出さない。
 * 出すのは「どの分岐を通ったか」と件数・バイト数だけ。
 */
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  ALIAS_TABLE,
  INBOUND_MAX_BYTES,
  INBOX_BUCKET,
  INBOX_TABLE,
  MAX_OPEN_PER_USER,
  MAX_PER_USER_PER_DAY,
  extractAliasToken,
  inboxObjectPath,
  mailImportDomain,
  parseInboundMail,
  verifyInboundSignature,
  type ParsedInbound,
} from "@/lib/inbound-mail";
import { assertActiveOr403Strict } from "@/lib/moderation";
import { createServiceClient } from "@/lib/supabase-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
/** MIME の解析と最大 5 件のアップロード。既定（10 秒）では足りないことがある。 */
export const maxDuration = 30;

const LOG = "[inbound-mail]";

/** 受け取った（または黙って捨てた）。**理由は返さない**（外から探れないように）。 */
function ok(accepted: boolean) {
  return NextResponse.json({ accepted }, { status: 200 });
}

/** 一時的な失敗。Worker が例外を投げ、送信側が再送する。 */
function retryLater(what: string) {
  return NextResponse.json({ error: "temporarily_unavailable", what }, { status: 503 });
}

export async function POST(request: NextRequest) {
  // ① 非常停止。**フラグが無い＝閉**（ゲストと同じ二重のうちサーバ側）。
  if (process.env.MAIL_IMPORT_ENABLED !== "true") {
    return NextResponse.json({ error: "disabled" }, { status: 503 });
  }

  // ② 秘密が無ければ通さない。設定漏れで「誰でも書ける」にしない。
  const secret = process.env.INBOUND_MAIL_SECRET;
  if (!secret) {
    console.error(`${LOG} INBOUND_MAIL_SECRET が未設定。受け取らない`);
    return retryLater("not_configured");
  }

  // ③ 大きさ。読む前に申告で、読んだ後に実物で。
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > INBOUND_MAX_BYTES) {
    console.warn(`${LOG} too large (declared) bytes=${declared}`);
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(await request.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  if (raw.byteLength > INBOUND_MAX_BYTES) {
    console.warn(`${LOG} too large bytes=${raw.byteLength}`);
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  // ④ 署名。長さは**受け取った実物**で数える（申告値を信じない）。
  const to = request.headers.get("x-junros-to");
  const sig = verifyInboundSignature({
    secret,
    timestamp: request.headers.get("x-junros-timestamp"),
    to,
    from: request.headers.get("x-junros-from"),
    signature: request.headers.get("x-junros-signature"),
    bodyByteLength: raw.byteLength,
  });
  if (!sig.ok) {
    console.warn(`${LOG} signature rejected: ${sig.reason}`);
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ⑤ 宛先 → トークン。Worker も見ているが、ここでも見る（二重）。
  const token = extractAliasToken(to, mailImportDomain());
  if (!token) {
    console.warn(`${LOG} dropped: bad recipient`);
    return ok(false);
  }

  let admin: ReturnType<typeof createServiceClient>;
  try {
    admin = createServiceClient();
  } catch (e) {
    console.error(`${LOG} service client unavailable`, (e as Error)?.message);
    return retryLater("service");
  }

  // ⑥ トークン → user_id。無ければ黙って捨てる（作り直した古いアドレスも同じ）。
  const { data: alias, error: aliasErr } = await admin
    .from(ALIAS_TABLE)
    .select("user_id")
    .eq("token", token)
    .maybeSingle();
  if (aliasErr) {
    console.error(`${LOG} alias lookup failed`, aliasErr.code ?? "");
    return retryLater("alias");
  }
  const userId = (alias as { user_id?: string } | null)?.user_id;
  if (!userId) {
    console.warn(`${LOG} dropped: unknown token`);
    return ok(false);
  }

  // ⑦ 凍結・停止中の利用者。**読めなければ再送させる**（フェイルクローズ）。
  const blocked = await assertActiveOr403Strict(userId);
  if (blocked) {
    if (blocked.status >= 500) return retryLater("moderation");
    console.warn(`${LOG} dropped: account not active`);
    return ok(false);
  }

  // ⑧ 回数。🔴 同時に届いた分は数え漏れうる（数えてから入れるまでの間）。
  //    上限は「漏れたアドレスで溢れさせない」ためのもので、1〜2 通の超過は害が無い。
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [day, open] = await Promise.all([
    admin
      .from(INBOX_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("received_at", since),
    admin
      .from(INBOX_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["pending", "forward_confirm"]),
  ]);
  if (day.error || open.error || day.count == null || open.count == null) {
    // 数えられないなら入れない。**黙って上限なしで通さない。**
    console.error(`${LOG} rate count failed`, day.error?.code ?? "", open.error?.code ?? "");
    return retryLater("rate");
  }
  if (day.count >= MAX_PER_USER_PER_DAY) {
    console.warn(`${LOG} dropped: daily limit (${day.count})`);
    return ok(false);
  }
  if (open.count >= MAX_OPEN_PER_USER) {
    console.warn(`${LOG} dropped: open limit (${open.count})`);
    return ok(false);
  }

  // ⑨ MIME を解く。壊れていたら再送しても直らないので 200 で捨てる。
  let mail: ParsedInbound;
  try {
    mail = await parseInboundMail(raw);
  } catch (e) {
    console.warn(`${LOG} dropped: unparseable`, (e as Error)?.name ?? "");
    return ok(false);
  }

  // ⑩ 同じメールの再送なら何もしない（表の一意索引 (user_id, message_key) と二重）。
  //    先に見るのは、添付を置いてから一意違反で消す往復を省くため。
  //    同時に 2 通が来た場合はここを両方すり抜けるので、insert の 23505 でも受ける。
  const dup = await admin
    .from(INBOX_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("message_key", mail.messageKey);
  if (dup.error || dup.count == null) {
    console.error(`${LOG} duplicate check failed`, dup.error?.code ?? "");
    return retryLater("dedupe");
  }
  if (dup.count > 0) {
    console.log(`${LOG} duplicate (already accepted)`);
    return ok(true);
  }

  // ⑪ 添付を置く → 行を入れる。行が入らなければ置いたものを消す。
  const itemId = randomUUID();
  const bucket = admin.storage.from(INBOX_BUCKET);
  const uploaded: string[] = [];
  const meta: Array<{ path: string; name: string | null; mime: string; bytes: number }> = [];

  const cleanup = async () => {
    if (uploaded.length === 0) return;
    const { error } = await bucket.remove(uploaded);
    if (error) {
      // 🔴 **孤児が残る。** 行が無いので 30 日の掃除（cron/purge-inbox）にも
      //    拾われない。件数だけ残して、気づけるようにする。
      console.error(`${LOG} cleanup failed; orphan objects=${uploaded.length}`);
    }
  };

  for (let i = 0; i < mail.attachments.length; i++) {
    const a = mail.attachments[i];
    const path = inboxObjectPath(userId, itemId, i + 1, a.ext);
    const { error } = await bucket.upload(path, a.bytes, {
      contentType: a.mime,
      upsert: false,
    });
    if (error) {
      console.error(`${LOG} upload failed`, (error as { name?: string }).name ?? "");
      await cleanup();
      return retryLater("upload");
    }
    uploaded.push(path);
    meta.push({ path, name: a.name, mime: a.mime, bytes: a.bytes.byteLength });
  }

  const { error: insErr } = await admin.from(INBOX_TABLE).insert({
    id: itemId,
    user_id: userId,
    subject: mail.subject,
    from_address: mail.fromAddress,
    body_text: mail.bodyText,
    attachments: meta,
    status: mail.status,
    confirm_code: mail.confirmCode,
    message_key: mail.messageKey,
  });
  if (insErr) {
    await cleanup();
    // 23505（一意違反）＝同じメールを並行して既に受け取った。**受け取り済み**として 200。
    if (insErr.code === "23505") {
      console.log(`${LOG} duplicate (already accepted, concurrent)`);
      return ok(true);
    }
    // 23xxx（制約違反）は再送しても直らない —— こちらの整え方の誤り。
    // 再送させると送信側が数日叩き続けた末にバウンスするだけなので捨てる。
    if (typeof insErr.code === "string" && insErr.code.startsWith("23")) {
      console.error(`${LOG} dropped: insert rejected by constraint ${insErr.code}`);
      return ok(false);
    }
    console.error(`${LOG} insert failed`, insErr.code ?? "");
    return retryLater("insert");
  }

  const skipped = Object.entries(mail.skipped)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  console.log(
    `${LOG} accepted status=${mail.status} body=${mail.bodySource}` +
      ` bodyChars=${mail.bodyText?.length ?? 0} attachments=${meta.length}` +
      ` skipped=[${skipped}] bytes=${raw.byteLength}`,
  );
  return ok(true);
}
