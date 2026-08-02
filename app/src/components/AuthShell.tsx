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
      {/*
        ロゴはアプリと同じ縦組みロックアップ（マーク＋ワードマーク）。
        正本は `toritavi_app/assets/brand/junros-12/junros-12-v-primary.svg` で、
        アプリの BrandLockup も同じファイルを使う。**文字で "JUNROS" と
        書き起こさない** —— 以前はここだけテキストだったため、アプリには
        マークがあるのに Web には無い、という食い違いになっていた。
        比率 194.44 : 144 は SVG が持っているので、こちらで組み直さない。
      */}
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/junros-12-v-primary.svg"
          alt="JUNROS"
          width={104}
          height={Math.round(104 * (144 / 194.44))}
          style={{ display: "block", margin: "0 auto" }}
        />
        <div
          style={{
            fontSize: "var(--fs-sm)",
            color: "var(--text-dim)",
            marginTop: 10,
            lineHeight: 1.5,
          }}
        >
          散らばった旅の予定を、ひとまとめに。
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
