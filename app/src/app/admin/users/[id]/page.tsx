import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { recordAuditLog } from "@/lib/admin-audit";
import { fetchAdminUserDetail } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireAdmin("support_viewer");
  const { id } = await params;

  const detail = await fetchAdminUserDetail(id);
  if (!detail) notFound();

  const h = await headers();
  recordAuditLog(ctx, {
    action: "admin.user.viewed",
    targetType: "user",
    targetId: id,
    summary: detail.email ? `viewed ${detail.email}` : `viewed user ${id}`,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section>
        <Link href="/admin/users" style={{ fontSize: 12, color: "var(--text-dim)" }}>
          ← 利用者一覧へ戻る
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "8px 0 0" }}>
          {detail.email ?? "(email 不明)"}
        </h1>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2, fontFamily: "var(--font-mono, monospace)" }}>
          {detail.id}
        </div>
        {detail.adminRole && (
          <span
            style={{
              display: "inline-block",
              marginTop: 8,
              padding: "3px 8px",
              fontSize: 11,
              fontWeight: 700,
              borderRadius: 999,
              background: "var(--danger-50, #fee)",
              color: "var(--danger-700, #b00)",
            }}
          >
            admin: {detail.adminRole}
          </span>
        )}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card title="基本情報">
          <Row label="作成日時" value={fmtDateTime(detail.createdAt)} />
          <Row label="最終ログイン" value={fmtDateTime(detail.lastSignInAt)} />
          <Row label="email 確認済" value={fmtDateTime(detail.emailConfirmedAt)} />
          <Row label="Journey 件数" value={detail.counts.journeys.toLocaleString("ja-JP")} />
          <Row label="Step 件数" value={detail.counts.steps.toLocaleString("ja-JP")} />
        </Card>

        <Card title="プロフィール設定">
          {detail.settings ? (
            <>
              <Row label="表示名" value={detail.settings.displayName ?? "—"} />
              <Row label="タイムゾーン" value={detail.settings.timezone ?? "—"} />
              <Row label="出発地デフォルト" value={detail.settings.defaultOrigin ?? "—"} />
              <Row label="緊急連絡先" value={detail.settings.emergencyContact ? "(設定あり)" : "—"} />
              <Row label="アバター" value={detail.settings.avatarUrl ? "設定あり" : "未設定"} />
              <Row label="更新日時" value={fmtDateTime(detail.settings.updatedAt)} />
            </>
          ) : (
            <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
              user_settings 未作成
            </div>
          )}
        </Card>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card title="使用量（当日）">
          <Row label="OCR リクエスト" value={detail.usage.ocrRequestsToday.toLocaleString("ja-JP")} />
          <Row label="Concierge リクエスト" value={detail.usage.conciergeRequestsToday.toLocaleString("ja-JP")} />
        </Card>

        <Card title="直近の admin 操作ログ">
          {detail.recentAuditLogs.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-dim)" }}>ログはありません</div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 12 }}>
              {detail.recentAuditLogs.map((l) => (
                <li key={l.id} style={{ padding: "6px 0", borderTop: "1px solid var(--n-100)" }}>
                  <div style={{ color: "var(--text-dim)" }}>{fmtDateTime(l.created_at)}</div>
                  <div>
                    <strong>{l.action}</strong>
                    {l.actor_role ? ` · ${l.actor_role}` : ""}
                  </div>
                  {l.summary && <div style={{ color: "var(--text-dim)" }}>{l.summary}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <Card title="直近の Journey（最大10件）">
        {detail.recentJourneys.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Journey はありません</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--text-dim)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                <th style={th}>タイトル</th>
                <th style={th}>作成</th>
                <th style={th}>更新</th>
              </tr>
            </thead>
            <tbody>
              {detail.recentJourneys.map((j) => (
                <tr key={j.id} style={{ borderTop: "1px solid var(--n-100)" }}>
                  <td style={td}>{j.title ?? "(無題)"}</td>
                  <td style={td}>{fmtDateTime(j.created_at)}</td>
                  <td style={td}>{fmtDateTime(j.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <section style={{ background: "var(--n-50)", border: "1px dashed var(--border)", borderRadius: 10, padding: 16, fontSize: 13, color: "var(--text-dim)" }}>
        MVP では表示のみです。今後の拡張で 管理メモ追加 / email 変更補助 / パスワード強制再設定 などを予定しています（いずれも ConfirmDialog + 監査ログ必須）。
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0", fontSize: 13 }}>
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
      <span style={{ color: "var(--text)", textAlign: "right", wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "8px", color: "var(--text)" };
