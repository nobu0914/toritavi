/*
 * コンシェルジュに渡す番号を、仮の記号に置き換えて送り、答えで本物に戻す。
 *
 * ## 🔴 なぜこの形か（2026-09-28・利用者の決定「一般的にあるべき姿に合わせたい」）
 *
 * 以前は `pii-mask.ts` の `maskJourney` で**末尾だけ残して**送っていた。
 * AI には番号の全体が渡らないが、**利用者が「確認番号は？」と聞いても
 * 答えられない**（「お手元の控えで」としか返せない）。自分で登録した値なのに。
 *
 * 一般的な形は 3 段:
 *
 * | 段 | 中身 | 扱い |
 * |---|---|---|
 * | ① 答えに要らない機微 | メール・カード番号・旅券番号 | **送らない**（従来どおり `scrubSensitive`） |
 * | ② 答えに要る識別子 | 確認番号・電話番号・会員番号 | **ここ。** `[CONF_1]` の形で送り、返ってきた答えの中でサーバが本物に戻す |
 * | ③ 旅程の中身 | 日時・場所・便名・宿名 | そのまま送る |
 *
 * AI は本物の番号を見ず、利用者には全桁で答えられる。
 *
 * ## 🔴 使うときの約束
 *
 * - **記号は要求ごとに振り直す。** 同じ値には同じ記号を返すが、
 *   別の要求では番号がずれうる。だから**会話の履歴は本物の値で保存し、
 *   送る直前にこの金庫で隠し直す**（`hide`）。記号のまま保存すると、
 *   次の要求で別の値に戻ってしまう。
 * - **隠せるのは、金庫に登録した値だけ。** 旅程から消した予定の番号が
 *   過去の会話に残っていると、それは隠れずに送られる（登録元が無いため）。
 * - **戻せない記号は本物らしく埋めない。** AI が存在しない記号を作ったら、
 *   「予定の画面で確認して」に置き換える（推測の番号を出さない）。
 */

import { scrubSensitive, type SafeJourney, type SafeStep } from "./pii-mask";
import type { Journey, Step } from "./types";

export type PiiKind = "CONF" | "TEL" | "MEMBER";

/** 戻せない記号の置き換え先。**番号らしいものを作らない。** */
export const UNKNOWN_TOKEN_TEXT = "（番号は予定の画面でご確認ください）";

const TOKEN_RE = /\[?\b(CONF|TEL|MEMBER)_(\d{1,4})\b\]?/g;

/**
 * 自由文（メモ・詳細・情報欄）の中で本物を探して隠す最短の長さ。
 * 短い値（「12」など）を文中で探すと、時刻や金額の一部まで記号に変わる。
 * **欄そのもの（`confNumber` など）は長さに関係なく記号にする。**
 */
const MIN_FREE_TEXT_LEN = 5;

export class PiiVault {
  private readonly tokenOf = new Map<string, string>();
  private readonly valueOf = new Map<string, string>();
  private readonly counters: Record<PiiKind, number> = { CONF: 0, TEL: 0, MEMBER: 0 };

  /** 値を登録し、記号を返す。空なら null。 */
  token(kind: PiiKind, raw: string | null | undefined): string | null {
    if (raw == null) return null;
    const v = String(raw).trim();
    if (!v) return null;
    const known = this.tokenOf.get(v);
    if (known) return known;
    this.counters[kind] += 1;
    const t = `[${kind}_${this.counters[kind]}]`;
    this.tokenOf.set(v, t);
    this.valueOf.set(t, v);
    return t;
  }

  get size(): number {
    return this.tokenOf.size;
  }

