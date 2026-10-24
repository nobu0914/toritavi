/**
 * メール転送の受信箱を 30 日で消す（`toritavi_inbox_items.expires_at`）。
 *
 * 設計: `toritavi_app/docs/mail-import-design.md` §5（下書きと添付は 30 日で削除）。
 * 予約メールは氏名・電話・決済の一部を含む。**期限を過ぎたものを残さない。**
 *
 * ## なぜ独立した cron か（既存の cron に相乗りしない理由）
 *
 * Vercel の Hobby は**1 プロジェクト 100 本・1 日 1 回まで**（2026-10-08 に
 * docs/cron-jobs/usage-and-pricing で確認）。本数の余裕はあり、費用は関数の
 * 実行として既存の枠に入る。`purge-anonymous` に入れると、そちらの失敗
 * （500）でこちらまで再送・停止に巻き込まれ、ログも混ざる。
 *
 * ## 🔴 消す順は Storage → 行
 *
 * 行を先に消すと、添付が**誰のものか・どこにあるか**を引けなくなる
 * （`purge-anonymous` と同じ理由）。Storage で失敗した行は**残して次回へ**。
 *
 * ## 🔴 表がまだ無い間（`mail_import.sql` 未適用）
 *
 * 毎日 500 を出し続けると本物の失敗が埋もれるので、表が無いことだけは
 * 200 ＋警告で返す。それ以外の失敗は 500。
 *
 * ## 🔴 行の無いフォルダも拾う（孤児の掃除）
 *
 * 受信（`/api/inbound-mail`）は「添付を置く → 行を入れる」の順で、行が入らな
 * ければ置いたものを消す。**その削除も落ちると、行の無い添付が残る**
 * （Codex 夜間検査 5-5・2026-10-24）。期限切れの掃除は行を起点にするので、
 * 行の無い予約票には二度と届かなかった。期限切れの掃除のあとで、
 * **行の無いフォルダ**を見て消す。置いたばかり（1 日以内）のものは、
 * 受信の途中（置いた後・行を入れる前）かもしれないので触らない。
 *
 * ## 認証は必須
 *
 * 消す処理なので `CRON_SECRET` が無ければ動かさない（`purge-anonymous` と同じ）。
 */
import { NextRequest, NextResponse } from "next/server";

import { INBOX_BUCKET, INBOX_TABLE } from "@/lib/inbound-mail";
import { createServiceClient } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/** 1 回で消す行の上限。**少しずつ、毎日。** */
const MAX_PER_RUN = 200;

/** 1 回で見る「行の無いフォルダ」の上限（少しずつ、毎日）。 */
const MAX_ORPHAN_FOLDERS = 50;
/** 孤児の掃除に使ってよい時間（期限切れの掃除のあと・maxDuration の内側）。 */
const SWEEP_TIME_BUDGET_MS = 30_000;
/** 1 人の受信項目のフォルダを何件まで見るか（100 件ずつ）。 */
const MAX_ITEMS_PER_USER = 1000;
/** 利用者のフォルダを 1 回で何件まで見るか（100 件ずつ）。 */
const MAX_USER_FOLDERS = 2000;
/** これより新しい添付は孤児とみなさない（受信の途中かもしれない）。 */
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

const LOG = "[cron/purge-inbox]";

