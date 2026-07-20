"use client";

import { Children, useState } from "react";

/**
 * ページ内タブ。パネルの中身はサーバコンポーネントで描画したものを children
 * として受け取り、ここでは表示/非表示を切り替えるだけ（Markdown 描画を
 * クライアントバンドルへ持ち込まないため）。
 */
export default function MaintenanceTabs({
  labels,
  children,
}: {
  labels: string[];
  children: React.ReactNode;
}) {
  const [active, setActive] = useState(0);
  const panels = Children.toArray(children);

  if (labels.length === 0) return null;

  return (
    <div>
      <div
        role="tablist"
        aria-label="メンテナンス機能"
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid var(--border)",
          marginBottom: 16,
          overflowX: "auto",
        }}
      >
        {labels.map((label, i) => {
          const selected = i === active;
          return (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`maint-panel-${i}`}
              id={`maint-tab-${i}`}
              onClick={() => setActive(i)}
              style={{
                padding: "9px 16px",
                fontSize: 13,
                fontWeight: selected ? 700 : 500,
                color: selected ? "var(--text)" : "var(--text-dim)",
                background: "transparent",
                border: "none",
                borderBottom: selected
                  ? "2px solid var(--ink-800, #152940)"
                  : "2px solid transparent",
                marginBottom: -1,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {panels.map((panel, i) => (
        <div
          key={i}
          role="tabpanel"
          id={`maint-panel-${i}`}
          aria-labelledby={`maint-tab-${i}`}
          hidden={i !== active}
        >
          {panel}
        </div>
      ))}
    </div>
  );
}
