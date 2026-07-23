import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { recordAuditLog } from "@/lib/admin-audit";
import {
  fetchFeedback,
  signFeedbackAttachment,
  CATEGORY_LABEL,
  STATUS_LABEL,
} from "@/lib/admin-feedback";

export const dynamic = "force-dynamic";

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export default async function AdminFeedbackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireAdmin("support_viewer");
  const { id } = await params;

  // 一覧を引いて絞る。件数が少ないうちはこれで足りる。
  // 増えたら id 指定の取得を admin-feedback.ts に足すこと。
  const rows = await fetchFeedback(200);
  const row = rows.find((r) => r.id === id);
  if (!row) notFound();

  // 添付を開いたことは監査に残す。搭乗券・予約票が写りうる画像なので、
  // 「誰がいつ見たか」を後から辿れるようにしておく。
  const h = await headers();
  await recordAuditLog(ctx, {
    action: row.attachmentPath
      ? "admin.feedback.attachment_viewed"
      : "admin.feedback.detail_viewed",
    targetType: "feedback",
    targetId: row.id,
    summary: `user=${row.userId} member=${row.memberId}`,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });

  const attachmentUrl = row.attachmentPath
    ? await signFeedbackAttachment(row.userId, row.attachmentPath, 120)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section>
        <Link
          href="/admin/feedback"
          style={{ fontSize: 12, color: "var(--text-dim)" }}
        >
          ← フィードバック一覧
        </Link>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "6px 0 0" }}>
          {CATEGORY_LABEL[row.category]}・{STATUS_LABEL[row.status]}
        </h1>
      </section>

      <section
        style={{
          background: "#fff",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <dl style={{ margin: 0, display: "grid", gap: 8, fontSize: 13 }}>
          <Field label="会員番号">
            <span style={{ fontFamily: "ui-monospace, monospace" }}>
              {row.memberId}
            </span>
          </Field>
          <Field label="メール">{row.email ?? "（不明）"}</Field>
          <Field label="投稿日時">{fmtDateTime(row.createdAt)}</Field>
          <Field label="環境">
            {row.platform ?? "—"} {row.osVersion ?? ""} / アプリ{" "}
            {row.appVersion ?? "—"}
          </Field>
        </dl>

        <div
          style={{
            fontSize: 14,
            lineHeight: 1.9,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            borderTop: "1px solid var(--border)",
            paddingTop: 14,
          }}
        >
          {row.body}
        </div>

        {row.attachmentPath && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            <div
              style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8 }}
            >
              添付画像（署名 URL・2 分で失効）
            </div>
            {attachmentUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={attachmentUrl}
                alt="利用者が添付した画像"
                style={{
                  maxWidth: "100%",
                  maxHeight: 640,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                }}
              />
            ) : (
              <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
                画像を読み込めませんでした（削除済み、またはパスが不正）。
              </div>
            )}
          </div>
        )}

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <Link
            href={`/admin/users/${row.userId}`}
            style={{ fontSize: 13, color: "var(--accent-700, #7a3b00)" }}
          >
            この利用者の詳細を開く →
          </Link>
        </div>
      </section>

      <section style={{ fontSize: 12, color: "var(--text-dim)" }}>
        添付画像の閲覧は監査ログに記録されます。搭乗券・予約票が写り込むことがあるため、
        スクリーンショットの保存や転送は行わないでください。
        対応状況の更新は現在このページからは行えません（DB 直更新、または今後の実装）。
      </section>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <dt
        style={{
          width: 90,
          flex: "none",
          color: "var(--text-dim)",
          fontSize: 12,
        }}
      >
        {label}
      </dt>
      <dd style={{ margin: 0 }}>{children}</dd>
    </div>
  );
}
