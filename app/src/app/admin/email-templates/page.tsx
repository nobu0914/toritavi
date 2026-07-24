import { headers } from "next/headers";
import { requireAdmin } from "@/lib/admin-auth";
import { recordAuditLog } from "@/lib/admin-audit";
import {
  EMAIL_TEMPLATES,
  SUPABASE_PROJECT,
  toPreviewDocument,
} from "@/lib/email-templates";
import EmailTemplateCard from "@/components/admin/EmailTemplateCard";

export const dynamic = "force-dynamic";

/**
 * 認証メールのテンプレート（掲示のみ）。
 *
 * 本文の正本は `@/lib/email-templates`。このページはそれを表示して
 * コピーさせるだけで、Supabase へは書き戻さない。理由はそのファイルの
 * SECURITY 節に書いた（Management API のトークンを本番に置きたくない）。
 *
 * 反映先プロジェクトを画面に明示しているのは、組織 `genbox` の中に
 * プロジェクトが複数あり、**別のものを開いても何も変わらない**まま
 * 「直したつもり」になれるため。
 */

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 16,
};

const inlineCode: React.CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "0.92em",
  background: "var(--n-100, #eee)",
  padding: "1px 5px",
  borderRadius: 4,
};

export default async function AdminEmailTemplatesPage() {
  const ctx = await requireAdmin("support_viewer");

  const h = await headers();
  await recordAuditLog(ctx, {
    action: "admin.email_templates.viewed",
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });

  return (
    <div style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>
        認証メールのテンプレート
      </h1>
      <p style={{ fontSize: 13, lineHeight: 1.8, color: "var(--text-dim)", margin: "0 0 20px" }}>
        登録確認・パスワード再設定などで利用者に届くメールの文面です。
        ここでは<strong>表示とコピーだけ</strong>を行います。反映は Supabase の
        ダッシュボードで人が貼り付けます。
      </p>

      {/* ---- どのデータベースを開くか ---- */}
      <section style={{ ...card, marginBottom: 16, borderColor: "var(--accent, #1184C7)" }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>
          1. どのプロジェクトを開くか
        </h2>
        <p style={{ fontSize: 13, lineHeight: 1.8, margin: "0 0 12px" }}>
          組織 <code style={inlineCode}>{SUPABASE_PROJECT.org}</code> の中に
          プロジェクトが複数あります。
          <strong>
            {" "}
            <code style={inlineCode}>{SUPABASE_PROJECT.project}</code> を選んでください。
          </strong>
          <br />
          JUNROS は GenBox と <code style={inlineCode}>auth.users</code> を共有していて、
          認証設定はこのプロジェクトが持っています。別のプロジェクトを開いても
          画面は同じように見えますが、<strong>何も反映されません</strong>。
        </p>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", margin: 0, fontSize: 13 }}>
          <dt style={{ color: "var(--text-dim)" }}>組織</dt>
          <dd style={{ margin: 0 }}>
            <code style={inlineCode}>{SUPABASE_PROJECT.org}</code>
          </dd>
          <dt style={{ color: "var(--text-dim)" }}>プロジェクト</dt>
          <dd style={{ margin: 0 }}>
            <code style={inlineCode}>{SUPABASE_PROJECT.project}</code>
          </dd>
          <dt style={{ color: "var(--text-dim)" }}>project ref</dt>
          <dd style={{ margin: 0 }}>
            <code style={inlineCode}>{SUPABASE_PROJECT.ref}</code>
          </dd>
        </dl>
        <p style={{ fontSize: 12.5, color: "var(--text-dim)", margin: "12px 0 0" }}>
          下のリンクは <code style={inlineCode}>{SUPABASE_PROJECT.ref}</code> を直接開くので、
          プロジェクトの選び間違いは起きません。
        </p>
      </section>

      {/* ---- 手順 ---- */}
      <section style={{ ...card, marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>2. 貼り付け手順</h2>
        <a
          href={SUPABASE_PROJECT.templatesUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            padding: "9px 16px",
            borderRadius: 8,
            background: "var(--ink-900, #0F1B2D)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            textDecoration: "none",
            marginBottom: 12,
          }}
        >
          Supabase の Email Templates を開く ↗
        </a>
        <ol style={{ fontSize: 13, lineHeight: 1.9, margin: 0, paddingLeft: 20 }}>
          <li>左のタブで対象のテンプレートを選ぶ（下のカードの名前と同じ並び）</li>
          <li>
            <strong>Subject</strong> を差し替える
          </li>
          <li>
            <strong>Body</strong> を <kbd>⌘A</kbd> で全消ししてから貼る
          </li>
          <li>
            <strong>Save changes</strong> を押す
          </li>
        </ol>
        <p style={{ fontSize: 12.5, lineHeight: 1.8, color: "var(--text-dim)", margin: "12px 0 0" }}>
          <strong>4 つすべてやってください。</strong>
          1 つ残すと、その経路だけ旧サービス名で届き続けます。
        </p>
      </section>

      {/* ---- 注意 ---- */}
      <section
        style={{
          ...card,
          marginBottom: 20,
          borderLeft: "3px solid var(--danger-700, #b00)",
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px" }}>
          <code style={inlineCode}>{"{{ .ConfirmationURL }}"}</code> を消さないこと
        </h2>
        <p style={{ fontSize: 13, lineHeight: 1.8, margin: 0 }}>
          Supabase が用途ごとに中身を差し替える差し込み変数です。各テンプレートに
          <strong> ボタンと末尾 URL の 2 箇所</strong>あります。
          消すと、メールは届くのに<strong>リンクが機能しません</strong>。
          Body を <kbd>⌘A</kbd> で全消ししてから貼れば問題ありません。
        </p>
      </section>

      {/* ---- 4 種 ---- */}
      <div style={{ display: "grid", gap: 14 }}>
        {EMAIL_TEMPLATES.map((t, i) => (
          <EmailTemplateCard
            key={t.key}
            template={t}
            previewDoc={toPreviewDocument(t.html)}
            index={i}
          />
        ))}
      </div>

      <p style={{ fontSize: 12, lineHeight: 1.8, color: "var(--text-dim)", margin: "20px 0 0" }}>
        文面を変えるときは、この画面ではなくリポジトリの{" "}
        <code style={inlineCode}>app/src/lib/email-templates.ts</code>{" "}
        を直してデプロイしてください。ここは常にそのファイルを表示しています。
        <br />
        リンクの飛び先（Site URL・Redirect URLs）は別の設定です:{" "}
        <a
          href={SUPABASE_PROJECT.urlConfigUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent, #1184C7)" }}
        >
          URL Configuration ↗
        </a>
      </p>
    </div>
  );
}