  /**
   * 文の中に出てくる登録済みの値を記号に置き換える。
   * **前後が英数字に続く箇所は置き換えない**（別の番号の一部を壊さない）。
   * 長い値から先に置き換える（短い値が長い値の一部だったときに備える）。
   */
  hide(text: string): string {
    if (!text || this.tokenOf.size === 0) return text;
    const values = [...this.tokenOf.keys()]
      .filter((v) => v.length >= MIN_FREE_TEXT_LEN)
      .sort((a, b) => b.length - a.length);
    let out = text;
    for (const v of values) {
      const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(v)}(?![A-Za-z0-9])`, "g");
      out = out.replace(re, this.tokenOf.get(v) as string);
    }
    return out;
  }

  /** 答えの中の記号を本物に戻す。`unknown` は戻せなかった数。 */
  reveal(text: string): { text: string; unknown: number } {
    let unknown = 0;
    const out = text.replace(TOKEN_RE, (_m, kind: string, n: string) => {
      const v = this.valueOf.get(`[${kind}_${Number(n)}]`);
      if (v !== undefined) return v;
      unknown += 1;
      return UNKNOWN_TOKEN_TEXT;
    });
    return { text: out, unknown };
  }

  /** ツールの入力（予定を足す提案など）の文字列欄を戻す。 */
  revealDeep<T>(value: T): T {
    if (typeof value === "string") return this.reveal(value).text as unknown as T;
    if (Array.isArray(value)) return value.map((v) => this.revealDeep(v)) as unknown as T;
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.revealDeep(v);
      }
      return out as T;
    }
    return value;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ---- 情報欄の見出しで種類を決める ---- */

// 🔴 **「予約サービス」は番号ではない**（スマートEX などの名前。IC カードの
//    助言に要る）。「予約」だけで拾わず、「番号・ID・コード」まで見る。
const CONF_LABEL = /(予約|確認|受付|問い?合わ?せ|申込)(番号|ID|コード|No)|confirmation|booking\s*(no|number|ref|code|id)|reservation\s*(no|number|code|id)|\bpnr\b|record\s*locator/i;
const MEMBER_LABEL = /mile|マイル|skymiles|会員番号|member/i;
const TEL_LABEL = /tel|電話|phone|携帯/i;
const EMAIL_LABEL = /email|メール|e-mail/i;

function kindOfLabel(label: string): PiiKind | "EMAIL" | null {
  if (EMAIL_LABEL.test(label)) return "EMAIL";
  if (MEMBER_LABEL.test(label)) return "MEMBER";
  if (TEL_LABEL.test(label)) return "TEL";
  if (CONF_LABEL.test(label)) return "CONF";
  return null;
}

/* ---- 旅程単位 ---- */

/**
 * 旅程をまとめて守る。
 *
 * **2 段で回す。** 先に全旅程の番号欄を登録し、そのあとで自由文を隠す ——
 * 1 段目で登録していない番号は、2 段目で文中から探せない
 * （旅程 A のメモに旅程 B の確認番号が書いてある場合など）。
 */
export function protectJourneys(journeys: Journey[], vault: PiiVault): SafeJourney[] {
  for (const j of journeys) {
    for (const s of j.steps) {
      vault.token("CONF", s.confNumber);
      for (const info of s.information ?? []) {
        const k = kindOfLabel(info.label);
        if (k && k !== "EMAIL") vault.token(k, info.value);
      }
    }
  }
  const text = (v: string | null | undefined) =>
    v == null ? undefined : (scrubSensitive(vault.hide(String(v))) ?? undefined);

  return journeys.map((j) => ({
    ...j,
    title: vault.hide(j.title),
    memo: text(j.memo),
    steps: j.steps.map((s): SafeStep => protectStep(s, vault, text)),
  }));
}

function protectStep(
  s: Step,
  vault: PiiVault,
  text: (v: string | null | undefined) => string | undefined,
): SafeStep {
  return {
    ...s,
    title: vault.hide(s.title),
    confNumber: vault.token("CONF", s.confNumber) ?? undefined,
    memo: text(s.memo),
    detail: text(s.detail),
    information: (s.information ?? []).map((info) => {
      const k = kindOfLabel(info.label);
      // ① 答えに要らない機微は送らない（従来どおり）。
      if (k === "EMAIL") return { ...info, value: "[メール省略]" };
      if (k) return { ...info, value: vault.token(k, info.value) ?? "" };
      return { ...info, value: text(info.value) ?? "" };
    }),
  };
}
