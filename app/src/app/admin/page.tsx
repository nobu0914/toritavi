import { requireAdmin } from "@/lib/admin-auth";
import { recordAuditLog } from "@/lib/admin-audit";
import { fetchAdminSummary } from "@/lib/admin-queries";
import { fetchRecentAuditLogs } from "@/lib/admin-audit";
import { headers } from "next/headers";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Kpi = { label: string; value: string; hint?: string };

function kpi(label: string, value: string, hint?: string): Kpi {
  return { label, value, hint };
}

function fmtYen(cents: number) {
  if (!Number.isFinite(cents)) return "—";
  return `¥${Math.round(cents / 100).toLocaleString("ja-JP")}`;
}

function fmtNum(n: number) {
  return n.toLocaleString("ja-JP");
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export default async function AdminDashboardPage() {
  // Layout already called requireAdmin, but each page re-checks so any
  // future change to layout (or a direct /admin/api hit) can't bypass.
  const ctx = await requireAdmin("support_viewer");

  const h = await headers();
  // Fire-and-forget audit entry. Not awaited so it can't slow the page.
  recordAuditLog(ctx, {
    action: "admin.dashboard.viewed",
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });

  const [summary, logs] = await Promise.all([
    fetchAdminSummary(),
    fetchRecentAuditLogs(10),
  ]);

  const kpis: Kpi[] = [
    kpi("総ユーザー", fmtNum(summary.totals.users)),
    kpi("当日アクティブ", fmtNum(summary.today.activeUsers), "UTC基準"),
    kpi("Journey 総数", fmtNum(summary.totals.journeys)),
    kpi("Step 総数", fmtNum(summary.totals.steps)),
    kpi("OCR 当日", fmtNum(summary.today.ocrRequests)),
    kpi("OCR 当月消費", fmtYen(summary.ocr.monthSpendCents), `${fmtNum(summary.ocr.monthRequests)} req`),
    kpi("Concierge 当日", fmtNum(summary.today.conciergeRequests)),
    kpi("Concierge 当月消費", fmtYen(summary.concierge.monthSpendCents), `${fmtNum(summary.concierge.monthRequests)} req`),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <section>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>ダッシュボード</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-dim)" }}>
          サービス状態の俯瞰 · 集計は UTC 当日・当月基準
        </p>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        {kpis.map((k) => (
          <div
            key={k.label}
            style={{
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 16,
            }}
          >
            <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              {k.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>
              {k.value}
            </div>
            {k.hint && (
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                {k.hint}
              </div>
            )}
          </div>
        ))}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>最近の管理操作</h2>
            <Link href="/admin/security" style={{ fontSize: 12, color: "var(--accent-700, #7a3b00)" }}>
              すべて表示 →
            </Link>
          </div>
          {logs.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-dim)", padding: "12px 0" }}>
              まだログがありません
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "var(--text-dim)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  <th style={th}>日時</th>
                  <th style={th}>アクション</th>
                  <th style={th}>ロール</th>
                  <th style={th}>対象</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} style={{ borderTop: "1px solid var(--n-100)" }}>
                    <td style={td}>{fmtDateTime(l.created_at)}</td>
                    <td style={td}>{l.action}</td>
                    <td style={td}>{l.actor_role ?? "—"}</td>
                    <td style={td}>
                      {l.target_type ? `${l.target_type}:${l.target_id ?? "—"}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>要注意アラート</h2>
          <div style={{ fontSize: 12, color: "var(--text-dim)", padding: "12px 0" }}>
            （未実装 placeholder）
            <br />
            将来ここに rate-limit hit / auth 失敗 / 予算超過などを集約します。
          </div>
        </div>
      </section>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "8px", color: "var(--text)" };
