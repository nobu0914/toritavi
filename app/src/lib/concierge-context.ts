/*
 * Concierge プロンプトに注入する Journey コンテキストを組み立てる。
 * DS v2 §15 参照。
 *
 * 入力:
 *   - ユーザーの全 Journey
 *   - 明示的に context に指定した Journey ID（チャットヘッダーの「参照中」）
 * 出力:
 *   - マスク済み Journey を Claude prompt 用に整形した system block 追加テキスト
 *
 * 方針:
 *   - 明示参照が 1 つでも指定されていれば「指定分 + 直近 1 件」を載せる
 *   - 指定なしなら「直近（更新日順）3 件」
 *   - 各 Journey は SafeJourney に変換してから JSON シリアライズ
 */

import { maskJourney, type SafeJourney } from "./pii-mask";
import type { Journey } from "./types";

const MAX_JOURNEYS_WITHOUT_CONTEXT = 3;
const MAX_JOURNEYS_WITH_CONTEXT = 4; // 指定 + 補助 1 件

export type ConciergeContextInput = {
  allJourneys: Journey[];
  contextJourneyIds?: string[];
};

export type ConciergeContext = {
  includedJourneyIds: string[];
  safe: SafeJourney[];
  /** Claude の system prompt に差し込むテキスト（JSON 埋め込み） */
  promptBlock: string;
};

export function buildConciergeContext({
  allJourneys,
  contextJourneyIds,
}: ConciergeContextInput): ConciergeContext {
  // updated_at 降順で安定化
  const sorted = [...allJourneys].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const byId = new Map(sorted.map((j) => [j.id, j]));

  const picked: Journey[] = [];
  const explicit = (contextJourneyIds ?? []).map((id) => byId.get(id)).filter((j): j is Journey => Boolean(j));

  if (explicit.length > 0) {
    for (const j of explicit) picked.push(j);
    // 追加で直近 1 件だけ（重複除去）
    for (const j of sorted) {
      if (picked.length >= MAX_JOURNEYS_WITH_CONTEXT) break;
      if (!picked.find((p) => p.id === j.id)) picked.push(j);
    }
  } else {
    for (const j of sorted) {
      if (picked.length >= MAX_JOURNEYS_WITHOUT_CONTEXT) break;
      picked.push(j);
    }
  }

  const safe = picked.map(maskJourney);
  const promptBlock = buildPromptBlock(safe, contextJourneyIds ?? []);

  return {
    includedJourneyIds: picked.map((j) => j.id),
    safe,
    promptBlock,
  };
}

function buildPromptBlock(safe: SafeJourney[], explicitIds: string[]): string {
  const header = [
    "## ユーザーの旅程データ（PII マスク済み）",
    "",
    "以下は toritavi に登録されている Journey とその Step のサマリ。",
    "ユーザーの質問に答えるための最新コンテキストとして参照してください。",
    explicitIds.length > 0
      ? `ユーザーが明示的に参照指定している Journey: ${explicitIds.join(", ")}`
      : "ユーザーは特定の Journey を指定していません。必要なら質問で確認してください。",
    "",
    "注意:",
    "- 確認番号 / マイレージ / 電話番号は末尾のみ可視。全桁を把握している前提で回答しないこと。",
    "- メール / 決済情報 / パスポートは送信されていません。必要なら「お手元の控えでご確認ください」と案内。",
    "",
  ].join("\n");

  const body = safe.length === 0
    ? "（Journey がまだ登録されていません）"
    : "```json\n" + JSON.stringify(safe.map(compactJourney), null, 2) + "\n```";

  return `${header}${body}`;
}

// Claude に渡す際のトークン節約（不要なフィールドを削ぎ落とす）
function compactJourney(j: SafeJourney) {
  return {
    id: j.id,
    title: j.title,
    startDate: j.startDate,
    endDate: j.endDate,
    memo: j.memo ?? null,
    steps: j.steps.map((s) => ({
      id: s.id,
      category: s.category,
      title: s.title,
      date: s.date ?? null,
      endDate: s.endDate ?? null,
      time: s.time,
      endTime: s.endTime ?? null,
      from: s.from ?? null,
      to: s.to ?? null,
      airline: s.airline ?? null,
      confNumber: s.confNumber ?? null,
      timezone: s.timezone ?? null,
      status: s.status,
      inferred: s.inferred ?? null,
      needsReview: s.needsReview ?? false,
      information: s.information ?? [],
      memo: s.memo ?? null,
      detail: s.detail ?? null,
    })),
  };
}
