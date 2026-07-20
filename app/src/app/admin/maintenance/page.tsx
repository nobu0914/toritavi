import { readFileSync } from "node:fs";
import { join } from "node:path";
import { headers } from "next/headers";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { requireAdmin } from "@/lib/admin-auth";
import { recordAuditLog } from "@/lib/admin-audit";
import CopyableCode from "@/components/admin/CopyableCode";

export const dynamic = "force-dynamic";

/**
 * 運用・メンテナンスガイド（読み取り専用）。
 *
 * 本文の原本は toritavi_app リポジトリの docs/admin-maintenance-guide.md。
 * 更新時はそちらを直してから src/content/ へコピーする（cross-repo のため
 * ビルド時参照ができない）。`##` 見出し単位で機能が増える前提の構成。
 *
 * SECURITY（重要）:
 *   このページは「手順の掲示」だけを行う。SQL / Edge Function を画面から
 *   実行する導線は意図的に持たない。purge エンドポイントをフロントから
 *   呼ばない。PURGE_SECRET をフロントへ埋め込まない（本ファイルは
 *   process.env を一切参照しない）。実行は運用者が Supabase の SQL Editor で
 *   手動で行う。
 */

const STATUS_SQL = "select * from public.toritavi_retention_status;";

function loadGuide(): string {
  try {
    return readFileSync(
      join(process.cwd(), "src/content/admin-maintenance-guide.md"),
      "utf8"
    );
  } catch (e) {
    console.error("[admin/maintenance] guide load failed", e);
    return "";
  }
}

export default async function AdminMaintenancePage() {
  const ctx = await requireAdmin("support_viewer");

  const h = await headers();
  await recordAuditLog(ctx, {
    action: "admin.maintenance.viewed",
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });

  const md = loadGuide();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 960 }}>
      <section>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>運用・メンテナンス</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-dim)" }}>
          運用リファレンス（読み取り専用）。SQL は Supabase の SQL Editor で手動実行してください。
        </p>
      </section>

      {/* 状態確認 — 一番よく使うのでページ先頭に大きく置く */}
      <section
        style={{
          background: "#fff",
          border: "1px solid var(--border)",
          borderLeft: "4px solid var(--accent-600, #b8860b)",
          borderRadius: 10,
          padding: 16,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px" }}>
          状態確認（まずこれ 1 行）
        </h2>
        <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--text-dim)" }}>
          スキャン画像 自動削除の稼働状況。Supabase → SQL Editor に貼って実行。
        </p>
        <CopyableCode code={STATUS_SQL} size="lg" />
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--text-dim)" }}>
          <code style={inlineCode}>cron_active=true</code> で稼働中 ·{" "}
          <code style={inlineCode}>last_run_status=succeeded</code> が正常 ·{" "}
          <code style={inlineCode}>pending_steps</code> は次回で消える見込み件数（0 が平常）
        </p>
      </section>

      {/* 実行はしない旨の明示 */}
      <section
        style={{
          background: "var(--n-50)",
          border: "1px dashed var(--border)",
          borderRadius: 10,
          padding: "12px 14px",
          fontSize: 12,
          color: "var(--text-dim)",
        }}
      >
        このページは手順の掲示のみです。削除の実行・停止などはこの画面からは行えません（シークレット漏洩防止のため、purge エンドポイントの呼び出し導線と <code style={inlineCode}>PURGE_SECRET</code> は管理画面に持ち込んでいません）。操作は Supabase の SQL Editor から手動で実施してください。
      </section>

      {/* ガイド本文 */}
      <section
        className="admin-md"
        style={{
          background: "#fff",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "8px 24px 24px",
        }}
      >
        {md ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
        ) : (
          <p style={{ fontSize: 13, color: "var(--danger-700, #b00)" }}>
            ガイド本文を読み込めませんでした（src/content/admin-maintenance-guide.md）。
          </p>
        )}
      </section>

      <section style={{ fontSize: 11, color: "var(--text-dim)" }}>
        原本: <code style={inlineCode}>toritavi_app / docs/admin-maintenance-guide.md</code>
        （差分が出た場合は原本が正）。本ページは原本のコピーを表示しています。
      </section>
    </div>
  );
}

const inlineCode: React.CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "0.92em",
  background: "var(--n-100, #eee)",
  padding: "1px 5px",
  borderRadius: 4,
};
