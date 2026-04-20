import { requireAdmin } from "@/lib/admin-auth";
import { fetchAdminUserList } from "@/lib/admin-queries";
import Link from "next/link";

export const dynamic = "force-dynamic";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type SearchParams = Promise<{ q?: string; page?: string; perPage?: string }>;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdmin("support_viewer");
  const sp = await searchParams;

  const page = Math.max(parseInt(sp.page ?? "1", 10) || 1, 1);
  const perPage = Math.min(Math.max(parseInt(sp.perPage ?? "100", 10) || 100, 1), 200);
  const query = (sp.q ?? "").trim();

  const result = await fetchAdminUserList({ page, perPage, query });
  const totalPages = perPage > 0 ? Math.max(Math.ceil(result.total / perPage), 1) : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>利用者</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-dim)" }}>
          個別ユーザーの調査入口 · email は一覧ではマスク表示
        </p>
      </section>

      <form
        action="/admin/users"
        method="get"
        style={{
          display: "flex",
          gap: 8,
          background: "#fff",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 12,
          alignItems: "center",
        }}
      >
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="email または user_id を検索"
          style={{
            flex: 1,
            padding: "8px 12px",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 13,
            background: "#fff",
          }}
        />
        <input type="hidden" name="perPage" value={String(perPage)} />
        <button
          type="submit"
          style={{
            padding: "8px 16px",
            background: "var(--ink-800, #152940)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          検索
        </button>
        {query && (
          <Link
            href="/admin/users"
            style={{
              padding: "8px 12px",
              fontSize: 13,
              color: "var(--text-dim)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          >
            クリア
          </Link>
        )}
      </form>

      <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--n-100)", fontSize: 12, color: "var(--text-dim)" }}>
          <span>
            {result.total.toLocaleString("ja-JP")} 件中 {(page - 1) * perPage + 1}–{Math.min(page * perPage, result.total)} 件
          </span>
          <span>{page} / {totalPages} ページ</span>
        </div>
        <div style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--n-50)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-dim)" }}>
                <th style={th}>email (masked)</th>
                <th style={th}>user_id</th>
                <th style={th}>登録</th>
                <th style={th}>最終ログイン</th>
                <th style={thNum}>Journey</th>
                <th style={thNum}>OCR 当日</th>
                <th style={thNum}>Concierge 当日</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {result.rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 32, textAlign: "center", color: "var(--text-dim)" }}>
                    該当するユーザーがいません
                  </td>
                </tr>
              ) : (
                result.rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--n-100)" }}>
                    <td style={td}>{r.emailMasked}</td>
                    <td style={{ ...td, fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: "var(--text-dim)" }}>
                      {r.id.slice(0, 8)}…
                    </td>
                    <td style={td}>{fmtDate(r.createdAt)}</td>
                    <td style={td}>{fmtDate(r.lastSignInAt)}</td>
                    <td style={tdNum}>{r.journeyCount.toLocaleString("ja-JP")}</td>
                    <td style={tdNum}>{r.ocrRequestsToday.toLocaleString("ja-JP")}</td>
                    <td style={tdNum}>{r.conciergeRequestsToday.toLocaleString("ja-JP")}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <Link
                        href={`/admin/users/${r.id}`}
                        style={{ fontSize: 12, color: "var(--accent-700, #7a3b00)", fontWeight: 600 }}
                      >
                        詳細 →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderTop: "1px solid var(--n-100)", fontSize: 13 }}>
          <PageLink label="← 前へ" targetPage={page - 1} disabled={page <= 1} query={query} perPage={perPage} />
          <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
            {perPage} 件/ページ
          </span>
          <PageLink label="次へ →" targetPage={page + 1} disabled={page >= totalPages} query={query} perPage={perPage} />
        </div>
      </div>
    </div>
  );
}

function PageLink({
  label,
  targetPage,
  disabled,
  query,
  perPage,
}: {
  label: string;
  targetPage: number;
  disabled: boolean;
  query: string;
  perPage: number;
}) {
  if (disabled) {
    return <span style={{ color: "var(--n-300)" }}>{label}</span>;
  }
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("page", String(targetPage));
  params.set("perPage", String(perPage));
  return (
    <Link
      href={`/admin/users?${params.toString()}`}
      style={{ color: "var(--text)", fontWeight: 600 }}
    >
      {label}
    </Link>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontWeight: 600 };
const thNum: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "10px 12px", color: "var(--text)" };
const tdNum: React.CSSProperties = { ...td, textAlign: "right" };
