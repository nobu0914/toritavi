/*
 * Supabase 無料プランの自動一時停止を防ぐための日次アクセス。
 *
 * 🔴 **なぜ要るか。** 無料プロジェクトは **7 日間まとまった DB 活動が無いと
 * 一時停止**される。止まっている間はアプリが全滅する。
 * これまで活動を作っていたのは**開発機の launchd 2 本だけ**で、
 * keep-alive が「あの Mac が動いていること」に依存していた。
 *
 * **一番危ないのは App Store の審査中。** 提出から審査までは日が空き、
 * その間は利用者がまだ 1 人もいない。審査員が触ったときに停止していると
 * 全機能が落ちて確実にリジェクトされ、しかも理由が「サーバが落ちている」
 * なので原因が分かりにくい。
 * （`~/Dev/toritavi_app/docs/known_issues.md` の該当節）
 *
 * 利用者が付けば実通信で活動が出るので、その頃には役目を終える。
 * ただし**外す判断は要らない**（動き続けても害が無い）。
 *
 * ## 設計
 *
 * - **匿名キーで叩く。** サービスロールを使わない。RLS 越しなので 0 行が返る。
 *   活動としては数えられる。`tool/verify/l1b_alive.sh` の「200 かつ匿名では
 *   0 行」と同じ作法。
 * - **データを返さない。** 応答は `{ ok }` と件数だけ。公開状態で叩かれても
 *   漏れるものが無い。
 * - **CRON_SECRET は任意。** 設定されていれば照合する。設定されていなくても
 *   動く（環境変数の追加は人の判断が要るため、必須にしない）。
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Vercel の Cron は毎回新しい実行。キャッシュされると DB を叩かなくなる。
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  // 設定されているときだけ照合する。**無くても 401 にしない** ——
  // 環境変数が未設定なだけで keep-alive が止まると、
  // 「動いているつもりで止まっている」という一番まずい形になる。
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    // 🔴 **未設定なら、この経路は誰でも叩ける。**
    //    データは返さないが、DB クエリと関数実行を他人に消費させられる。
    //    必須にはしない（上記のとおり、止まる方が危ない）が、
    //    **黙って弱いまま動かさない**。設定すれば Vercel Cron が
    //    自動で `Authorization: Bearer $CRON_SECRET` を付けるので、
    //    こちらは何も変えずに閉じる（2026-08-29 のレーン 8 検査）。
    console.error(
      "[cron/keepalive] CRON_SECRET が未設定。この経路は認証なしで叩ける",
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
  if (!url || !key) {
    // 🔴 **黙って 200 を返さない。** 設定が抜けたまま「成功」を返すと、
    // DB を一度も叩かないまま緑になり、7 日後に停止して初めて気づく。
    return NextResponse.json(
      { ok: false, reason: "supabase env missing" },
      { status: 500 },
    );
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  // 実際にクエリを飛ばす。RLS で 0 行が返るのが正常。
  // count だけ取り、行の中身は受け取らない。
  const { count, error } = await sb
    .from("toritavi_journeys")
    .select("id", { count: "exact", head: true });

  if (error) {
    return NextResponse.json(
      { ok: false, reason: "query failed", code: error.code ?? null },
      { status: 500 },
    );
  }

  // 匿名なので 0 のはず。0 でなければ RLS が緩んでいる可能性があるため、
  // 値をそのまま出して気づけるようにする（中身は返さない）。
  return NextResponse.json({ ok: true, anonRows: count ?? 0 });
}
