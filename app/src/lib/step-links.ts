/*
 * Step field → 外部リンク / コピー アクションの pure resolver.
 * DS v2 §14 参照。Phase 1 は getFieldLink の 1 フィールド 1 リンク構成のみ。
 */

import type { StepCategory } from "./types";

export type LinkKind = "maps" | "flight-status" | "copy";

export type StepLink = {
  kind: LinkKind;
  /** aria-label / tooltip */
  label: string;
  /** maps / flight-status で使用 */
  url?: string;
  /** copy で使用（書き込む文字列） */
  value?: string;
};

/*
 * 例: "ANA NZ90", "NH225", "NZ 90", "UA-123" → "NZ90" / "NH225" / "NZ90" / "UA123"
 * 先頭にキャリア名（ANA / JAL 等）が付いていても後段の 2 文字コード + 数字を拾う。
 */
const FLIGHT_CODE_RE = /\b([A-Z]{2})[\s-]*0*(\d{1,4})\b/;

/**
 * Phase 1 対象フィールド（§14.9）:
 *   - from / to      → Google Maps
 *   - title (飛行機) → FlightAware
 *   - confNumber     → クリップボードコピー
 *
 * 非対象カテゴリ / 値なし / パースできない便名は null。
 */
export function getFieldLink(
  category: StepCategory,
  fieldKey: string,
  value: string | undefined,
): StepLink | null {
  const v = (value ?? "").trim();
  if (!v) return null;

  switch (fieldKey) {
    case "from":
    case "to":
      return {
        kind: "maps",
        label: "地図で開く",
        url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v)}`,
      };

    case "title": {
      if (category !== "飛行機") return null;
      const m = v.match(FLIGHT_CODE_RE);
      if (!m) return null;
      const flight = `${m[1]}${m[2]}`;
      return {
        kind: "flight-status",
        label: "運行状況を確認",
        url: `https://flightaware.com/live/flight/${flight}`,
      };
    }

    case "confNumber":
      return {
        kind: "copy",
        label: "確認番号をコピー",
        value: v,
      };

    default:
      return null;
  }
}
