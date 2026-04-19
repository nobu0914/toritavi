/*
 * PII マスキング純関数。
 * Concierge プロンプト構築前に必ずここを通す。
 *
 * DS v2 §15.5 参照。
 *
 * 原則:
 *   - KEEP  : 便名 / 空港 / 駅 / 時刻 / タイトル / 氏名
 *             → AI の回答生成に必須
 *   - MASK  : 確認番号 / マイレージ番号 / 電話番号
 *             → 形だけ残す（末尾 4 桁など）。コンテキスト混乱を避けるため
 *   - DROP  : メール / 決済情報 / パスポート / クレカ
 *             → 完全に除去、プロンプトに乗せない
 */

import type { Step, Journey } from "./types";

/* ---- 文字列系ユーティリティ ---- */

/**
 * 確認番号 / 航空券番号: 先頭 3 文字 + '****' + 末尾 2 文字
 * 例: "LASKNT86" → "LAS****86"
 * 短すぎる場合（6 文字未満）は全マスク。
 */
export function maskConfNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = String(raw).trim();
  if (v.length < 6) return "****";
  return `${v.slice(0, 3)}****${v.slice(-2)}`;
}

/**
 * マイレージ / メンバー番号: 末尾 4 桁以外マスク
 * 例: "1234567724" → "XXXXXX7724"
 */
export function maskMileageNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length <= 4) return digits;
  return "X".repeat(digits.length - 4) + digits.slice(-4);
}

/**
 * 電話番号: 中間部をマスク
 * 例: "03-1234-5678" → "03-****-5678"
 * 例: "+819012345678" → "+81********5678"
 */
export function maskPhoneNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = String(raw).trim();
  if (v.length <= 8) return "****";
  return v.slice(0, 3) + "*".repeat(Math.max(4, v.length - 7)) + v.slice(-4);
}

/* ---- 検出パターン（テキスト内の埋め込み PII を掘り出す） ---- */

// メールアドレス
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// 16 桁のクレカ番号（スペース / ハイフンあり）
const CC_RE = /\b(?:\d[ -]*?){13,16}\b/g;
// パスポート風 9-10 桁 英数字
const PASSPORT_RE = /\b[A-Z]{1,2}\d{7,9}\b/g;

/**
 * 自由テキスト内の DROP 系 PII を完全除去（「[削除済み]」に置換）。
 * memo / detail 等の自由入力列に適用。
 */
export function scrubSensitive(text: string | null | undefined): string | null {
  if (!text) return null;
  return String(text)
    .replace(EMAIL_RE, "[メール省略]")
    .replace(CC_RE, "[番号省略]")
    .replace(PASSPORT_RE, "[番号省略]");
}

/* ---- Step / Journey 単位のマスク ---- */

export type SafeStep = Omit<Step, "confNumber" | "memo" | "detail"> & {
  confNumber?: string | null;
  memo?: string | null;
  detail?: string | null;
};

export type SafeJourney = Omit<Journey, "steps" | "memo"> & {
  memo?: string | null;
  steps: SafeStep[];
};

/**
 * Step をマスク済み SafeStep に変換。undefined のフィールドはそのまま。
 */
export function maskStep(step: Step): SafeStep {
  return {
    ...step,
    confNumber: maskConfNumber(step.confNumber ?? null) ?? undefined,
    memo: scrubSensitive(step.memo ?? null) ?? undefined,
    detail: scrubSensitive(step.detail ?? null) ?? undefined,
    // information 内にマイレージ / 電話があればマスク
    information: (step.information ?? []).map((info) => {
      const label = info.label.toLowerCase();
      if (/mile|マイル|skymiles|会員番号|member/i.test(label)) {
        return { ...info, value: maskMileageNumber(info.value) ?? "" };
      }
      if (/tel|電話|phone|携帯/i.test(label)) {
        return { ...info, value: maskPhoneNumber(info.value) ?? "" };
      }
      if (/email|メール|e-mail/i.test(label)) {
        return { ...info, value: "[メール省略]" };
      }
      // その他は scrub のみ（自由テキスト内の PII 除去）
      return { ...info, value: scrubSensitive(info.value) ?? "" };
    }),
  };
}

/**
 * Journey をマスク済み SafeJourney に変換。
 */
export function maskJourney(journey: Journey): SafeJourney {
  return {
    ...journey,
    memo: scrubSensitive(journey.memo ?? null) ?? undefined,
    steps: journey.steps.map(maskStep),
  };
}
