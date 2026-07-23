import { headers } from "next/headers";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { recordAuditLog } from "@/lib/admin-audit";
import {
  fetchFeedback,
  countFeedbackByStatus,
  CATEGORY_LABEL,
  STATUS_LABEL,
  type FeedbackStatus,
} from "@/lib/admin-feedback";

export const dynamic = "force-dynamic";

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

const STATUS_ORDER: FeedbackStatus[] = [
  "new",
  "triaged",
  "in_progress",
  "done",
  "wontfix",
];

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requireAdmin("support_viewer");

  const h = await headers();
  await recordAuditLog(ctx, {
    action: "admin.feedback.viewed",
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });

  const sp = await searchParams;
  const filter = STATUS_ORDER.includes(sp.status as FeedbackStatus)
    ? (sp.status as FeedbackStatus)
    : undefined;

  const [rows, counts] = await Promise.all([
    fetchFeedback(100, filter),
    countFeedbackByStatus(),
  ]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
          改善フィードバック
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-dim)" }}>
          アプリの「アカウント → 改善フィードバック」から届いた投稿。
          添付画像は詳細を開いたときだけ短命の署名 URL で表示します。
        </p>
      </section>

      {/* 状態フィルタ */}
      <section style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/admin/feedback" style={chip(!filter)}>
          すべて
        </Link>
        {STATUS_ORDER.map((s) => (
          <Link
            key={s}
            href={`/admin/feedback?status=${s}`}
            style={chip(filter === s)}
          >
            {STATUS_LABEL[s]}
            <span style={{ marginLeft: 6, opacity: 0.7 }}>{counts[s]}</span>
          </Link>
        ))}
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
          <div
            style={{ fontSize: 13, color: "var(--text-dim)", padding: "12px 0" }}
          >
            該当する投稿はありません。
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {rows.map((r) => (
              <article
                key={r.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 14,
                  background: r.status === "new" ? "#fffdf6" : "#fff",
                }}
              >
                <header
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                    marginBottom: 8,
                  }}
                >
                  <span style={badge(r.status)}>{STATUS_LABEL[r.status]}</span>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>
                    {CATEGORY_LABEL[r.category]}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontFamily: "ui-monospace, monospace",
                      color: "var(--text-dim)",
                    }}
                  >
                    {r.memberId}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                    {r.email ?? "（メール不明）"}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text-dim)",
                      marginLeft: "auto",
                    }}
                  >
                    {fmtDateTime(r.createdAt)}
                  </span>
                </header>

                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.8,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {r.body}
                </div>

                <footer
                  style={{
                    marginTop: 10,
                    display: "flex",
                    gap: 12,
                    flexWrap: "wrap",
                    fontSize: 11.5,
                    color: "var(--text-dim)",
                  }}
                >
                  <span>
                    {r.platform ?? "—"} / {r.osVersion ?? "—"}
                  </span>
                  <span>アプリ {r.appVersion ?? "—"}</span>
                  {r.attachmentPath && <span>📎 画像あり</span>}
                  <Link
                    href={`/admin/feedback/${r.id}`}
                    style={{
                      marginLeft: "auto",
                      color: "var(--accent-700, #7a3b00)",
                    }}
                  >
                    詳細 →
                  </Link>
                  <Link
                    href={`/admin/users/${r.userId}`}
                    style={{ color: "var(--accent-700, #7a3b00)" }}
                  >
                    利用者 →
                  </Link>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>

      <section style={{ fontSize: 12, color: "var(--text-dim)" }}>
        会員番号（CW-XXXX-XXXX）は利用者のアカウント画面に表示されている値です。
        問い合わせで番号を伝えられた場合は、この一覧から照合できます。
        添付画像には搭乗券・予約票が写り込むことがあるため、閲覧は必要な範囲にとどめてください。
      </section>
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return {
    display: "inline-block",
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 999,
    textDecoration: "none",
    border: "1px solid var(--border)",
    background: active ? "var(--accent-50, #fff4e6)" : "#fff",
    color: active ? "var(--accent-700, #7a3b00)" : "var(--text)",
  };
}

function badge(status: FeedbackStatus): React.CSSProperties {
  const isNew = status === "new";
  const done = status === "done" || status === "wontfix";
  return {
    display: "inline-block",
    padding: "2px 8px",
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 999,
    background: isNew
      ? "var(--warn-50, #fff7e6)"
      : done
        ? "#eef2f1"
        : "var(--accent-50, #fff4e6)",
    color: isNew
      ? "var(--warn-700, #8a5a00)"
      : done
        ? "var(--text-dim)"
        : "var(--accent-700, #7a3b00)",
  };
}
