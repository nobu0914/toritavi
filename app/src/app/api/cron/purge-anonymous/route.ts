/**
 * 使われなくなった匿名ユーザーを掃除する。
 *
 * 2026-08-31 の外部レビュー P1（`toritavi_app/docs/guest-mode-spec.md` §23）——
 * **「匿名の `auth.users` を誰も消さない」**。029 は旅程に `deleted_at` を
 * 立てるだけで user 行は残る。**会員と違い本人が消しに来ない**ので、
 * 放置すると `auth.users` が匿名行で膨れ続ける。
 *
 * ## 🔴 消す順は Storage → `auth.users`
 *
 * 逆にすると**画像が誰のものか引けなくなる**（`guest-mode-spec.md` §23）。
 * Supabase は `storage.objects` の直接削除を禁じている（`42501`）ので
 * **SQL だけでは書けない。** 対象を出すのは SQL（`toritavi_anonymous_purge_candidates`）、
 * 消すのはここ、という分担にしてある。
 *
 * ## 🔴 アカウント削除と 1 点だけ違う
 *
 * `/api/account/delete` は消し残しがあっても**記録したうえで user を消す** ——
 * **本人が求めた削除**なので完了させる必要がある（Apple 5.1.1(v)）。
 *
 * こちらは**誰も求めていない**。失敗したら**その人は消さずに次回へ回す**。
 * 急ぐ理由が無いのに、辿れない孤児を作る理由も無い。
 *
 * ## 認証は必須
 *
 * `keepalive` は `CRON_SECRET` が無くても動く（読み取りだけで、止まる方が
 * まずいから）。**こちらは消す。** 設定が無ければ**動かさない**。
 */
import { NextRequest, NextResponse } from "next/server";

import {
  NON_CASCADING_USER_TABLES,
  USER_OWNED_BUCKETS,
} from "@/lib/user-data-ledger";
import { createServiceClient } from "@/lib/supabase-service";
import { removeUserObjects } from "@/app/api/account/delete/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * 🔴 **既定（10 秒）では足りない**（2026-09-04 の外部監査）。
 *
 * 1 回で最大 50 人、1 人あたり 3 バケットの走査と削除、カスケードしない表の
 * 削除、`auth.admin.deleteUser` まで走る。同じ仕事をする
 * `/api/account/delete` は同じ理由で 60 を宣言している。
 *
 * 途中で殺されると**集計ログが出ない**ので、「呼ばれていない」と
 * 「途中で死んだ」を区別できない（`CLAUDE.md` §6-1）。
 */
export const maxDuration = 60;

/** 1 回で消す上限。**少しずつ、何度でも走らせる。** */
const MAX_PER_RUN = 50;

/** 無活動と見なす日数（`guest-mode-spec.md` §7「保存期間」）。 */
const INACTIVE_DAYS = 90;

/**
 * 拒否ログ（`toritavi_ai_rejections`）を保つ日数。
 *
 * 🔴 **無限に貯めない。** 分間の共有上限 120 だけで 1 日 17 万行まで増えうる。
 * モデレーションの調べ物に要るのは直近だけで、それより古いものは
 * 容量（無料プランの DB は 500MB・別プロジェクトと共有）を食うだけ。
 */
const REJECTION_KEEP_DAYS = 30;

