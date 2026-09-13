import Link from "next/link";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/admin-auth";
import { recordAuditLog } from "@/lib/admin-audit";
import { createServiceClient } from "@/lib/supabase-service";
import { fetchUsage, MAX_ROWS } from "@/lib/admin-usage";
import BarChart from "@/components/admin/BarChart";

export const dynamic = "force-dynamic";

const PERIODS = [7, 30, 90];

/** 節目の日本語。**画面に出すのはこれ**（イベント名は開発者の語）。 */
const MILESTONE_LABEL: Record<string, string> = {
  "signup.started": "登録を始めた",
  "signup.completed": "登録できた",
  "scan.started": "読み取りを押した",
  "scan.succeeded": "読み取れた",
  "journey.created": "旅程ができた",
  "paywall.shown": "購入画面を見た",
  "purchase.completed": "購入した",
};

const num = (n: number) => n.toLocaleString("ja-JP");
/** 🔴 **null は「—」。0 と書かない。** */
const val = (n: number | null) => (n == null ? "—" : num(n));
const ms = (n: number | null) =>
  n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)} 秒` : `${n} ms`;

type SearchParams = Promise<{ days?: string }>;

export default async function AdminUsagePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const ctx = await requireAdmin("support_viewer");
  const sp = await searchParams;
  const days = PERIODS.includes(Number(sp.days)) ? Number(sp.days) : 30;

  const h = await headers();
  await recordAuditLog(ctx, {
    action: "admin.usage.viewed",
    summary: `days=${days}`,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });

  const u = await fetchUsage(createServiceClient(), days);
  const unavailable = u.rows == null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>利用解析</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-dim)" }}>
            画面・タップ・節目（過去 {days} 日・UTC 基準）
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/admin/usage?days=${p}`}
              style={{
                padding: "6px 12px",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: p === days ? "var(--ink-800, #152940)" : "#fff",
                color: p === days ? "#fff" : "var(--text)",
              }}
            >
              {p}日
            </Link>
          ))}
        </div>
      </section>

      {/* 🔴 **読めなかったことを、数字の 0 で隠さない。** */}
      {unavailable && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 16,
            background: "#FFF8E6",
            fontSize: 13,
            lineHeight: 1.8,
          }}
        >
          <strong>まだ集計できません。</strong>
          <div style={{ marginTop: 6, color: "var(--text-dim)" }}>
            イベントの表（<code>toritavi_events</code>）が読めませんでした。
            <strong>これは「0 件」ではありません。</strong>
            表の作成（<code>supabase/events.sql</code>）とアプリ側の
            <code>kAnalyticsEnabled</code> の両方が揃うと、ここに出ます。
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-dim)" }}>
            理由: <code>{u.error}</code>
          </div>
        </div>
      )}

      {u.capped && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 12,
            background: "#FFF3F3",
            fontSize: 13,
          }}
        >
          🔴 <strong>一部だけの集計です。</strong>
          {num(MAX_ROWS)} 行で打ち切りました。期間を短くしてください。
        </div>
      )}

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <Stat label="イベント" value={val(u.rows)} />
        {/* 🔴 **「人数」と書かない。** user_id を取っていないので、
            同じ人の 3 回は 3 と出る（2026-09-13・利用者の決定 C）。 */}
        <Stat label="起動（セッション）" value={val(u.sessions)} />
      </section>

      <Card title="日次の起動数">
        {u.dailyActive.length === 0 ? (
          <Empty unavailable={unavailable} />
        ) : (
          <BarChart data={u.dailyActive} height={140} />
        )}
      </Card>

      <Card title="節目（到達した起動の数）">
        {u.milestones.length === 0 ? (
          <Empty unavailable={unavailable} />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {u.milestones.map((m) => (
                <tr key={m.name} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 4px" }}>
                    {MILESTONE_LABEL[m.name] ?? m.name}
                  </td>
                  <td
                    style={{
                      padding: "8px 4px",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 600,
                    }}
                  >
                    {num(m.sessions)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="画面">
        {u.screens.length === 0 ? (
          <Empty unavailable={unavailable} />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--text-dim)", fontSize: 12 }}>
                <th style={{ textAlign: "left", padding: "4px" }}>画面</th>
                <th style={{ textAlign: "right", padding: "4px" }}>閲覧</th>
                <th style={{ textAlign: "right", padding: "4px" }}>起動</th>
                <th style={{ textAlign: "right", padding: "4px" }}>滞在（中央値）</th>
              </tr>
            </thead>
            <tbody>
              {u.screens.map((s) => (
                <tr key={s.screen} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 4px" }}>
                    <code>{s.screen}</code>
                  </td>
                  <td style={cellNum}>{num(s.views)}</td>
                  <td style={cellNum}>{num(s.sessions)}</td>
                  <td style={cellNum}>{ms(s.medianMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="よく押されたもの">
        {u.taps.length === 0 ? (
          <Empty unavailable={unavailable} />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {u.taps.map((t) => (
                <tr
                  key={`${t.screen}-${t.target}`}
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  <td style={{ padding: "8px 4px" }}>
                    <code>{t.target}</code>
                    {t.screen && (
                      <span style={{ color: "var(--text-dim)", marginLeft: 8 }}>
                        {t.screen}
                      </span>
                    )}
                  </td>
                  <td style={cellNum}>{num(t.taps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.8 }}>
        🔴 <strong>旅程の中身は記録していません。</strong>
        便名・確認番号・地名・氏名・写真・自由入力は 1 バイトも入りません
        （値は「英小文字始まりの識別子」しか受け取らない形にしてあります）。
        IP アドレスと端末識別子も持ちません。
        🔴 <strong>誰のものかも記録していません</strong>（2026-09-13 の決定）。
        数えているのは<strong>アプリの起動 1 回</strong>で、
        <strong>人数ではありません</strong> —— 同じ人が 3 回起動すれば 3 と出ます。
        <strong>日をまたぐ追跡はできません</strong>（「登録した人が後日購入した」は
        繋がりません）。節目は「1 回の起動の中でどこまで進んだか」です。
        🔴 保持は 180 日ですが、<strong>掃除の cron はまだ登録していません</strong>
        （課題 265）。
      </p>
    </div>
  );
}

const cellNum: React.CSSProperties = {
  padding: "8px 4px",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 14,
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{label}</div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          marginTop: 4,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 14,
        background: "#fff",
      }}
    >
      <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * 🔴 **「まだ無い」と「読めなかった」を別の文字にする。**
 * 同じ「データなし」にすると、表が壊れていることに永久に気づけない。
 */
function Empty({ unavailable }: { unavailable: boolean }) {
  return (
    <p style={{ fontSize: 13, color: "var(--text-dim)", margin: 0 }}>
      {unavailable ? "集計できません（上の注記）" : "この期間のデータはありません"}
    </p>
  );
}
