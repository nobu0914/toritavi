/**
 * 管理者の役割とその序列。**サーバ・クライアント共用の純粋なモジュール。**
 *
 * `admin-auth.ts` はサーバ専用（Supabase の session client を掴む）ので
 * `"use client"` から import できない。一方、画面側も「この役割で入れるか」を
 * 知る必要がある —— **権限の無い項目をナビに出さないため**。
 *
 * 🔴 **序列をここ 1 か所に置く。** 画面用にもう 1 つ書くと、片方だけ動かした
 * ときに「押せるのにエラー」または「入れるのに出ない」が生まれる
 * （`CLAUDE.md` §6 の複製先に修正が入らない型）。
 */
export type AdminRole = "support_viewer" | "support_operator" | "super_admin";

export const ROLE_RANK: Record<AdminRole, number> = {
  support_viewer: 10,
  support_operator: 20,
  super_admin: 30,
};

export function hasRank(role: AdminRole, min: AdminRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
