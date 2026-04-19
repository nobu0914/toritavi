/*
 * Step field → 外部リンク / コピー アクションの pure resolver.
 * DS v2 §14 参照。Phase 1 は getFieldLink の 1 フィールド 1 リンク構成のみ。
 */

import type { StepCategory } from "./types";

export type LinkKind = "maps" | "official" | "copy";

/*
 * iOS では Google Maps の URL を window.open すると SFSafariViewController
 * (アプリ内ブラウザ) が立ち上がり、Maps アプリへの Universal Link handoff
 * 後に空白シェルが残る現象がある。Apple Maps の Universal Link
 * (maps.apple.com) は iPhone に必ず入っているネイティブ Maps へ直接渡るため、
 * クリック時に iOS だけ差し替える。
 */
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iOS / iPadOS の両方を拾う（iPadOS は Mac UA を返すので touch 判定を足す）
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function resolveMapsUrl(query: string): string {
  const q = encodeURIComponent(query);
  return isIOS()
    ? `https://maps.apple.com/?q=${q}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function resolveSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

export type StepLink = {
  kind: LinkKind;
  /** aria-label / tooltip */
  label: string;
  /** maps で使用（生クエリ、click 時に iOS/Apple Maps or Google Maps に解決） */
  mapsQuery?: string;
  /** official で使用（航空会社などの検索クエリ、click 時に Google 検索 URL へ） */
  searchQuery?: string;
  /** copy で使用（書き込む文字列） */
  value?: string;
};

/**
 * Phase 1 対象フィールド:
 *   - from / to      → Maps（iOS は Apple Maps、それ以外は Google Maps、click 時解決）
 *   - airline (飛行機) → 航空会社 公式検索（Google 検索フォールバック、click 時解決）
 *   - confNumber     → クリップボードコピー
 *
 * 非対象カテゴリ / 値なしは null。便名からのフライト追跡リンクは撤去。
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
        mapsQuery: v,
      };

    case "airline": {
      if (category !== "飛行機") return null;
      return {
        kind: "official",
        label: "航空会社を検索",
        searchQuery: `${v} 公式サイト`,
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
