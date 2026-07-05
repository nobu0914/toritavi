"use client";

import { useEffect, useState, useCallback } from "react";

type UserFile = {
  bucket: string;
  path: string;
  name: string;
  sizeBytes: number | null;
  createdAt: string | null;
  url: string | null;
};

type Props = {
  userId: string;
  canDelete: boolean; // super_admin
};

function fmtSize(bytes: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const BUCKET_LABEL: Record<string, string> = {
  "step-attachments": "スキャン画像",
  "toritavi-avatars": "アバター",
};

export default function UserFilesPanel({ userId, canDelete }: Props) {
  const [files, setFiles] = useState<UserFile[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/files`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setFiles(data.files ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setFiles([]);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function del(f: UserFile) {
    if (!confirm(`このファイルを削除します。元に戻せません。\n${f.path}`)) return;
    setBusy(f.path);
    try {
      const res = await fetch(`/api/admin/users/${userId}/files`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket: f.bucket, path: f.path }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setFiles((prev) => (prev ?? []).filter((x) => x.path !== f.path));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
          アップロードファイル {files ? `(${files.length})` : ""}
        </h2>
        <button onClick={load} style={refreshBtn}>再読込</button>
      </div>

      {err && <div style={{ fontSize: 12, color: "var(--danger-700, #b00)", marginBottom: 8 }}>{err}</div>}

      {files === null ? (
        <div style={{ fontSize: 13, color: "var(--text-dim)" }}>読み込み中…</div>
      ) : files.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-dim)" }}>ファイルはありません</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
          {files.map((f) => (
            <div key={f.path} style={tile}>
              <div style={thumb}>
                {f.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.url} alt={f.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={{ fontSize: 11, color: "var(--text-dim)" }}>プレビュー不可</span>
                )}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 4 }}>
                {BUCKET_LABEL[f.bucket] ?? f.bucket} · {fmtSize(f.sizeBytes)}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-dim)", wordBreak: "break-all" }}>{f.name}</div>
              {canDelete && (
                <button disabled={busy === f.path} onClick={() => del(f)} style={delBtn}>
                  {busy === f.path ? "削除中…" : "削除"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!canDelete && files && files.length > 0 && (
        <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "10px 0 0" }}>
          ファイル削除は super_admin のみ実行できます。
        </p>
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
const tile: React.CSSProperties = { display: "flex", flexDirection: "column" };
const thumb: React.CSSProperties = {
  width: "100%",
  aspectRatio: "1 / 1",
  background: "var(--n-100, #f0f0f0)",
  borderRadius: 8,
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const refreshBtn: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "#fff",
  cursor: "pointer",
};
const delBtn: React.CSSProperties = {
  marginTop: 6,
  padding: "4px 8px",
  fontSize: 11,
  fontWeight: 700,
  border: "1px solid transparent",
  borderRadius: 8,
  background: "var(--danger-600, #d33)",
  color: "#fff",
  cursor: "pointer",
};
