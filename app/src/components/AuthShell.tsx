"use client";

import type { ReactNode } from "react";

/*
 * AuthShell — Design System v2 / Section 7 準拠
 * ロゴ + タグライン + 白カードで認証系画面を包む。
 * 直接的なMantineコンポーネント依存を外し、DSトークンで組む。
 */

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "48px 20px 32px",
        background: "var(--bg)",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div
          style={{
            fontSize: 28,
            fontWeight: "var(--fw-heavy)" as never,
            color: "var(--info-700)",
            letterSpacing: "-0.5px",
            lineHeight: 1.1,
          }}
        >
          toritavi
        </div>
        <div
          style={{
            fontSize: "var(--fs-xs)",
            color: "var(--text-dim)",
            marginTop: 2,
          }}
        >
          行動を、前に進める
        </div>
      </div>

      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-md)",
          padding: "28px 22px 24px",
          width: "100%",
          maxWidth: 360,
          boxShadow: "var(--shadow-xs)",
        }}
      >
        <div
          style={{
            fontSize: "var(--fs-xl)",
            fontWeight: 800,
            color: "var(--text)",
            letterSpacing: "-0.3px",
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: "var(--fs-sm)",
              color: "var(--text-dim)",
              marginTop: 4,
              marginBottom: 20,
              lineHeight: 1.6,
            }}
          >
            {subtitle}
          </div>
        )}
        {!subtitle && <div style={{ marginTop: 20 }} />}
        {children}
      </div>
    </div>
  );
}
