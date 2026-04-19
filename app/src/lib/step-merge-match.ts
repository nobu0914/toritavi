/**
 * §16.1 Step マッチング — 新規取り込みの StepDraft が既存 Step と
 * 同じ予定を指しているかを 4 階層キーで判定する。
 *
 * 設計メモ:
 *   - 1 ヒットで候補化、スコア降順に最大 3 件返す。
 *   - Phase 1 は auto-merge せず、候補をユーザーに見せて選択させる前提。
 */

import type { Step, StepCategory, Journey } from "./types";

export type MergeCandidate = {
  step: Step;
  journey: Journey;
  score: number;
  tier: 1 | 2 | 3 | 4;
  reason: string;
};

/** マッチ対象となる新規ステップのドラフト（Step の部分集合で十分）。 */
export type MatchableDraft = Pick<
  Step,
  "category" | "title" | "date" | "from" | "to" | "confNumber" | "airline"
>;

const TIER_SCORE: Record<1 | 2 | 3 | 4, number> = {
  1: 100,
  2: 70,
  3: 55,
  4: 40,
};

/** YYYY-MM-DD の日付差（日数）。無効なら Number.MAX_SAFE_INTEGER。 */
function daysBetween(a?: string, b?: string): number {
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.MAX_SAFE_INTEGER;
  return Math.abs(Math.round((ta - tb) / 86_400_000));
}

function normalize(s?: string): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** タイトル類似度（0-1）。共通部分文字列ベースの簡易版。 */
function titleSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const tokensA = new Set(na.split(/[\s\u3000·\-→\/]+/).filter(Boolean));
  const tokensB = new Set(nb.split(/[\s\u3000·\-→\/]+/).filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let hit = 0;
  for (const t of tokensA) if (tokensB.has(t)) hit += 1;
  return hit / Math.max(tokensA.size, tokensB.size);
}

/** 便名・列車名から規格化されたキー（例: "NH118" / "のぞみ225号"）を抽出。 */
function vehicleKey(title: string): string {
  const m = title.match(/([A-Z]{2,3})[\s-]?(\d{1,4})/);
  if (m) return `${m[1].toUpperCase()}${m[2]}`;
  return normalize(title);
}

/** 空港コード / 主要駅コード抽出（前後空白許容）。 */
function locationKey(s?: string): string {
  if (!s) return "";
  const m = s.match(/\b([A-Z]{3})\b/);
  if (m) return m[1];
  return normalize(s);
}

/**
 * §16.1 同一予定を識別するキーの階層評価。
 * - Tier 1: 確認番号完全一致
 * - Tier 2: カテゴリ + 便名/列車名 + 日付 ±1
 * - Tier 3: カテゴリ + from/to + 日付 ±1
 * - Tier 4: カテゴリ + タイトル類似度 ≥ 0.8 + 日付一致（宿泊/商談/食事で有効）
 */
function evaluatePair(
  draft: MatchableDraft,
  existing: Step
): { tier: 1 | 2 | 3 | 4; reason: string } | null {
  if (draft.confNumber && existing.confNumber) {
    if (normalize(draft.confNumber) === normalize(existing.confNumber)) {
      return { tier: 1, reason: `確認番号 ${existing.confNumber} 一致` };
    }
  }

  if (draft.category !== existing.category) return null;

  const dateDiff = daysBetween(draft.date, existing.date);

  // Tier 2: vehicle key match
  if ((draft.category === "飛行機" || draft.category === "列車" || draft.category === "バス") && dateDiff <= 1) {
    const dk = vehicleKey(draft.title ?? "");
    const ek = vehicleKey(existing.title ?? "");
    if (dk && ek && dk === ek) {
      return { tier: 2, reason: `${existing.title} 同便・日付±1日` };
    }
  }

  // Tier 3: from/to match
  if (dateDiff <= 1) {
    const df = locationKey(draft.from);
    const dt = locationKey(draft.to);
    const ef = locationKey(existing.from);
    const et = locationKey(existing.to);
    if (df && ef && df === ef && dt && et && dt === et) {
      return { tier: 3, reason: `${ef} → ${et} 同ルート・日付±1日` };
    }
  }

  // Tier 4: title similarity for non-vehicle categories
  if (
    dateDiff === 0 &&
    (draft.category === "宿泊" || draft.category === "商談" || draft.category === "食事" || draft.category === "病院" || draft.category === "観光")
  ) {
    const sim = titleSimilarity(draft.title ?? "", existing.title);
    if (sim >= 0.8) {
      return { tier: 4, reason: `タイトル類似 (${Math.round(sim * 100)}%)` };
    }
  }

  return null;
}

/**
 * ドラフトと全 Journey を突き合わせ、マージ候補を score 降順で返す。
 * 最大 3 件。候補なしなら空配列。
 */
export function findMergeCandidates(
  draft: MatchableDraft,
  journeys: Journey[],
  opts?: { max?: number }
): MergeCandidate[] {
  const max = opts?.max ?? 3;
  const out: MergeCandidate[] = [];
  for (const j of journeys) {
    for (const s of j.steps) {
      const hit = evaluatePair(draft, s);
      if (!hit) continue;
      out.push({
        step: s,
        journey: j,
        tier: hit.tier,
        reason: hit.reason,
        score: TIER_SCORE[hit.tier],
      });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, max);
}

// カテゴリ別のマッチ相関を外から参照できるように公開しておく（テスト用）。
export const __testing = { titleSimilarity, vehicleKey, locationKey, daysBetween };
