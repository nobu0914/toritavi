/**
 * コンシェルジュの利用を見る画面（2026-09-23・利用者の指示）。
 *
 * 🔴 **2 段になっている。**
 *   - 上（B 集約）: 件数・文字数・上限に当たった回数。**内容なし**。`support_viewer`
 *   - 下（A 明細）: **利用者が書いた質問文そのもの**。`super_admin` のみ、
 *     かつ `CONCIERGE_ADMIN_CONTENT=true` のときだけ。
 */
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/admin-auth";
import { recordAuditLog } from "@/lib/admin-audit";
import { hasRank } from "@/lib/admin-roles";
import {
  fetchConciergeSummary,
  fetchConciergeMessages,
  CONCIERGE_ADMIN_CONTENT,
} from "@/lib/admin-concierge";

export const dynamic = "force-dynamic";

function fmt(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

const TH: React.CSSProperties = {
  textAlign: "left", padding: "8px 10px", fontSize: 12,
  color: "var(--text-dim)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
};
const TD: React.CSSProperties = {
  padding: "8px 10px", fontSize: 13, borderBottom: "1px solid var(--border)",
  verticalAlign: "top",
};

export default async function AdminConciergePage() {
  const ctx = await requireAdmin("support_viewer");
  const h = await headers();

  // 🔴 **内容を見たかどうかを、別の action として残す。**
  //    集約を見ただけの閲覧と、本文を見た閲覧を、後から区別できるようにする。
  const canSeeContent = hasRank(ctx.role, "super_admin") && CONCIERGE_ADMIN_CONTENT;
  await recordAuditLog(ctx, {
    action: canSeeContent ? "admin.concierge.content.viewed" : "admin.concierge.viewed",
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });

  const summary = await fetchConciergeSummary(7);
  const messages = canSeeContent ? await fetchConciergeMessages({ days: 7, limit: 100 }) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <section>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>コンシェルジュ</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-dim)" }}>
          直近 7 日。上限に当たった回数は <code>toritavi_ai_rejections</code>（規約 第9条6/7/8号）。
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>
          利用者ごとの集約（内容は含みません）
        </h2>
        {summary.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-dim)" }}>直近 7 日の利用はありません。</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={TH}>利用者</th>
                  <th style={TH}>質問数</th>
                  <th style={TH}>合計文字</th>
                  <th style={TH}>最長</th>
                  <th style={TH}>入力 tok</th>
                  <th style={TH}>出力 tok</th>
                  <th style={TH}>上限に当たった</th>
                  <th style={TH}>最終</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((r) => (
                  <tr key={r.userId}>
                    <td style={TD}>
                      {r.email ?? "—"}
                      <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{r.userId}</div>
                    </td>
                    <td style={TD}>{r.messages}</td>
                    <td style={TD}>{r.totalChars.toLocaleString()}</td>
                    <td style={TD}>{r.maxChars.toLocaleString()}</td>
                    <td style={TD}>{r.tokensIn.toLocaleString()}</td>
                    <td style={TD}>{r.tokensOut.toLocaleString()}</td>
                    <td style={{ ...TD, fontWeight: r.rejections > 0 ? 700 : 400 }}>
                      {r.rejections}
                    </td>
                    <td style={TD}>{fmt(r.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>
          質問の内容
        </h2>
        {!CONCIERGE_ADMIN_CONTENT ? (
          <div
            style={{
              padding: 12, fontSize: 13, lineHeight: 1.7,
              border: "1px solid var(--border)", borderRadius: 8,
            }}
          >
            <strong>まだ開いていません。</strong>
            <p style={{ margin: "6px 0 0", color: "var(--text-dim)" }}>
              利用者が書いた文章を運営者が読む機能です。公開プライバシーポリシーは
              利用目的に「不正利用の検知・防止、利用量・コストの管理」を挙げていますが、
              <strong>運営者が入力内容を閲覧することは書かれていません。</strong>
              記載が要るかを決めてから <code>CONCIERGE_ADMIN_CONTENT=true</code> で開けてください。
            </p>
          </div>
        ) : !hasRank(ctx.role, "super_admin") ? (
          <p style={{ fontSize: 13, color: "var(--text-dim)" }}>
            この一覧は管理者のみ閲覧できます。
          </p>
        ) : messages.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-dim)" }}>直近 7 日の質問はありません。</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={TH}>日時</th>
                  <th style={TH}>利用者</th>
                  <th style={TH}>文字</th>
                  <th style={TH}>質問</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr key={m.id}>
                    <td style={{ ...TD, whiteSpace: "nowrap" }}>{fmt(m.createdAt)}</td>
                    <td style={TD}>
                      {m.email ?? "—"}
                      <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{m.userId}</div>
                    </td>
                    <td style={TD}>{m.chars}</td>
                    <td style={{ ...TD, whiteSpace: "pre-wrap", maxWidth: 520 }}>{m.text}</td>
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
