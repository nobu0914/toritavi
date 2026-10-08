/**
 * AI の出力を**信用せずに**受ける。
 *
 * 文書の中に書かれた文字列がそのままモデルの出力に混ざりうる
 * （プロンプトインジェクション）。ここを通さないと、
 * - 件数を膨らませて端末側の描画を潰す
 * - 巨大な文字列で保存とキャッシュを圧迫する
 * - `javascript:` などのスキームを画面のリンクに載せる
 * といったことが起きる。**上限を決め、越えた分は捨てる。**
 *
 * 🔴 **捨てたことを黙らない。** `dropped` を返して呼び出し側がログに残す
 * （本文は残さない。件数だけ）。
 */

export const MAX_STEPS = 20;
export const MAX_FIELD_KEYS = 40;
export const MAX_VALUE_CHARS = 500;
export const MAX_LABEL_CHARS = 100;
export const MAX_VARIABLE_ITEMS = 40;
export const MAX_CATEGORY_CHARS = 32;
export const MAX_URL_CHARS = 2048;

export type SanitizedStep = {
  category: string;
  fixed: Record<string, string>;
  variable: Array<{ label: string; value: string }>;
};

/**
 * 飛行機の便名の形を揃える（"NH118" → "NH 118"）。2026-10-08・実データ検査。
 *
 * 指示文でも「XX 123」の形を求めているが、読むたびに "DL2844" と "DL 2844" が
 * 揺れていた。同じ便が別の名前で並ぶと、利用者には別の予定に見える。
 *
 * 🔴 **空白を足すだけ。** 文字は 1 つも変えない・足さない（"ZG029" の 0 は残す）。
 *    航空会社コード（英数字 2 文字・少なくとも 1 文字は英字）＋数字だけで
 *    できている title にしか触らない。航空会社名・コードシェア表記
 *    （"EK 1234 / FZ0567"）・列車名は形が違うので素通りする。
 */
const FLIGHT_NO = /^([A-Z]{2}|[A-Z][0-9]|[0-9][A-Z])\s*([0-9]{1,4}[A-Z]?)$/;
export function normalizeFlightTitle(category: string, title: string): string {
  if (category !== "飛行機") return title;
  const m = title.trim().match(FLIGHT_NO);
  return m ? `${m[1]} ${m[2]}` : title;
}

export type SanitizeResult = {
  steps: SanitizedStep[];
  /** 落とした項目の数。**中身は持たない。** */
  dropped: number;
};

/** http / https 以外のスキームを持つ値を空にする。相対文字列はそのまま。 */
function safeValue(v: string): { value: string; dropped: boolean } {
  const s = v.slice(0, MAX_VALUE_CHARS);
  // スキームらしきものが付いていて http/https でないなら捨てる。
  const m = s.match(/^\s*([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (m) {
    const scheme = m[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") return { value: "", dropped: true };
    if (s.length > MAX_URL_CHARS) return { value: "", dropped: true };
  }
  return { value: s, dropped: s.length !== v.length };
}

function asString(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}

/**
 * モデルが返した JSON を、こちらが決めた形に押し込める。
 * **知らないキーは捨てる。** 型が違うものも捨てる。
 */
export function sanitizeOcrResult(raw: unknown): SanitizeResult {
  let dropped = 0;
  const out: SanitizedStep[] = [];
  if (!raw || typeof raw !== "object") return { steps: [], dropped: 1 };

  const obj = raw as Record<string, unknown>;
  const rawSteps = Array.isArray(obj.steps) ? obj.steps : null;
  if (!rawSteps) return { steps: [], dropped: 1 };

  if (rawSteps.length > MAX_STEPS) dropped += rawSteps.length - MAX_STEPS;

  for (const s of rawSteps.slice(0, MAX_STEPS)) {
    if (!s || typeof s !== "object") {
      dropped++;
      continue;
    }
    const step = s as Record<string, unknown>;
    const category = (asString(step.category) ?? "").slice(0, MAX_CATEGORY_CHARS);

    const fixed: Record<string, string> = {};
    const rawFixed =
      step.fixed && typeof step.fixed === "object" && !Array.isArray(step.fixed)
        ? (step.fixed as Record<string, unknown>)
        : {};
    let keyCount = 0;
    for (const [k, v] of Object.entries(rawFixed)) {
      if (keyCount >= MAX_FIELD_KEYS) {
        dropped++;
        continue;
      }
      const sv = asString(v);
      if (sv === null) {
        dropped++;
        continue;
      }
      const safe = safeValue(sv);
      if (safe.dropped) dropped++;
      fixed[k.slice(0, MAX_LABEL_CHARS)] = safe.value;
      keyCount++;
    }

    const variable: Array<{ label: string; value: string }> = [];
    const rawVar = Array.isArray(step.variable) ? step.variable : [];
    if (rawVar.length > MAX_VARIABLE_ITEMS) dropped += rawVar.length - MAX_VARIABLE_ITEMS;
    for (const it of rawVar.slice(0, MAX_VARIABLE_ITEMS)) {
      if (!it || typeof it !== "object") {
        dropped++;
        continue;
      }
      const o = it as Record<string, unknown>;
      const label = asString(o.label);
      const value = asString(o.value);
      if (label === null || value === null) {
        dropped++;
        continue;
      }
      const safe = safeValue(value);
      if (safe.dropped) dropped++;
      variable.push({ label: label.slice(0, MAX_LABEL_CHARS), value: safe.value });
    }

    if (typeof fixed.title === "string") {
      fixed.title = normalizeFlightTitle(category, fixed.title);
    }

    out.push({ category, fixed, variable });
  }

  return { steps: out, dropped };
}
