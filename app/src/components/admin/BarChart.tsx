"use client";

import { useState } from "react";

export type BarDatum = { day: string; value: number };

type Props = {
  data: BarDatum[];
  height?: number;
  color?: string;
  valueSuffix?: string;
  /** 値を整形（既定は toLocaleString）。 */
  fmt?: (n: number) => string;
};

/**
 * 単一系列の日次バーチャート（依存なしのインライン SVG）。
 * dataviz: 単一軸・細いマーク・4px 丸めたデータ端・recessive な軸・ホバー層。
 * 単一 hue なのでカテゴリカルパレット検証は不要。
 */
export default function BarChart({
  data,
  height = 120,
  color = "#1f7ac0",
  valueSuffix = "",
  fmt = (n) => n.toLocaleString("ja-JP"),
}: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length;
  const W = 720;
  const H = height;
  const padB = 18; // x ラベル余白
  const padT = 6;
  const plotH = H - padB - padT;
  const gap = n > 60 ? 1 : 2;
  const bw = n > 0 ? (W - gap * (n - 1)) / n : W;

  const barX = (i: number) => i * (bw + gap);
  const barH = (v: number) => (v / max) * plotH;

  // x 軸ラベルは疎に（最初・中間・最後）
  const labelIdx = new Set([0, Math.floor(n / 2), n - 1]);
  const shortDay = (day: string) => day.slice(5); // MM-DD

  const allZero = data.every((d) => d.value === 0);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        role="img"
        onMouseLeave={() => setHover(null)}
      >
        {/* baseline */}
        <line x1={0} y1={padT + plotH} x2={W} y2={padT + plotH} stroke="var(--n-200, #e3e3e3)" strokeWidth={1} />
        {data.map((d, i) => {
          const h = barH(d.value);
          const x = barX(i);
          const y = padT + plotH - h;
          const isHover = hover === i;
          return (
            <g key={d.day}>
              {/* hit target: full-height transparent rect */}
              <rect
                x={x}
                y={padT}
                width={bw}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
              <rect
                x={x}
                y={y}
                width={bw}
                height={Math.max(h, d.value > 0 ? 2 : 0)}
                rx={Math.min(3, bw / 2)}
                fill={color}
                opacity={hover === null || isHover ? 1 : 0.55}
              />
              {labelIdx.has(i) && (
                <text
                  x={x + bw / 2}
                  y={H - 4}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--text-dim, #888)"
                >
                  {shortDay(d.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* tooltip */}
      {hover !== null && data[hover] && (
        <div
          style={{
            position: "absolute",
            left: `${(barX(hover) + bw / 2) / W * 100}%`,
            top: 0,
            transform: "translate(-50%, -100%)",
            background: "var(--ink-800, #152940)",
            color: "#fff",
            padding: "4px 8px",
            borderRadius: 6,
            fontSize: 11,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          {data[hover].day}: <strong>{fmt(data[hover].value)}{valueSuffix}</strong>
        </div>
      )}

      {allZero && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            color: "var(--text-dim)",
            pointerEvents: "none",
          }}
        >
          データなし
        </div>
      )}
    </div>
  );
}
