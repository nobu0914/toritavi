"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * 利用者検索の検索語を保持する Cookie。
 *
 * 🔴 **検索語を URL に載せない。** 以前は `method="get"` の form で
 * `/admin/users?q=<email>` になっていた。プレースホルダが
 * 「email または user_id を検索」と言っているとおり、**実際に入るのは
 * 利用者のメールアドレス**で、それが
 *
 *   - Vercel のアクセスログ（パスとクエリが残る）
 *   - 運用者のブラウザ履歴・オートコンプリート
 *   - 外部リンクを踏んだときの Referer
 *   - URL のコピペ・スクリーンショット
 *
 * に残っていた。調査のたびに、調査対象の個人情報が調査と無関係な場所へ
 * 増えていく形（2026-08-16 の検査 L-4）。
 *
 * Cookie は httpOnly・secure・**10 分で失効**。ページ番号のような
 * 個人情報でない値は従来どおり URL に置く（共有・再読込のため）。
 */
const SEARCH_COOKIE = "admin_users_q";
const SEARCH_MAX_AGE = 60 * 10;
const SEARCH_MAX_LEN = 200;

/** 検索を実行する（Server Action。検索語は本文で送られ URL に出ない）。 */
export async function setUserSearch(formData: FormData) {
  await requireAdmin("support_viewer");
  const raw = formData.get("q");
  const q = typeof raw === "string" ? raw.trim().slice(0, SEARCH_MAX_LEN) : "";
  const jar = await cookies();
  if (q) {
    jar.set(SEARCH_COOKIE, q, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/admin/users",
      maxAge: SEARCH_MAX_AGE,
    });
  } else {
    jar.delete({ name: SEARCH_COOKIE, path: "/admin/users" });
  }
  // ページ番号は 1 に戻す（別の検索語で前のページに居ると噛み合わない）。
  redirect("/admin/users");
}

/** 検索を消す。**残さないことが目的**なので、明示的に消せる導線を必ず出す。 */
export async function clearUserSearch() {
  await requireAdmin("support_viewer");
  const jar = await cookies();
  jar.delete({ name: SEARCH_COOKIE, path: "/admin/users" });
  redirect("/admin/users");
}

/** 現在の検索語（無ければ空文字）。 */
export async function currentUserSearch(): Promise<string> {
  const jar = await cookies();
  return jar.get(SEARCH_COOKIE)?.value?.trim() ?? "";
}
