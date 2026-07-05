import Link from "next/link";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/admin-auth";
import { recordAuditLog } from "@/lib/admin-audit";
import { fetchAbuseSignals } from "@/lib/admin-moderation";

export const dynamic = "force-dynamic";

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

const STATUS_LABEL: Record<string, string> = {
  active: "有効",
  suspended: "停止中",
  banned: "凍結",
};

export default async function AdminAbusePage() {
  const ctx = await requireAdmin("support_viewer");

  const h = await headers();
  await recordAuditLog(ctx, {
    action: "admin.abuse.viewed",
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });

  const rows = await fetchAbuseSignals(100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>違反検知</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-dim)" }}>
          直近7日で AI/OCR 制限に繰り返し当たった利用者・フラグ/停止中の利用者を集約（規約 第9条6/7/8号）
        </p>
      </section>

      <section
        style={{
          background: "#fff",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 16,
        }}
      >
        {rows.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-dim)", padding: "12px 0" }}>
            該当する利用者はいません。拒否ログが蓄積されると、ここに繰り返し違反者が表示されます。
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "var(--text-dim)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  <th style={th}>EMAIL (MASKED)</th>
                  <th style={th}>状態</th>
                  <th style={thNum}>拒否 7日</th>
                  <th style={thNum}>OCR 当日</th>
                  <th style={thNum}>Concierge 当日</th>
                  <th style={th}>最終拒否</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId} style={{ borderTop: "1px solid var(--n-100)" }}>
                    <td style={td}>{r.emailMasked}</td>
                    <td style={td}>
                      {r.status !== "active" ? (
                        <span style={badge("danger")}>{STATUS_LABEL[r.status]}</span>
                      ) : r.flagged ? (
                        <span style={badge("warn")}>調査中</span>
                      ) : (
                        <span style={{ color: "var(--text-dim)" }}>—</span>
                      )}
                    </td>
                    <td style={tdNum}>
                      {r.rejections7d > 0 ? (
                        <strong style={{ color: r.rejections7d >= 20 ? "var(--danger-700, #b00)" : "inherit" }}>
                          {r.rejections7d}
                        </strong>
                      ) : (
                        0
                      )}
                    </td>
                    <td style={tdNum}>{r.ocrToday}</td>
                    <td style={tdNum}>{r.conciergeToday}</td>
                    <td style={td}>{fmtDateTime(r.lastRejectionAt)}</td>
                    <td style={td}>
                      <Link href={`/admin/users/${r.userId}`} style={{ color: "var(--accent-700, #7a3b00)" }}>
                        詳細 →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ fontSize: 12, color: "var(--text-dim)" }}>
        「拒否 7日」は月予算超過・日次上限・分間バーストの合計回数です。数値が高く継続する利用者は、
        利用者詳細から「調査中フラグ」→ 必要に応じて「通知」→「アカウント停止」の順で対応してください。
      </section>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", fontWeight: 600 };
const thNum: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "8px", color: "var(--text)" };
const tdNum: React.CSSProperties = { ...td, textAlign: "right" };

function badge(kind: "danger" | "warn"): React.CSSProperties {
  const danger = kind === "danger";
  return {
    display: "inline-block",
    padding: "2px 8px",
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 999,
    background: danger ? "var(--danger-50, #fee)" : "var(--warn-50, #fff7e6)",
    color: danger ? "var(--danger-700, #b00)" : "var(--warn-700, #8a5a00)",
  };
}
