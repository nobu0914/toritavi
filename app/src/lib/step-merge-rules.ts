/**
 * §16.2 フィールド毎マージ戦略
 *
 *   - FILL    : 既存が空のときだけ後情報で埋める（ゲート/座席/ターミナル等）
 *   - REPLACE : 後情報で上書き（時刻変更・便変更など確定情報）
 *   - KEEP    : 既存を維持（memo / status / 手入力した information[]）
 *   - ASK     : 異なる値のときだけユーザーに聞く（title）
 *
 *   カテゴリ別の上書きは STRATEGY_BY_CATEGORY に記述する。
 */

import type { Step, StepCategory, Information } from "./types";

export type MergeStrategy = "FILL" | "REPLACE" | "KEEP" | "ASK";

export type FieldChange = {
  key: string;
  label: string;
  strategy: MergeStrategy;
  before: string | undefined;
  after: string | undefined;
};

/** 差分評価に乗せるフィールドの「見出しラベル」。 */
const FIELD_LABEL: Record<string, string> = {
  title: "タイトル",
  date: "日付",
  endDate: "終了日",
  time: "時刻",
  endTime: "終了時刻",
  timezone: "TZ",
  from: "出発地",
  to: "到着地",
  airline: "運行航空会社",
  confNumber: "確認番号",
  memo: "メモ",
};

/** 既定のフィールド戦略。 */
const DEFAULT_STRATEGY: Record<string, MergeStrategy> = {
  title: "ASK",
  date: "REPLACE",
  endDate: "REPLACE",
  time: "REPLACE",
  endTime: "REPLACE",
  timezone: "REPLACE",
  from: "REPLACE",
  to: "REPLACE",
  airline: "FILL",
  confNumber: "FILL",
  memo: "KEEP",
  status: "KEEP",
};

/** カテゴリ別の戦略オーバーライド（必要なものだけ記述）。 */
const STRATEGY_BY_CATEGORY: Partial<Record<StepCategory, Record<string, MergeStrategy>>> = {
  // 宿泊は「チェックインは予約後に変わらない」前提で time/date を REPLACE のまま、
  // 確認番号は FILL、memo は KEEP で既定のまま。
  飛行機: {
    // 便変更で時刻も to も変わりうるので REPLACE のまま。
  },
};

function strategyOf(category: StepCategory, key: string): MergeStrategy {
  const cat = STRATEGY_BY_CATEGORY[category];
  return cat?.[key] ?? DEFAULT_STRATEGY[key] ?? "KEEP";
}

function isEmpty(v: string | undefined | null): boolean {
  return v === undefined || v === null || v === "";
}

/** 2 つの Step を戦略に従ってマージし、新 Step と差分を返す。 */
export function applyMerge(existing: Step, draft: Partial<Step>): { merged: Step; changes: FieldChange[] } {
  const changes: FieldChange[] = [];
  const result: Step = { ...existing };

  const fields: (keyof Step)[] = [
    "title",
    "date",
    "endDate",
    "time",
    "endTime",
    "timezone",
    "from",
    "to",
    "airline",
    "confNumber",
    "memo",
  ];

  for (const key of fields) {
    const before = (existing[key] as string | undefined) ?? undefined;
    const incoming = (draft[key] as string | undefined) ?? undefined;
    if (incoming === undefined) continue; // draft に無ければ触らない

    const strategy = strategyOf(existing.category, String(key));
    const label = FIELD_LABEL[String(key)] ?? String(key);

    if (strategy === "FILL") {
      if (isEmpty(before) && !isEmpty(incoming)) {
        (result as Record<string, unknown>)[key as string] = incoming;
        changes.push({ key: String(key), label, strategy, before, after: incoming });
      }
    } else if (strategy === "REPLACE") {
      if (!isEmpty(incoming) && before !== incoming) {
        (result as Record<string, unknown>)[key as string] = incoming;
        changes.push({ key: String(key), label, strategy, before, after: incoming });
      }
    } else if (strategy === "ASK") {
      if (!isEmpty(incoming) && before !== incoming) {
        // 呼び出し側で UI を出し、確定後に別途 applyMerge({...,title}) を呼ぶ想定。
        changes.push({ key: String(key), label, strategy, before, after: incoming });
      }
    }
    // KEEP: 何もしない
  }

  // information[] は label をキーに FILL (初回登場のみ追加)
  const incomingInfo = draft.information;
  if (Array.isArray(incomingInfo)) {
    const existingLabels = new Set(existing.information.map((i) => i.label));
    const added: Information[] = [];
    for (const item of incomingInfo) {
      if (!item?.label) continue;
      if (existingLabels.has(item.label)) continue;
      added.push(item);
    }
    if (added.length > 0) {
      result.information = [...existing.information, ...added];
      changes.push({
        key: "information",
        label: "追加情報",
        strategy: "FILL",
        before: `${existing.information.length} 件`,
        after: `${result.information.length} 件 (+${added.length})`,
      });
    }
  }

  // sourceImageUrls[] は常に append（マージ元の画像を残す）
  const incomingImages = draft.sourceImageUrls ?? (draft.sourceImageUrl ? [draft.sourceImageUrl] : undefined);
  if (Array.isArray(incomingImages) && incomingImages.length > 0) {
    const existingImages = existing.sourceImageUrls ?? (existing.sourceImageUrl ? [existing.sourceImageUrl] : []);
    const merged = [...existingImages];
    for (const url of incomingImages) if (!merged.includes(url)) merged.push(url);
    if (merged.length > existingImages.length) {
      result.sourceImageUrls = merged;
    }
  }

  // inferred フラグは new 情報で埋まった項目を除外
  if (existing.inferred?.length) {
    const stillInferred = existing.inferred.filter((k) => {
      const incoming = (draft as Record<string, unknown>)[k];
      return isEmpty(incoming as string | undefined);
    });
    if (stillInferred.length !== existing.inferred.length) {
      result.inferred = stillInferred.length > 0 ? stillInferred : undefined;
    }
  }
  if (existing.needsReview && changes.length > 0) {
    // 確定情報で埋めたのでレビュー不要に
    const coveredInferred = (existing.inferred ?? []).every(
      (k) => !isEmpty((draft as Record<string, unknown>)[k] as string | undefined)
    );
    if (coveredInferred) result.needsReview = undefined;
  }

  // 履歴: 直前値を 1 世代保存
  if (changes.length > 0) {
    const { previous: _discardOld, ...snapshot } = existing;
    result.previous = snapshot;
  }

  return { merged: result, changes };
}

/** マージ前に差分だけ計算したいとき用（ダイアログ表示に使う）。 */
export function diffForPreview(existing: Step, draft: Partial<Step>): FieldChange[] {
  return applyMerge(existing, draft).changes;
}