export async function GET(request: NextRequest) {
  // 🔴 **秘密が無ければ動かさない。** keepalive と違い、ここは消す。
  //    「設定漏れで掃除が止まる」より「設定漏れで消える」ほうが桁違いに悪い。
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/purge-anonymous] CRON_SECRET が未設定。実行しない");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let admin;
  try {
    admin = createServiceClient();
  } catch (e) {
    console.error("[cron/purge-anonymous] service client unavailable", e);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const { data: candidates, error: candErr } = await admin.rpc(
    "toritavi_anonymous_purge_candidates",
    { p_days: INACTIVE_DAYS, p_limit: MAX_PER_RUN },
  );
  if (candErr) {
    // 🔴 **関数が無いのか、権限が無いのかを区別できるよう残す。**
    //    どちらも「0 件でした」に見えるので、黙ると掃除が止まっていても
    //    気づけない（`CLAUDE.md` §6-1）。
    console.error("[cron/purge-anonymous] candidates failed", candErr.message);
    return NextResponse.json({ error: "candidates_failed" }, { status: 500 });
  }

  const list = (candidates ?? []) as Array<{ user_id: string }>;
  let deleted = 0;
  let skipped = 0;

  for (const row of list) {
    const userId = row.user_id;
    let failed = false;

    // 🔴 **消す直前にもう一度確かめる**（2026-09-04 の外部監査・TOCTOU）。
    //
    //    候補は一覧を取った時点の姿でしかない。取得から削除までの間に
    //    その人が**戻ってきた**かもしれないし、**登録して恒久アカウントに
    //    昇格した**かもしれない（`updateUser` は user_id を変えないので、
    //    候補に載ったまま昇格しうる）。
    //
    //    **1 件でも「もう会員だった人」を消したら取り返しがつかない。**
    //    ここは誰にも急かされていない掃除なので、迷ったら次回に回す。
    const { data: fresh, error: freshErr } =
      await admin.auth.admin.getUserById(userId);
    if (freshErr || !fresh?.user) {
      console.warn(`[cron/purge-anonymous] re-check failed for ${userId}`);
      skipped += 1;
      continue;
    }
    const u = fresh.user;
    const lastSeen = u.last_sign_in_at ?? u.created_at;
    const inactiveEnough =
      Date.parse(lastSeen) < Date.now() - INACTIVE_DAYS * 86_400_000;
    if (u.is_anonymous !== true || !inactiveEnough || u.email) {
      // 匿名でなくなった／戻ってきた／メールが付いた。**消さない。**
      console.warn(
        `[cron/purge-anonymous] no longer eligible, skipping ${userId}:`,
        `anon=${u.is_anonymous} inactive=${inactiveEnough} email=${u.email ? "yes" : "no"}`,
      );
      skipped += 1;
      continue;
    }

    // ① 先に Storage。**ここで失敗したら user を消さない。**
    for (const spec of USER_OWNED_BUCKETS) {
      try {
        await removeUserObjects(admin, spec, userId);
      } catch (e) {
        console.warn(
          `[cron/purge-anonymous] bucket ${spec.id} failed for ${userId}`,
          e,
        );
        failed = true;
      }
    }

    // ② カスケードしない表。ここも失敗したら止める。
    if (!failed) {
      for (const table of NON_CASCADING_USER_TABLES) {
        const { error } = await admin.from(table).delete().eq("user_id", userId);
        if (error) {
          console.warn(
            `[cron/purge-anonymous] table ${table} failed for ${userId}`,
            error.message,
          );
          failed = true;
          break;
        }
      }
    }

    if (failed) {
      // **次回に回す。** 消えないまま残るだけで、壊れはしない。
      skipped += 1;
      continue;
    }

    // ③ 最後に user 行。
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      console.warn(
        `[cron/purge-anonymous] deleteUser failed for ${userId}`,
        delErr.message,
      );
      skipped += 1;
      continue;
    }
    deleted += 1;
  }

  // 🔴 **拒否ログを剪定する**（2026-09-04 の外部監査）。
  //
  //    `logAiRejection` は拒否のたびに 1 行入れるが、**消す仕組みが無かった。**
  //    分間の共有上限は 120 なので、上限だけで **1 日 17 万行**まで増えうる。
  //    `toritavi_ocr_events` には 10 分の剪定があるのに、こちらには無かった。
  //
  //    ここに相乗りさせる（新しい cron を増やさない）。**失敗しても
  //    掃除の成否には影響させない** —— 剪定は後片付けであって、
  //    ここで 500 を返すと本体の削除まで再送されることになる。
  let prunedRejections: number | null = null;
  {
    const cutoff = new Date(
      Date.now() - REJECTION_KEEP_DAYS * 86_400_000,
    ).toISOString();
    const { error, count } = await admin
      .from("toritavi_ai_rejections")
      .delete({ count: "exact" })
      .lt("created_at", cutoff);
    if (error) {
      console.warn("[cron/purge-anonymous] rejection prune failed", error.message);
    } else {
      prunedRejections = count ?? 0;
    }
  }

  // 🔴 **成功も出す。** 「0 件でした」と「呼ばれていない」を区別できるように
  //    （`CLAUDE.md` §6-1「出ないのに落ちない」）。
  console.log(
    `[cron/purge-anonymous] candidates=${list.length} deleted=${deleted} skipped=${skipped} prunedRejections=${prunedRejections}`,
  );
  return NextResponse.json({
    ok: true,
    candidates: list.length,
    deleted,
    skipped,
    prunedRejections,
  });
}
