import Link from "next/link";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/admin-auth";
import { recordAuditLog } from "@/lib/admin-audit";
import { fetchAnalytics } from "@/lib/admin-analytics";
import BarChart from "@/components/admin/BarChart";
import ProgramRatesTable from "@/components/admin/ProgramRatesTable";

export const dynamic = "force-dynamic";

const PERIODS = [7, 30, 90];
const TYPE_LABEL: Record<string, string> = {
  esim: "eSIM",
  transfer: "空港送迎",
  gap_hotel: "宿の隙間",
  hotel: "ホテル",
  activity: "アクティビティ",
  insurance: "保険",
  unknown: "不明",
};

function yen(n: number) {
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}
function num(n: number) {
  return n.toLocaleString("ja-JP");
}
function pct(n: number | null) {
  return n == null ? "—" : `${(n * 100).toFixed(1)}%`;
}

type SearchParams = Promise<{ days?: string }>;

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const ctx = await requireAdmin("support_viewer");
  const sp = await searchParams;
  const days = PERIODS.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const canEdit = ctx.role === "super_admin";

  const h = await headers();
  await recordAuditLog(ctx, {
    action: "admin.analytics.viewed",
    summary: `days=${days}`,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });

  const a = await fetchAnalytics(days);
  const net = a.economics.monthNetYen;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>集計・広告</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-dim)" }}>
            アフィリのクリック・推定売上と利用推移（UTC 基準・{a.period.startDay}〜{a.period.endDay}）
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/admin/analytics?days=${p}`}
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

      {/* KPI 行 */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        <Kpi label="クリック（期間）" value={num(a.affiliate.totalClicks)} />
        <Kpi label="表示（期間）" value={num(a.affiliate.totalImpressions)} hint={`CTR ${pct(a.affiliate.ctr)}`} />
        <Kpi label="推定売上（期間）" value={yen(a.affiliate.estRevenueYen)} />
        <Kpi label="アクティブU（期間）" value={num(a.activeUsers)} hint={a.usage.signupsCapped ? "1000上限" : undefined} />
        <Kpi
          label={`純収益（${a.economics.monthLabel}）`}
          value={yen(net)}
          hint={`売上 ${yen(a.economics.monthRevenueYen)} − AI原価 ${yen(a.economics.monthAiCostYen)}`}
          valueColor={net < 0 ? "var(--danger-700, #b00)" : net > 0 ? "var(--success-700, #1a7f4b)" : undefined}
        />
      </section>

      {/* 空状態バナー */}
      {!a.affiliate.hasData && (
        <div style={{ background: "var(--n-50)", border: "1px dashed var(--border)", borderRadius: 10, padding: 14, fontSize: 13, color: "var(--text-dim)" }}>
          まだ広告のクリック / 表示データがありません。アフィリ（Tier B カード）は現在 <code>kAffiliateEnabled=false</code> で無効です。プログラム登録と <code>TORITAVI_AFF_AID</code> 注入後に有効化すると、ここに実データが蓄積されます。下の表で先に EPC 単価を登録しておけます。
        </div>
      )}

      {/* クリック推移 */}
      <section style={card}>
        <h2 style={h2}>クリック推移（日次）</h2>
        <BarChart data={a.affiliate.dailyClicks} color="#1f7ac0" valueSuffix=" clk" />
      </section>

      {/* 利用推移: 小さな倍数（別スケールを1軸に混ぜない） */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <div style={card}>
          <h2 style={h2}>新規登録（日次）</h2>
          <BarChart data={a.usage.dailySignups} height={100} color="#1a7f4b" valueSuffix=" 人" />
          {a.usage.signupsCapped && (
            <p style={caption}>※ 先頭1000ユーザーまで集計（MVP制限）</p>
          )}
        </div>
        <div style={card}>
          <h2 style={h2}>OCR リクエスト（日次）</h2>
          <BarChart data={a.usage.dailyOcr} height={100} color="#1f7ac0" valueSuffix=" 件" />
        </div>
        <div style={card}>
          <h2 style={h2}>Concierge リクエスト（日次）</h2>
          <BarChart data={a.usage.dailyConcierge} height={100} color="#8a5a00" valueSuffix=" 件" />
        </div>
      </section>

      {/* プログラム別 + EPC 編集 */}
      <ProgramRatesTable rows={a.affiliate.byProgram} canEdit={canEdit} />

      {/* 内訳 */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <BreakdownCard title="種別別クリック" rows={a.affiliate.byType.map((t) => ({ label: TYPE_LABEL[t.type] ?? t.type, value: t.clicks }))} />
        <BreakdownCard title="面別クリック" rows={a.affiliate.bySurface.map((s) => ({ label: s.surface, value: s.clicks }))} />
        <BreakdownCard title="A/Bバケット別" rows={a.affiliate.byBucket.map((b) => ({ label: b.bucket, value: b.clicks }))} />
      </section>

      <section style={{ fontSize: 11, color: "var(--text-dim)" }}>
        推定売上は「クリック × EPC」の概算で、確定額はパートナーレポートとの突合が必要です。CTR は表示回数（インプレッション）計測が有効なプログラムのみ算出されます。純収益・AI原価は当月（{a.economics.monthLabel}）基準。
        {a.affiliate.clicksCapped && " クリック件数が上限に達したため一部未集計です。"}
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  valueColor,
}: {
  label: string;
  value: string;
  hint?: string;
  valueColor?: string;
}) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
      <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: valueColor }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={card}>
      <h2 style={h2}>{title}</h2>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-dim)" }}>データなし</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => (
            <div key={r.label}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                <span>{r.label}</span>
                <span style={{ color: "var(--text-dim)" }}>{r.value.toLocaleString("ja-JP")}</span>
              </div>
              <div style={{ height: 6, background: "var(--n-100, #eee)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${(r.value / max) * 100}%`, height: "100%", background: "#1f7ac0", borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 16,
};
const h2: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: "0 0 12px" };
const caption: React.CSSProperties = { fontSize: 11, color: "var(--text-dim)", margin: "6px 0 0" };
