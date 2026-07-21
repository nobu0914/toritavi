"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ProgramRow = {
  program: string;
  label: string;
  epcYen: number;
  commissionNote: string | null;
  active: boolean;
  /**
   * 提携承認済みか（affiliate_programs.approved_at 非 NULL）。
   * false の間はアプリが広告を出さないので、EPC を入れてもクリックは 0 のまま。
   */
  approved: boolean;
  clicks: number;
  impressions: number;
  ctr: number | null;
  revenueYen: number;
};

function yen(n: number) {
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}
function pct(n: number | null) {
  return n == null ? "—" : `${(n * 100).toFixed(1)}%`;
}

export default function ProgramRatesTable({
  rows,
  canEdit,
}: {
  rows: ProgramRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(program: string) {
    const val = Number(draft[program]);
    if (!Number.isFinite(val) || val < 0) {
      setMsg("EPC は 0 以上の数値で入力してください");
      return;
    }
    setBusy(program);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/analytics/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program, epcYen: val }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setMsg(`${program} の EPC を ¥${val} に保存しました`);
      setDraft((d) => {
        const next = { ...d };
        delete next[program];
        return next;
      });
      router.refresh();
    } catch (e) {
      setMsg(`失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const totalRevenue = rows.reduce((s, r) => s + r.revenueYen, 0);

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>プログラム別・推定売上</h2>
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
          推定売上合計 <strong style={{ color: "var(--text)" }}>{yen(totalRevenue)}</strong>
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "var(--text-dim)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
              <th style={th}>プログラム</th>
              <th style={thNum}>クリック</th>
              <th style={thNum}>表示</th>
              <th style={thNum}>CTR</th>
              <th style={thNum}>EPC (¥/click)</th>
              <th style={thNum}>推定売上</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const editing = draft[r.program] !== undefined;
              return (
                <tr key={r.program} style={{ borderTop: "1px solid var(--n-100)" }}>
                  <td style={td}>
                    <div
                      style={{
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      {r.label}
                      {/* 未承認だと配信されない＝数字が動かない。原因が一目で分かるように出す。 */}
                      {!r.approved && (
                        <span
                          title="提携が未承認のため、アプリでは広告が表示されません（approved_at が未設定）"
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "1px 6px",
                            borderRadius: 4,
                            color: "#7A5300",
                            background: "#FFE3A3",
                          }}
                        >
                          未承認
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                      {r.program}
                      {r.commissionNote ? ` · ${r.commissionNote}` : ""}
                    </div>
                  </td>
                  <td style={tdNum}>{r.clicks.toLocaleString("ja-JP")}</td>
                  <td style={tdNum}>{r.impressions.toLocaleString("ja-JP")}</td>
                  <td style={tdNum}>{pct(r.ctr)}</td>
                  <td style={tdNum}>
                    {canEdit ? (
                      <input
                        type="number"
                        min={0}
                        step="0.5"
                        value={editing ? draft[r.program] : String(r.epcYen)}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [r.program]: e.target.value }))
                        }
                        style={epcInput}
                      />
                    ) : (
                      `¥${r.epcYen}`
                    )}
                  </td>
                  <td style={{ ...tdNum, fontWeight: 600 }}>{yen(r.revenueYen)}</td>
                  <td style={td}>
                    {canEdit && editing && (
                      <button
                        disabled={busy === r.program}
                        onClick={() => save(r.program)}
                        style={saveBtn}
                      >
                        {busy === r.program ? "保存中…" : "保存"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "10px 0 0" }}>
        推定売上 = クリック数 × EPC（1クリックあたり推定収益）。EPC はパートナーの成果レポートを見ながら調整してください。実額はパートナー管理画面で要確認。
      </p>
      {msg && <div style={{ marginTop: 8, fontSize: 12 }}>{msg}</div>}
    </div>
  );
}

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 16,
};
const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", fontWeight: 600 };
const thNum: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "8px", color: "var(--text)" };
const tdNum: React.CSSProperties = { ...td, textAlign: "right" };
const epcInput: React.CSSProperties = {
  width: 88,
  padding: "4px 8px",
  fontSize: 13,
  textAlign: "right",
  border: "1px solid var(--border)",
  borderRadius: 6,
};
const saveBtn: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 700,
  border: "1px solid transparent",
  borderRadius: 6,
  background: "var(--ink-800, #152940)",
  color: "#fff",
  cursor: "pointer",
};
