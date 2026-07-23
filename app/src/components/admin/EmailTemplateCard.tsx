"use client";

import { useState } from "react";
import type { EmailTemplate } from "@/lib/email-templates";

/**
 * 認証メール 1 種のカード。件名・本文をコピーし、描画結果を確認する。
 *
 * SECURITY: `CopyableCode` と同じで、ここは**コピーと表示だけ**を行う。
 * Supabase へ書き戻す導線は持たない（`lib/email-templates.ts` の方針）。
 *
 * プレビューは `sandbox=""` の iframe に入れる。テンプレートは自前の
 * HTML だが、将来ここに外部由来の文面が入っても勝手に動かないようにする。
 */
export default function EmailTemplateCard({
  template,
  previewDoc,
  index,
}: {
  template: EmailTemplate;
  /** サーバ側で組んだプレビュー用 HTML（リンクはダミーに置換済み）。 */
  previewDoc: string;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"subject" | "body" | null>(null);

  async function copy(what: "subject" | "body") {
    const text = what === "subject" ? template.subject : template.html;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  }

  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "14px 16px 12px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--text-dim)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {index + 1}/4
          </span>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{template.tab}</span>
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 12.5, lineHeight: 1.7, color: "var(--text-dim)" }}>
          {template.purpose}
        </p>
      </div>

      <Row label="Subject">
        <code style={codeStyle}>{template.subject}</code>
        <CopyButton onClick={() => copy("subject")} done={copied === "subject"} />
      </Row>

      <Row label="Body">
        <span style={{ ...codeStyle, color: "var(--text-dim)" }}>
          HTML {template.html.length.toLocaleString("ja-JP")} 文字
        </span>
        <CopyButton onClick={() => copy("body")} done={copied === "body"} />
      </Row>

      <div style={{ borderTop: "1px solid var(--border)" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            width: "100%",
            padding: "10px 16px",
            background: "transparent",
            border: 0,
            textAlign: "left",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text)",
            cursor: "pointer",
          }}
        >
          {open ? "▾ 受信側の見た目を隠す" : "▸ 受信側の見た目を見る"}
        </button>
        {open && (
          <iframe
            sandbox=""
            srcDoc={previewDoc}
            title={`${template.tab} のプレビュー`}
            style={{
              display: "block",
              width: "100%",
              height: 460,
              border: 0,
              borderTop: "1px solid var(--border)",
              background: "#fff",
            }}
          />
        )}
      </div>
    </section>
  );
}

const codeStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: 13,
  background: "var(--n-100, #eee)",
  padding: "8px 10px",
  borderRadius: 6,
  overflowX: "auto",
  whiteSpace: "nowrap",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 16px",
        borderTop: "1px solid var(--border)",
      }}
    >
      <span
        style={{
          width: 58,
          flexShrink: 0,
          fontSize: 11,
          fontWeight: 700,
          color: "var(--text-dim)",
          letterSpacing: ".04em",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function CopyButton({ onClick, done }: { onClick: () => void; done: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flexShrink: 0,
        padding: "8px 14px",
        fontSize: 12,
        fontWeight: 700,
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: done ? "var(--success-50, #e8f6ee)" : "#fff",
        color: done ? "var(--success-700, #1a7f4b)" : "var(--text)",
        cursor: "pointer",
      }}
    >
      {done ? "コピー済" : "コピー"}
    </button>
  );
}
