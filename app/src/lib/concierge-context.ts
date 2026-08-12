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
 * 方針（2026-08-12 変更・利用者の判断）:
 *   - **登録されている Journey は全件載せる。**
 *   - ただし Step まで全件入れるとトークンが青天井になるので、
 *     詳細は文字数の予算で切る。切った分も「存在すること」は必ず伝える。
 *   - 各 Journey は SafeJourney に変換してから JSON シリアライズ
 *
 * 🔴 **なぜ変えたか。** 以前は「指定なしなら直近 3 件」だった
 * （DS v2 §15 の Low Cost 方針。導入時の合意は `分5 / 日100・200k tok / 月$50`）。
 * これは**コストのための上限で、正しさのためではない**。実際に
 * 「福岡出張について」と聞いて **"見当たりません" と返る**事故が起きた
 * （2026-08-12・8 件登録のうち上位 3 件から漏れていた）。
 * 登録してあるものを「無い」と答えるのは、このアプリで最も避けたい嘘なので、
 * **全件を必ず見せる**方に倒した。
 *
 * サーバ側の DS v2 §15 が前提にしていた「チャットヘッダーの参照中」UI は
 * アプリに存在しない（`contextJourneyIds` を送る画面が無い）。
 * つまり指定ありの経路は現状どこからも通らない。指定は引き続き受け付けるが、
 * **指定が無くても全件見える**のが既定になった。
 */

import { maskJourney, type SafeJourney } from "./pii-mask";
import type { Journey } from "./types";

/**
 * Step まで含めて詳細を載せる分の文字数予算。
 *
 * **件数ではなく文字数で切る。** 1 件に 30 Step 入っている旅程と、
 * 1 Step の旅程を同じ「1 件」と数えると、予算の意味が無くなる。
 * 超えた分は要約だけ載せる（存在は必ず伝わる）。
 *
 * 目安: 約 40k 文字 ≒ 12k トークン。日次 200k トークンの枠に対して
 * 1 往復あたりの上限として置いている。
 */
const DETAIL_CHAR_BUDGET = 40_000;

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

  // **全件が対象。** 明示指定があるものだけ先頭へ寄せ、詳細の予算を優先的に
  // 使わせる。落とすためではなく、順番を決めるためだけに使う。
  const explicit = (contextJourneyIds ?? [])
    .map((id) => byId.get(id))
    .filter((j): j is Journey => Boolean(j));
  const picked: Journey[] = [...explicit];
  for (const j of sorted) {
    if (!picked.find((p) => p.id === j.id)) picked.push(j);
  }

  const safe = picked.map(maskJourney);

  // 詳細（Step 付き）を載せる範囲を文字数で決める。**最低 1 件は必ず詳細を
  // 載せる** —— 予算を先頭の 1 件が食い切っても、そこだけは答えられる形にする。
  const detailed: SafeJourney[] = [];
  const summaryOnly: SafeJourney[] = [];
  let used = 0;
  for (const j of safe) {
    const size = JSON.stringify(compactJourney(j)).length;
    if (detailed.length === 0 || used + size <= DETAIL_CHAR_BUDGET) {
      detailed.push(j);
      used += size;
    } else {
      summaryOnly.push(j);
    }
  }

  const promptBlock = buildPromptBlock(detailed, summaryOnly, contextJourneyIds ?? []);

  return {
    // **全件を返す。** 呼び出し側が「どこまで見せたか」を記録できるようにする。
    includedJourneyIds: picked.map((j) => j.id),
    safe,
    promptBlock,
  };
}

function buildPromptBlock(
  detailed: SafeJourney[],
  summaryOnly: SafeJourney[],
  explicitIds: string[],
): string {
  const total = detailed.length + summaryOnly.length;
  const header = [
    "## ユーザーの旅程データ（PII マスク済み）",
    "",
    `JUNROS に登録されている Journey は全部で ${total} 件で、下に全件を挙げています。`,
    "ユーザーの質問に答えるための最新コンテキストとして参照してください。",
    explicitIds.length > 0
      ? `ユーザーが明示的に参照指定している Journey: ${explicitIds.join(", ")}`
      : "ユーザーは特定の Journey を指定していません。必要なら質問で確認してください。",
    "",
    "注意:",
    "- 確認番号 / マイレージ / 電話番号は末尾のみ可視。全桁を把握している前提で回答しないこと。",
    "- メール / 決済情報 / パスポートは送信されていません。必要なら「お手元の控えでご確認ください」と案内。",
    // 🔴 ここが今回の肝。詳細を省いた Journey を「無い」と言わせない。
    "- **下に挙がっている Journey は、すべて実在するものです。**",
    "  「登録が見当たりません」と答えてよいのは、下のどのリストにも無い場合だけです。",
    "",
  ].join("\n");

  if (total === 0) return `${header}（Journey がまだ登録されていません）`;

  const detailBlock = [
    `### 詳細（Step 付き・${detailed.length} 件）`,
    "```json",
    JSON.stringify(detailed.map(compactJourney), null, 2),
    "```",
  ].join("\n");

  if (summaryOnly.length === 0) return `${header}${detailBlock}`;

  // 予算で詳細を落とした分。**存在と概要は必ず伝える。**
  const summaryBlock = [
    "",
    `### 概要のみ（${summaryOnly.length} 件）`,
    "コンテキスト長の都合で Step を省いています。**存在しないという意味ではありません。**",
    "この中について詳しく聞かれたら、旅程名を挙げて「その旅程の詳細を確認しますか」と尋ねてください。",
    "```json",
    JSON.stringify(summaryOnly.map(summarizeJourney), null, 2),
    "```",
  ].join("\n");

  return `${header}${detailBlock}${summaryBlock}`;
}

// 予算を超えた分。**存在・名前・日付・件数だけ**を残す。
function summarizeJourney(j: SafeJourney) {
  return {
    id: j.id,
    title: j.title,
    startDate: j.startDate,
    endDate: j.endDate,
    memo: j.memo ?? null,
    stepCount: j.steps.length,
    detailOmitted: true,
  };
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
