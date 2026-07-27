/**
 * 退会済みユーザーの Storage オブジェクトを洗い出す（既定は dry-run）。
 *
 * ## なぜ要るのか
 *
 * `/api/account/delete` は 2026-07-27 まで、Storage の後始末に失敗しても
 * 警告だけ出して `auth.users` を消していた。さらに `toritavi-feedback` は
 * そもそも削除対象に入っていなかった。**持ち主が消えた後のオブジェクトは
 * 誰も辿れない**ので、この棚卸しでしか見つからない。
 *
 * 現在の退会処理は「消し残しを `toritavi_deletion_failures` に記録してから
 * 消す」ので、今後この種の孤立は台帳側に出る。これは**それ以前の分**を
 * 拾うためのもの。
 *
 * ## SQL で消さないこと
 *
 * `storage.objects` から DELETE してもバックエンドの実体は残る。行が消えて
 * 「無い」ように見えるだけで、写真そのものは消えていない。**必ず Storage
 * API 経由で消す**（このスクリプトがやっているのはそれ）。
 * SQL は下の棚卸しクエリのように、読む用途にだけ使う。
 *
 * ```sql
 * -- 参考: 件数とサイズだけ先に見る（読むだけ・安全）
 * select o.bucket_id,
 *        split_part(o.name, '/', 1) as user_id,
 *        count(*) as objects,
 *        pg_size_pretty(sum((o.metadata->>'size')::bigint)) as size
 *   from storage.objects o
 *  where o.bucket_id in ('toritavi-avatars', 'step-attachments', 'toritavi-feedback')
 *    and not exists (
 *          select 1 from auth.users u
 *           where u.id::text = split_part(o.name, '/', 1))
 *  group by 1, 2
 *  order by 3 desc;
 * ```
 *
 * ## 使い方
 *
 * ```bash
 * cd ~/Dev/toritavi/app
 * set -a && source .env.local && set +a
 * npx tsx scripts/purge-orphan-objects.ts          # 一覧を出すだけ
 * npx tsx scripts/purge-orphan-objects.ts --apply  # 実際に消す
 * ```
 *
 * `--apply` を付けるまで何も消さない。付けた場合も、消す直前に対象を
 * 全部表示する。
 */
import { createClient } from "@supabase/supabase-js";
import { USER_OWNED_BUCKETS } from "../src/lib/user-data-ledger";

const PAGE = 1000;
const apply = process.argv.includes("--apply");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が要る。\n" +
      "  set -a && source .env.local && set +a"
  );
  process.exit(1);
}
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** `prefix` 配下を全件。短いページが返るまで捲る（1 回 1000 件が上限）。 */
async function listAll(bucketId: string, prefix: string): Promise<string[]> {
  const bucket = admin.storage.from(bucketId);
  const names: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: PAGE, offset });
    if (error) throw new Error(`${bucketId}/${prefix}: ${error.message}`);
    if (!data?.length) break;
    names.push(...data.map((e) => e.name));
    if (data.length < PAGE) break;
  }
  return names;
}

/** 生きているユーザー ID を全部集める。**ここが不完全だと消しすぎる。** */
async function liveUserIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: PAGE,
    });
    if (error) throw new Error(`listUsers: ${error.message}`);
    if (!data.users.length) break;
    for (const u of data.users) ids.add(u.id);
    if (data.users.length < PAGE) break;
  }
  return ids;
}

async function main() {
  const live = await liveUserIds();
  console.log(`生きているアカウント: ${live.size} 件`);
  if (live.size === 0) {
    // 全員孤立と判定して全部消すのが最悪の事故。ここで止める。
    console.error("アカウントが 0 件。取得に失敗している可能性が高いので中止。");
    process.exit(1);
  }

  let total = 0;
  const toRemove: { bucket: string; paths: string[] }[] = [];

  for (const spec of USER_OWNED_BUCKETS) {
    const folders = await listAll(spec.id, "");
    const orphanFolders = folders.filter((f) => !live.has(f));
    const paths: string[] = [];

    for (const uid of orphanFolders) {
      if (spec.depth === 1) {
        for (const n of await listAll(spec.id, uid)) paths.push(`${uid}/${n}`);
      } else {
        for (const sub of await listAll(spec.id, uid)) {
          for (const n of await listAll(spec.id, `${uid}/${sub}`)) {
            paths.push(`${uid}/${sub}/${n}`);
          }
        }
      }
    }

    console.log(
      `\n[${spec.id}] 先頭フォルダ ${folders.length} 件中、` +
        `持ち主のいないもの ${orphanFolders.length} 件 / オブジェクト ${paths.length} 件`
    );
    for (const p of paths) console.log(`  ${p}`);
    total += paths.length;
    if (paths.length) toRemove.push({ bucket: spec.id, paths });
  }

  if (total === 0) {
    console.log("\n孤立オブジェクトなし。");
    return;
  }
  if (!apply) {
    console.log(`\n合計 ${total} 件。消すには --apply を付ける。`);
    return;
  }

  for (const { bucket, paths } of toRemove) {
    for (let i = 0; i < paths.length; i += PAGE) {
      const chunk = paths.slice(i, i + PAGE);
      const { error } = await admin.storage.from(bucket).remove(chunk);
      if (error) throw new Error(`${bucket} remove: ${error.message}`);
      console.log(`[${bucket}] ${chunk.length} 件削除`);
    }
  }
  console.log(`\n合計 ${total} 件を削除した。`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
