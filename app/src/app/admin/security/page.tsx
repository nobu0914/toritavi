import { requireAdmin } from "@/lib/admin-auth";
import { fetchRecentAuditLogs } from "@/lib/admin-audit";

export const dynamic = "force-dynamic";

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export default async function AdminSecurityPage() {
  await requireAdmin("support_viewer");

  const logs = await fetchRecentAuditLogs(200);

  // Lightweight derived counters from the same log window.
  const actionCounts = new Map<string, number>();
  for (const l of logs) actionCounts.set(l.action, (actionCounts.get(l.action) ?? 0) + 1);
  const topActions = Array.from(actionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>セキュリティ</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-dim)" }}>
          admin 監査ログと運用の見える化（MVP）
        </p>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Placeholder title="アカウント削除 試行" subtitle="直近24h" />
        <Placeholder title="OCR rate-limit hit" subtitle="直近24h" />
        <Placeholder title="401/403 イベント" subtitle="直近24h" />
      </section>

      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>
          最近の操作の内訳（ログ上位 200 件から集計）
        </h2>
        {topActions.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-dim)" }}>まだログがありません</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--text-dim)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                <th style={th}>アクション</th>
                <th style={thNum}>件数</th>
              </tr>
            </thead>
            <tbody>
              {topActions.map(([action, count]) => (
                <tr key={action} style={{ borderTop: "1px solid var(--n-100)" }}>
                  <td style={td}>{action}</td>
                  <td style={tdNum}>{count.toLocaleString("ja-JP")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>直近の admin 操作ログ</h2>
        {logs.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-dim)" }}>まだログがありません</div>
        ) : (
          <div style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "var(--text-dim)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, background: "var(--n-50)" }}>
                  <th style={th}>日時</th>
                  <th style={th}>アクション</th>
                  <th style={th}>ロール</th>
                  <th style={th}>対象</th>
                  <th style={th}>要約</th>
                </tr>
              </thead>
              <tbody>
                {logs.slice(0, 100).map((l) => (
                  <tr key={l.id} style={{ borderTop: "1px solid var(--n-100)" }}>
                    <td style={td}>{fmtDateTime(l.created_at)}</td>
                    <td style={td}>{l.action}</td>
                    <td style={td}>{l.actor_role ?? "—"}</td>
                    <td style={td}>
                      {l.target_type ? `${l.target_type}:${l.target_id ?? "—"}` : "—"}
                    </td>
                    <td style={td}>{l.summary ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Placeholder({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px dashed var(--border)",
        borderRadius: 10,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {title}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: "var(--n-300)" }}>—</div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
        {subtitle} · (未実装 placeholder)
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", fontWeight: 600 };
const thNum: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "8px 10px", color: "var(--text)" };
const tdNum: React.CSSProperties = { ...td, textAlign: "right" };
