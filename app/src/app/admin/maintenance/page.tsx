import { readFileSync } from "node:fs";
import { join } from "node:path";
import { headers } from "next/headers";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { requireAdmin } from "@/lib/admin-auth";
import { recordAuditLog } from "@/lib/admin-audit";
import { splitGuideByH2 } from "@/lib/guide-sections";
import CopyableCode from "@/components/admin/CopyableCode";
import MaintenanceTabs from "@/components/admin/MaintenanceTabs";

export const dynamic = "force-dynamic";

/**
 * 運用・メンテナンスガイド（読み取り専用・ページ内タブ）。
 *
 * 本文の原本は toritavi_app リポジトリの docs/admin-maintenance-guide.md。
 * 更新時はそちらを直してから src/content/ へコピーする（cross-repo のため
 * ビルド時参照ができない）。原本の `##` 見出し 1 つ = タブ 1 枚。原本側には
 * 独自記法を持ち込まないため、タブ表示名と「状態確認」SQL は下の
 * SECTION_META で対応付ける（見出しの部分一致でマッチ）。
 *
 * SECURITY（重要）:
 *   このページは「手順の掲示」だけを行う。SQL / Edge Function を画面から
 *   実行する導線は意図的に持たない。purge エンドポイントをフロントから
 *   呼ばない。PURGE_SECRET をフロントへ埋め込まない（本ファイルは
 *   process.env を一切参照しない）。実行は運用者が Supabase の SQL Editor で
 *   手動で行う。
 */

const inlineCode: React.CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "0.92em",
  background: "var(--n-100, #eee)",
  padding: "1px 5px",
  borderRadius: 4,
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 16,
};

type SectionMeta = {
  /** 見出しに含まれていればこの meta を適用する部分文字列。 */
  match: string;
  /** タブの表示名（見出しは長いので短縮名を出す）。 */
  tabLabel: string;
  /** タブ先頭に大きく出す「まずこれ」コマンド（見出しは statusTitle）。 */
  statusTitle?: string;
  statusSql?: string;
  statusNote?: string;
  statusHint?: React.ReactNode;
};

const SECTION_META: SectionMeta[] = [
  {
    match: "スキャン画像",
    tabLabel: "ファイル削除",
    statusTitle: "状態確認（まずこれ 1 行）",
    statusSql: "select * from public.toritavi_retention_status;",
    statusNote: "スキャン画像 自動削除の稼働状況。Supabase → SQL Editor に貼って実行。",
    statusHint: (
      <>
        <code style={inlineCode}>cron_active=true</code> で稼働中 ·{" "}
        <code style={inlineCode}>last_run_status=succeeded</code> が正常 ·{" "}
        <code style={inlineCode}>pending_steps</code> は次回で消える見込み件数（0 が平常）
      </>
    ),
  },
  {
    match: "セキュリティ運用",
    tabLabel: "セキュリティ運用",
    statusTitle: "定期チェック（まずこれ）",
    statusSql: "bash tool/security_check.sh",
    statusNote: "toritavi_app のリポジトリ直下で実行。リリース前・月次はこのフル版。",
    statusHint: (
      <>
        週次・コミット前は <code style={inlineCode}>--fast</code>（静的検査のみ）·
        判断に迷ったら <code style={inlineCode}>docs/SECURITY_MAINTENANCE.md</code> の 5 原則に従う
      </>
    ),
  },
];

function metaFor(heading: string): SectionMeta | undefined {
  return SECTION_META.find((m) => heading.includes(m.match));
}

/**
 * タブの元になる Markdown。
 *   - admin-maintenance-guide.md は toritavi_app 側に原本があるコピー。
 *     再同期で上書きされるため、こちらに独自の追記はしない。
 *   - admin-security-guide.md は原本を持たない（本リポジトリが正）。
 * 新しいガイドを足すときはこの配列にファイル名を追加する。
 */
const CONTENT_FILES = [
  "admin-maintenance-guide.md",
  "admin-security-guide.md",
] as const;

function loadContent(file: string): string {
  try {
    return readFileSync(join(process.cwd(), "src/content", file), "utf8");
  } catch (e) {
    console.error(`[admin/maintenance] load failed: ${file}`, e);
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

  // 各ファイルを H2 で割り、出てきた順にタブへ並べる。
  const docs = CONTENT_FILES.map((f) => splitGuideByH2(loadContent(f)));
  const sections = docs.flatMap((d) => d.sections);
  const preamble = docs.map((d) => d.preamble).filter(Boolean).join(" ");
  const labels = sections.map((s) => metaFor(s.heading)?.tabLabel ?? s.heading);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 960 }}>
      <section>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>運用・メンテナンス</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-dim)" }}>
          運用リファレンス（読み取り専用）。SQL・コマンドは手元で手動実行してください。
        </p>
      </section>

      {/* 実行はしない旨の明示（全機能に共通なのでタブ外） */}
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
        このページは手順の掲示のみです。削除の実行・停止やチェックの実行はこの画面からは行えません（シークレット漏洩防止のため、purge エンドポイントの呼び出し導線と <code style={inlineCode}>PURGE_SECRET</code> は管理画面に持ち込んでいません）。SQL は Supabase の SQL Editor、スクリプトは手元のターミナルから実施してください。
      </section>

      {sections.length === 0 ? (
        <section style={cardStyle}>
          <p style={{ fontSize: 13, color: "var(--danger-700, #b00)", margin: 0 }}>
            ガイド本文を読み込めませんでした（src/content/admin-maintenance-guide.md）。
          </p>
        </section>
      ) : (
        <MaintenanceTabs labels={labels}>
          {sections.map((s) => {
            const meta = metaFor(s.heading);
            return (
              <div
                key={s.heading}
                style={{ display: "flex", flexDirection: "column", gap: 16 }}
              >
                {/* 状態確認は機能ごとに異なるのでタブの中に置く */}
                {meta?.statusSql && (
                  <section
                    style={{
                      ...cardStyle,
                      borderLeft: "4px solid var(--accent-600, #b8860b)",
                    }}
                  >
                    <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px" }}>
                      {meta.statusTitle ?? "状態確認（まずこれ 1 行）"}
                    </h2>
                    {meta.statusNote && (
                      <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--text-dim)" }}>
                        {meta.statusNote}
                      </p>
                    )}
                    <CopyableCode code={meta.statusSql} size="lg" />
                    {meta.statusHint && (
                      <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--text-dim)" }}>
                        {meta.statusHint}
                      </p>
                    )}
                  </section>
                )}

                <section className="admin-md" style={{ ...cardStyle, padding: "8px 24px 24px" }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.body}</ReactMarkdown>
                </section>
              </div>
            );
          })}
        </MaintenanceTabs>
      )}

      <section style={{ fontSize: 11, color: "var(--text-dim)" }}>
        {preamble && (
          <>
            {preamble.replace(/\s*\n\s*/g, " ")}
            <br />
          </>
        )}
        <code style={inlineCode}>##</code> 見出し 1 つがタブ 1 枚。「ファイル削除」の原本は{" "}
        <code style={inlineCode}>toritavi_app / docs/admin-maintenance-guide.md</code>
        （差分が出た場合は原本が正・再同期で上書きされるため直接追記しないこと）。
        「セキュリティ運用」は本リポジトリの{" "}
        <code style={inlineCode}>src/content/admin-security-guide.md</code> が正。
      </section>
    </div>
  );
}
