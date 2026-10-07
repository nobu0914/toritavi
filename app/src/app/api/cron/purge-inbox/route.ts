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

  // 🔴 **成功も出す。**「0 件でした」と「呼ばれていない」を区別できるように。
  console.log(
    `${LOG} expired=${rows.length} deleted=${deleted} objects=${objects} skipped=${skipped}`,
  );
  return NextResponse.json({ ok: true, expired: rows.length, deleted, objects, skipped });
}