/** PostgREST の「表が無い」（スキーマキャッシュに無い）／Postgres の 42P01。 */
function isMissingTable(code: string | undefined): boolean {
  return code === "PGRST205" || code === "42P01";
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(`${LOG} CRON_SECRET が未設定。実行しない`);
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let admin: ReturnType<typeof createServiceClient>;
  try {
    admin = createServiceClient();
  } catch (e) {
    console.error(`${LOG} service client unavailable`, (e as Error)?.message);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const { data, error } = await admin
    .from(INBOX_TABLE)
    .select("id, user_id")
    .lt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (error) {
    if (isMissingTable(error.code)) {
      console.warn(`${LOG} 表が無い（mail_import.sql 未適用）。何もしない`);
      return NextResponse.json({ ok: true, installed: false });
    }
    console.error(`${LOG} select failed`, error.code ?? "", error.message);
    return NextResponse.json({ error: "select_failed" }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{ id: string; user_id: string }>;
  const bucket = admin.storage.from(INBOX_BUCKET);
  const cleared: string[] = [];
  let objects = 0;
  let skipped = 0;

  for (const row of rows) {
    // 🔴 **行の attachments 列ではなく、実物のフォルダを列挙する。**
    //    列と実物がずれていても（途中で失敗した書き込みなど）取りこぼさない。
    const folder = `${row.user_id}/${row.id}`;
    const { data: files, error: listErr } = await bucket.list(folder, { limit: 100 });
    if (listErr) {
      console.warn(`${LOG} list failed`, (listErr as { name?: string }).name ?? "");
      skipped += 1;
      continue;
    }
    const paths = (files ?? [])
      .filter((f) => f.name && f.name !== ".emptyFolderPlaceholder")
      .map((f) => `${folder}/${f.name}`);
    if (paths.length > 0) {
      const { error: rmErr } = await bucket.remove(paths);
      if (rmErr) {
        console.warn(`${LOG} remove failed`, (rmErr as { name?: string }).name ?? "");
        skipped += 1;
        continue;
      }
      objects += paths.length;
    }
    cleared.push(row.id);
  }

  let deleted = 0;
  if (cleared.length > 0) {
    const { error: delErr, count } = await admin
      .from(INBOX_TABLE)
      .delete({ count: "exact" })
      .in("id", cleared);
    if (delErr) {
      // 添付は消えたが行が残る。次回は空のフォルダを見て行だけ消すので、壊れはしない。
      console.error(`${LOG} row delete failed`, delErr.code ?? "", delErr.message);
      return NextResponse.json({ error: "delete_failed" }, { status: 500 });
    }
    deleted = count ?? cleared.length;
  }

  const orphans = await sweepOrphanFolders(admin, bucket, Date.now());

  // 🔴 **成功も出す。**「0 件でした」と「呼ばれていない」を区別できるように。
  console.log(
    `${LOG} expired=${rows.length} deleted=${deleted} objects=${objects} skipped=${skipped}` +
      ` orphanObjects=${orphans.objects} orphanSkipped=${orphans.skipped}`,
  );
  return NextResponse.json({
    ok: true,
    expired: rows.length,
    deleted,
    objects,
    skipped,
    orphanObjects: orphans.objects,
    orphanSkipped: orphans.skipped,
  });
}

type Bucket = ReturnType<ReturnType<typeof createServiceClient>["storage"]["from"]>;

/**
 * 行の無いフォルダ（`{user_id}/{item_id}/`）の添付を消す。
 *
 * 🔴 **分からないときは消さない。** 一覧・行の照会が落ちたフォルダは飛ばして
 *    次回へ（`skipped`）。作られた時刻が無い・新しい添付があるフォルダも触らない。
 */
async function sweepOrphanFolders(
  admin: ReturnType<typeof createServiceClient>,
  bucket: Bucket,
  now: number,
): Promise<{ objects: number; skipped: number }> {
  let objects = 0;
  let skipped = 0;
  let seen = 0;
  // 🔴 **先頭の 100 人だけを見ない。** 一覧は名前順なので、ページを送らないと
  //    101 人目以降の孤児には永久に届かない。
  const users: Array<{ name: string; id?: string | null }> = [];
  for (let offset = 0; offset < MAX_USER_FOLDERS; offset += 100) {
    const { data, error } = await bucket.list("", { limit: 100, offset });
    if (error) {
      console.warn(`${LOG} orphan sweep: list failed`, (error as { name?: string }).name ?? "");
      return { objects, skipped: skipped + 1 };
    }
    users.push(...((data ?? []) as Array<{ name: string; id?: string | null }>));
    if ((data ?? []).length < 100) break;
  }
  // 🔴 **時間を使い切らない**（maxDuration 60 秒）。残りは翌日に回す。
  const deadline = Date.now() + SWEEP_TIME_BUDGET_MS;
  // フォルダは id を持たない（ファイルは持つ）。
  for (const u of users.filter((f) => f.name && !f.id)) {
    if (Date.now() > deadline) break;
    // 受信項目のフォルダも 100 件で打ち切らない（二次検査の指摘）。
    const items: Array<{ name: string; id?: string | null }> = [];
    let listFailed = false;
    for (let offset = 0; offset < MAX_ITEMS_PER_USER; offset += 100) {
      const { data, error: e1 } = await bucket.list(u.name, { limit: 100, offset });
      if (e1) {
        listFailed = true;
        break;
      }
      items.push(...((data ?? []) as Array<{ name: string; id?: string | null }>));
      if ((data ?? []).length < 100) break;
    }
    if (listFailed) {
      skipped += 1;
      continue;
    }
    const itemIds = items.filter((f) => f.name && !f.id).map((f) => f.name);
    if (itemIds.length === 0) continue;
    const { data: live, error: e2 } = await admin.from(INBOX_TABLE).select("id").in("id", itemIds);
    if (e2) {
      skipped += 1;
      continue;
    }
    const alive = new Set(((live ?? []) as Array<{ id: string }>).map((r) => r.id));
    for (const itemId of itemIds) {
      if (alive.has(itemId)) continue;
      if (++seen > MAX_ORPHAN_FOLDERS) return { objects, skipped };
      const folder = `${u.name}/${itemId}`;
      const { data: files, error: e3 } = await bucket.list(folder, { limit: 100 });
      if (e3) {
        skipped += 1;
        continue;
      }
      const real = (files ?? []).filter((f) => f.name && f.name !== ".emptyFolderPlaceholder");
      if (real.length === 0) continue;
      const young = real.some((f) => {
        const at = Date.parse((f as { created_at?: string }).created_at ?? "");
        return Number.isNaN(at) || now - at < ORPHAN_MIN_AGE_MS;
      });
      if (young) continue;
      const { error: e4 } = await bucket.remove(real.map((f) => `${folder}/${f.name}`));
      if (e4) {
        skipped += 1;
        continue;
      }
      objects += real.length;
    }
  }
  return { objects, skipped };
}
