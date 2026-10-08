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
export const MAX_INFERRED_ITEMS = 20;

export type SanitizedStep = {
  category: string;
  fixed: Record<string, string>;
  variable: Array<{ label: string; value: string }>;
  /**
   * AI が推定した項目のキー（"date" / "endDate" / "year" など）。
   *
   * 🔴 **2026-08-22〜10-08 はここで捨てていた**（課金攻撃対策で整形を入れたとき、
   *    型に無かった）。アプリは `inferred` を見て「要確認」と推定チップを出し、
   *    `"year"` を見て年ズレ補正をする（`ocr_service.dart` の `stepFromOcrJson`）。
   *    捨てると、**推測で埋めた日付が「読み取れた日付」として確認の機会なく
   *    保存される**。落ちも警告も出なかった（`CLAUDE.md` §6-1）。
   *
   *    キーの形（英字で始まる英数字・32 文字まで）だけを通す。値は持たない。
   */
  inferred: string[];
  /** AI が付けた要確認の印。真偽値以外は false。 */
  needsReview: boolean;
};

const INFERRED_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

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

/* ====== 曜日の照合（2026-10-08・実データ検査 #4） ====== */

/**
 * 書かれた曜日（"金" / "Fri" / "(土)" / "星期五" / "금요일"）を 0=日〜6=土 に直す。
 * **知らない書き方は null**（照合しない）。推測で曜日を決めない。
 */
export function parseWeekday(raw: string | undefined): number | null {
  if (!raw) return null;
  let t = raw.trim().toLowerCase().replace(/[\s.,()（）\[\]【】]/g, "");
  t = t.replace(/曜日$|曜$|요일$/, "");
  const ja = "日月火水木金土";
  if (t.length === 1 && ja.includes(t)) return ja.indexOf(t);
  const ko = "일월화수목금토";
  if (t.length === 1 && ko.includes(t)) return ko.indexOf(t);
  const zh = t.match(/^(?:星期|礼拜|禮拜|周|週)([日天一二三四五六])$/);
  if (zh) return zh[1] === "天" ? 0 : "日一二三四五六".indexOf(zh[1]);
  if (/^[a-z]{3,9}$/.test(t)) {
    const en = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const i = en.indexOf(t.slice(0, 3));
    const full = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    if (i >= 0 && full[i].startsWith(t)) return i;
  }
  return null;
}

function weekdayOf(ymd: string): number | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.getUTCDay();
}

/**
 * 日付と、書類に**併記された曜日**を突き合わせる。
 *
 * 日・月の順の予約確認（"金, 02 1, 2026"）で、指示文に曜日の照合を書いても
 * 5 回中 2 回は曜日の合わない側（2026-02-01・日曜）を返した。モデルに計算を
 * 任せず、ここで機械的に確かめる。
 *
 * - 曜日が合う → そのまま
 * - 合わず、**日と月を入れ替えると合う** → 入れ替えて inferred に入れる
 *   （値を作るのではなく、書かれた 2 つの数の読み順を直すだけ）
 * - どちらでも合わない／年を補った日付 → **値は変えず** inferred に入れる
 *   （読み違いかもしれないので、利用者に確かめてもらう）
 *
 * 曜日の欄（dateWeekday / endDateWeekday）は照合にだけ使い、アプリへは送らない。
 */
const WEEKDAY_FIELDS: Array<[string, string]> = [
  ["date", "dateWeekday"],
  ["endDate", "endDateWeekday"],
];
function reconcileWeekdays(fixed: Record<string, string>, inferred: string[]): boolean {
  let flagged = false;
  const yearGuessed = inferred.includes("year");
  for (const [key, wkKey] of WEEKDAY_FIELDS) {
    const printed = parseWeekday(fixed[wkKey]);
    delete fixed[wkKey];
    const ymd = fixed[key];
    if (printed === null || !ymd) continue;
    const actual = weekdayOf(ymd);
    if (actual === null || actual === printed) continue;
    const [y, mo, d] = ymd.split("-");
    const swapped = `${y}-${d}-${mo}`;
    if (!yearGuessed && mo !== d && weekdayOf(swapped) === printed) fixed[key] = swapped;
    if (!inferred.includes(key)) inferred.push(key);
    flagged = true;
  }
  return flagged;
}

/**
 * 飛行機の title が**予約番号そのもの**なら、航空会社名に替える（2026-10-08）。
 *
 * 便名の無い書類（"REF: NH-AB12CD" だけ）で、指示文で禁じても 3 回中 2 回は
 * 予約番号を便名の形（"NH AB12CD"）にして返した。便名として検索すると
 * 別の便に行き着く。航空会社名は書類から読んだ値なので、値を作ってはいない。
 * 航空会社名が無ければ触らない。
 */
function notBookingRef(category: string, fixed: Record<string, string>): string {
  const title = fixed.title ?? "";
  if (category !== "飛行機" || !fixed.confNumber || !fixed.airline) return title;
  const norm = (x: string) => x.replace(/[\s\-_/.]/g, "").toUpperCase();
  return norm(title) !== "" && norm(title) === norm(fixed.confNumber) ? fixed.airline : title;
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
      fixed.title = notBookingRef(category, fixed);
    }

    const inferred: string[] = [];
    const rawInf = Array.isArray(step.inferred) ? step.inferred : [];
    for (const k of rawInf) {
      if (typeof k !== "string" || !INFERRED_KEY.test(k) || inferred.length >= MAX_INFERRED_ITEMS) {
        dropped++;
        continue;
      }
      if (!inferred.includes(k)) inferred.push(k);
    }
    const weekdayFlagged = reconcileWeekdays(fixed, inferred);
    const needsReview = step.needsReview === true || weekdayFlagged;

    out.push({ category, fixed, variable, inferred, needsReview });
  }

  return { steps: out, dropped };
}
