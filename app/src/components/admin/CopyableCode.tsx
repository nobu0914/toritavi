"use client";

import { useState } from "react";

/**
 * SQL などをクリップボードにコピーするだけのコンポーネント。
 *
 * SECURITY: ここは「コピー」しかしない。SQL やエンドポイントをこの画面から
 * 実行することは意図的にサポートしない（purge エンドポイントを叩かない／
 * PURGE_SECRET をフロントに持ち込まない）。運用者が Supabase の SQL Editor に
 * 貼って手動実行する前提。
 */
export default function CopyableCode({
  code,
  size = "md",
}: {
  code: string;
  size?: "md" | "lg";
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
      <code
        style={{
          flex: 1,
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          fontSize: size === "lg" ? 15 : 13,
          fontWeight: size === "lg" ? 600 : 400,
          background: "var(--ink-900, #0F1B2D)",
          color: "#e8f2fb",
          padding: size === "lg" ? "14px 16px" : "10px 12px",
          borderRadius: 8,
          overflowX: "auto",
          whiteSpace: "pre",
        }}
      >
        {code}
      </code>
      <button
        type="button"
        onClick={copy}
        style={{
          flexShrink: 0,
          padding: "0 14px",
          fontSize: 12,
          fontWeight: 700,
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: copied ? "var(--success-50, #e8f6ee)" : "#fff",
          color: copied ? "var(--success-700, #1a7f4b)" : "var(--text)",
          cursor: "pointer",
        }}
      >
        {copied ? "コピー済" : "コピー"}
      </button>
    </div>
  );
}
