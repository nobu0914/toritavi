/**
 * Build title suggestions for a new Journey from the OCR-extracted Step(s).
 *
 * The intent is to get the user past "blank title input" friction. We
 * propose 2–4 candidates ordered by strength; the first one is
 * reasonable for auto-select.
 *
 * Categories we know how to describe:
 *   - flight / train / bus  → "HND → FUK" (route)
 *   - lodging               → "○○ホテル" (facility)
 *   - medical / business    → "○○クリニック" or "商談: ○○"
 *   - meal / sight / other  → "{title}"
 *
 * If no strong signal is found we fall back to a date-based label
 * ("2026-04-22 の予定") so there is always at least one candidate.
 */

import type { Step } from "@/lib/types";

export type TitleSuggestionKind =
  | "route"
  | "destination"
  | "facility"
  | "title"
  | "date"
  | "fallback";

export type TitleSuggestion = {
  /** Stable key for React list rendering. */
  key: string;
  /** Display text. */
  label: string;
  /** For downstream analytics / highlight; not shown. */
  kind: TitleSuggestionKind;
};

/**
 * Given the steps that will populate a new journey, return up to
 * `max` candidate titles. The first entry is always the strongest.
 *
 * Never throws. Never returns an empty array — the fallback date
 * label is always appended.
 */
export function buildTitleSuggestions(
  steps: Step[],
  max = 4
): TitleSuggestion[] {
  const out: TitleSuggestion[] = [];

  if (!steps || steps.length === 0) {
    return [{ key: "blank", label: "新しい旅程", kind: "fallback" }];
  }

  const first = steps[0];

  // 1) Route — the strongest signal for transit steps.
  const from = compactPlace(first.from);
  const to = compactPlace(first.to);
  if (from && to) {
    out.push({
      key: "route",
      label: `${from} → ${to}`,
      kind: "route",
    });
  }

  // 2) Destination + purpose — if we have a "to" and the category
  //    suggests business/lodging, e.g. "福岡出張" / "大阪 宿泊".
  if (to) {
    const cityTo = cityOnly(to);
    if (first.category === "商談") {
      out.push({ key: "dest-business", label: `${cityTo}出張`, kind: "destination" });
    } else if (first.category === "宿泊") {
      out.push({ key: "dest-lodge", label: `${cityTo} 宿泊`, kind: "destination" });
    } else if (first.category === "観光") {
      out.push({ key: "dest-sight", label: `${cityTo} 旅行`, kind: "destination" });
    }
  }

  // 3) Facility — the step's own title is often the best label for
  //    lodging, medical, or meeting. Skip if it's the generic
  //    "フライト"-style category default.
  const cleaned = first.title?.trim();
  if (
    cleaned &&
    cleaned.length > 0 &&
    !isGenericCategoryLabel(cleaned)
  ) {
    out.push({
      key: "title",
      label: cleaned,
      kind: first.category === "宿泊" || first.category === "病院" ? "facility" : "title",
    });
  }

  // 4) Multi-step aggregate — if we have >1 step and they share a
  //    common "to" city, suggest "○○往復" once.
  if (steps.length > 1) {
    const cities = Array.from(new Set(steps.map((s) => cityOnly(s.to)).filter(Boolean))) as string[];
    if (cities.length === 1) {
      out.push({ key: "roundtrip", label: `${cities[0]}往復`, kind: "destination" });
    }
  }

  // 5) Fallback — always have a date-based label available.
  const d = first.date ?? steps.find((s) => s.date)?.date;
  if (d) {
    out.push({ key: "date", label: `${d} の予定`, kind: "date" });
  } else {
    out.push({ key: "blank", label: "新しい旅程", kind: "fallback" });
  }

  return dedupe(out).slice(0, max);
}

/* ------------------------------------------------------------------ */

function dedupe(items: TitleSuggestion[]): TitleSuggestion[] {
  const seen = new Set<string>();
  const out: TitleSuggestion[] = [];
  for (const it of items) {
    const norm = it.label.trim();
    if (!norm) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(it);
  }
  return out;
}

/**
 * Trim station/airport code suffixes when we want a shorter label.
 * Keeps ASCII letters/digits (airport codes like HND) as-is but drops
 * trailing "空港" / "駅" suffixes so "羽田空港" → "羽田".
 */
function compactPlace(s: string | undefined | null): string {
  if (!s) return "";
  const trimmed = s.trim();
  return trimmed
    .replace(/(空港|駅|ターミナル|バスターミナル)$/u, "")
    .trim();
}

/** Take the first city-like token out of "福岡空港(FUK)" → "福岡". */
function cityOnly(s: string | undefined | null): string {
  if (!s) return "";
  const first = compactPlace(s);
  // Strip bracketed airport/station codes.
  return first.replace(/[（(][^）)]+[）)]\s*$/u, "").trim();
}

/**
 * Category defaults used by ScanFlow's form fallback
 * ("フライト", "鉄道", "ホテル", etc.) — if the step title is one of
 * these, it's not really a name and shouldn't become a Journey title.
 */
const GENERIC_LABELS = new Set([
  "フライト",
  "鉄道",
  "ホテル",
  "チケット",
  "ビジネス",
  "レストラン",
  "バス",
  "病院",
  "その他",
]);
function isGenericCategoryLabel(s: string): boolean {
  return GENERIC_LABELS.has(s);
}
