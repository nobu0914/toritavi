"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  userId: string;
  canSuspend: boolean; // super_admin
  initialStatus: "active" | "suspended" | "banned";
  initialReason: string | null;
  initialFlagged: boolean;
  initialNote: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  active: "有効",
  suspended: "停止中",
  banned: "凍結",
};

export default function UserModerationPanel({
  userId,
  canSuspend,
  initialStatus,
  initialReason,
  initialFlagged,
  initialNote,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [reason, setReason] = useState(initialReason ?? "");
  const [flagged, setFlagged] = useState(initialFlagged);
  const [note, setNote] = useState(initialNote ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // 🔴 **記録なしで実行された操作を黙って通さない**（2026-08-16 の検査）。
  //    監査失敗で業務は止めない設計だが、成功表示だけ出すと
  //    「誰がやったか分からない特権操作」が起きたことに気づけない。
  //    msg は次の操作で上書きされるので、別の帯として残す。
  const [auditWarn, setAuditWarn] = useState(false);

  // notify form
  const [nTitle, setNTitle] = useState("");
  const [nBody, setNBody] = useState("");

  async function call(path: string, body: unknown, method = "POST") {
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
    if (data?.auditFailed) setAuditWarn(true);
    return data;
  }

  async function changeStatus(next: "active" | "suspended" | "banned") {
    const label = STATUS_LABEL[next];
    if (next !== "active" && !confirm(`このユーザーを「${label}」にします。よろしいですか？`)) return;
    setBusy("status");
    setMsg(null);
    try {
      await call(`/api/admin/users/${userId}/status`, { status: next, reason });
      setStatus(next);
      setMsg(`状態を「${label}」に変更しました`);
      router.refresh();
    } catch (e) {
      setMsg(`失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function saveFlag(next: boolean) {
    setBusy("flag");
    setMsg(null);
    try {
      await call(`/api/admin/users/${userId}/flag`, { flagged: next, note });
      setFlagged(next);
      setMsg(next ? "調査中フラグを立てました" : "フラグを解除しました");
      router.refresh();
    } catch (e) {
      setMsg(`失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function sendNotify() {
    if (!nTitle.trim() || !nBody.trim()) {
      setMsg("通知のタイトルと本文を入力してください");
      return;
    }
    // 🔴 **取り消せない操作には確認を挟む。** 停止・ファイル削除には confirm が
    // あるのに、通知だけ 1 クリックで実機に着弾していた（2026-08-16 の検査 L-5）。
    // 送ってしまった通知は消せない —— 誤送信の重さは停止と変わらない。
    // 中身も見せる（何を送るのか目で確認してから押す）。
    if (
      !confirm(
        "この利用者の端末へ通知を送ります。送信後は取り消せません。\n\n" +
          `件名: ${nTitle.trim()}\n本文: ${nBody.trim()}`
      )
    ) {
      return;
    }
    setBusy("notify");
    setMsg(null);
    try {
      const r = await call(`/api/admin/users/${userId}/notify`, {
        title: nTitle,
        body: nBody,
      });
      setMsg(`通知を送信しました（配信 ${r.sent} / 失敗 ${r.failed}）`);
      setNTitle("");
      setNBody("");
    } catch (e) {
      setMsg(`失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={card}>
      <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 12px" }}>モデレーション</h2>

      {/* current status */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>現在の状態:</span>
        <span style={statusBadge(status)}>{STATUS_LABEL[status]}</span>
        {flagged && <span style={statusBadge("flagged")}>調査中</span>}
      </div>

      {/* flag (operator+) */}
      <div style={{ marginBottom: 16 }}>
        <label style={fieldLabel}>調査メモ（内部用・利用者には非表示）</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="例: 短時間に大量スキャン。第三者書類の疑い。"
          style={textarea}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          {!flagged ? (
            <button disabled={busy !== null} onClick={() => saveFlag(true)} style={btn("warn")}>
              調査中フラグを立てる
            </button>
          ) : (
            <>
              <button disabled={busy !== null} onClick={() => saveFlag(true)} style={btn("plain")}>
                メモを保存
              </button>
              <button disabled={busy !== null} onClick={() => saveFlag(false)} style={btn("plain")}>
                フラグ解除
              </button>
            </>
          )}
        </div>
      </div>

      {/* notify (operator+) */}
      <div style={{ marginBottom: 16, paddingTop: 12, borderTop: "1px solid var(--n-100)" }}>
        <label style={fieldLabel}>この利用者に通知（プッシュ）</label>
        <input
          value={nTitle}
          onChange={(e) => setNTitle(e.target.value)}
          maxLength={80}
          placeholder="タイトル（例: ご利用に関するお願い）"
          style={input}
        />
        <textarea
          value={nBody}
          onChange={(e) => setNBody(e.target.value)}
          rows={2}
          maxLength={300}
          placeholder="本文"
          style={{ ...textarea, marginTop: 6 }}
        />
        <button disabled={busy !== null} onClick={sendNotify} style={{ ...btn("plain"), marginTop: 6 }}>
          {busy === "notify" ? "送信中…" : "通知を送信"}
        </button>
      </div>

      {/* suspend / ban (super_admin only) */}
      <div style={{ paddingTop: 12, borderTop: "1px solid var(--n-100)" }}>
        <label style={fieldLabel}>アカウント状態の変更（利用者に表示される理由）</label>
        {canSuspend ? (
          <>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="停止理由（例: 規約第9条違反のため）"
              style={input}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              {status === "active" ? (
                <>
                  <button disabled={busy !== null} onClick={() => changeStatus("suspended")} style={btn("danger")}>
                    一時停止（suspend）
                  </button>
                  <button disabled={busy !== null} onClick={() => changeStatus("banned")} style={btn("danger")}>
                    凍結（ban）
                  </button>
                </>
              ) : (
                <button disabled={busy !== null} onClick={() => changeStatus("active")} style={btn("plain")}>
                  停止を解除（再有効化）
                </button>
              )}
            </div>
            <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "8px 0 0" }}>
              停止/凍結すると OCR・コンシェルジュ・通知の各 API が 403 を返し、理由が利用者に表示されます。
            </p>
          </>
        ) : (
          <p style={{ fontSize: 12, color: "var(--text-dim)", margin: 0 }}>
            アカウント停止・凍結は super_admin のみ実行できます。
          </p>
        )}
      </div>

      {auditWarn && (

        <div style={{ fontSize: 12, color: "var(--danger, #c0392b)", marginBottom: 8 }}>

          ⚠️ 直前の操作は実行されましたが、**監査ログに記録できませんでした**。

          誰がいつ実行したかを後から辿れません。運用へ連絡してください

        </div>

      )}

      {msg && (
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--text)" }}>{msg}</div>
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
const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "var(--text-dim)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 4,
};
const input: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: 8,
  boxSizing: "border-box",
};
const textarea: React.CSSProperties = { ...input, resize: "vertical", fontFamily: "inherit" };

function btn(kind: "danger" | "warn" | "plain"): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 8,
    cursor: "pointer",
    border: "1px solid var(--border)",
  };
  if (kind === "danger") return { ...base, background: "var(--danger-600, #d33)", color: "#fff", borderColor: "transparent" };
  if (kind === "warn") return { ...base, background: "var(--warn-500, #f0a500)", color: "#fff", borderColor: "transparent" };
  return { ...base, background: "#fff", color: "var(--text)" };
}

function statusBadge(kind: string): React.CSSProperties {
  const danger = kind === "suspended" || kind === "banned";
  const warn = kind === "flagged";
  return {
    display: "inline-block",
    padding: "2px 8px",
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 999,
    background: danger ? "var(--danger-50, #fee)" : warn ? "var(--warn-50, #fff7e6)" : "var(--n-100, #eee)",
    color: danger ? "var(--danger-700, #b00)" : warn ? "var(--warn-700, #8a5a00)" : "var(--text-dim)",
  };
}
