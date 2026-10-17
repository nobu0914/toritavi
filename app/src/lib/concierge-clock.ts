/**
 * コンシェルジュに渡す「いまの時刻」と「次の予定までの時間」。
 *
 * ## 🔴 なぜ要るか（2026-10-17 にシミュレーターで踏んだ）
 *
 * ニューヨーク発ロンドン行き（10/17 19:30 EDT 発）の旅程で「今日の予定は？」と
 * 聞いたら、こう返った:
 *
 * > 現在 21:16 なので、あと 2 時間 14 分で出発です。
 *
 * そのとき実際は **10/16（金）21:16 EDT**＝出発の約 22 時間前。誤りは 2 つ重なっていた:
 *
 *   1. **「いま」を日本時間でしか渡していなかった**（`buildNowBlock()` の既定）。
 *      日付は日本の 10/17、時刻は AI が勝手に直したニューヨークの 21:16 —— 混ざった
 *   2. **時刻の差を AI に計算させていた。** 21:16 から 19:30 発まで「あと 2 時間 14 分」は
 *      どの読み方でも成り立たない
 *
 * 米国を含む 66 か国へ配信を開けた（2026-10-06）時点で、`concierge-now.ts` の注記が
 * 「端末のゾーンを送って `timeZone` に渡すこと」と予告していた穴そのもの。
 *
 * ## 直し方
 *
 *   1. **利用者のいる場所のゾーン**を決める —— アプリが端末のゾーン（IANA）を送れば
 *      それ。送らない古い版（1.6.1 まで）は、**旅程の予定から推定**する
 *      （いま居るはずの場所＝最後に始まった予定の到着地、まだ出発前なら次の予定の出発地）。
 *      どちらも無ければ日本時間（日本の利用者の国内旅行は、ゾーン欄が空のことが多い）
 *   2. **残り時間はサーバが計算して渡す。** AI には「自分で計算しない」と指示する
 *
 * 🔴 **時刻の解釈はアプリの `lib/core/time/trip_time.dart` と同じ規則**にする ——
 *    明示オフセット（`EDT (UTC-4)`）を IANA より優先し、解けないものは null
 *    （推測で埋めない・フェイルクローズ）。
 */
import { weekdayJa } from "./concierge-now";

/** 予定 1 件のうち、時刻の計算に使う部分だけ。 */
export type ClockStep = {
  category?: string;
  title?: string;
  date?: string | null;
  endDate?: string | null;
  time?: string | null;
  endTime?: string | null;
  timezone?: string | null;
  information?: { label?: string | null; value?: string | null }[] | null;
};

export type ClockJourney = { title?: string; steps?: ClockStep[] | null };

/** 移動系（出発地と到着地のゾーンが違いうる）。アプリの `kMovingCategories` と同じ。 */
const MOVING = new Set(["飛行機", "列車", "バス", "車", "船", "徒歩"]);

/** 到着地タイムゾーンの行。アプリの `isArrivalTimezoneLabel` と同じ幅。 */
const ARRIVAL_TZ_LABEL = /到着.*(タイムゾーン|時差)|arr.*time\s*zone/i;

/**
 * 略称だけの保存値（オフセットが書かれていない古いデータ）。
 * 🔴 **意味が 2 つ以上ある略称は入れない**（CST＝中国／米中部、IST＝インド／アイルランド等）。
 */
const ABBREVIATIONS: Record<string, number> = {
  UTC: 0, GMT: 0, BST: 60, CET: 60, CEST: 120, EET: 120, EEST: 180,
  JST: 540, KST: 540, HKT: 480, SGT: 480, PHT: 480, ICT: 420, WIB: 420,
  AEST: 600, AEDT: 660, ACST: 570, ACDT: 630, AWST: 480, NZST: 720, NZDT: 780,
  EST: -300, EDT: -240, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420,
  AKST: -540, AKDT: -480, HST: -600,
};

/** `"EDT (UTC-4)"` → -240 / `"NPT（UTC+5:45）"` → 345 / IANA や略称 → null。 */
export function explicitOffsetMinutes(zone?: string | null): number | null {
  const m = /UTC\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/.exec(zone ?? "");
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? "0"));
}

/** IANA のゾーン ID として使えるか（`America/New_York`・`UTC`）。 */
export function isIanaZone(zone?: string | null): boolean {
  const z = (zone ?? "").trim();
  if (!z || z.length > 64 || !(z.includes("/") || z === "UTC")) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

function ianaOffsetMinutes(zone: string, at: Date): number | null {
  try {
    const name =
      new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    if (name === "GMT") return 0;
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
    if (!m) return null;
    return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? "0"));
  } catch {
    return null;
  }
}

/** そのゾーンの、ある瞬間のオフセット（分）。解けなければ null。 */
export function zoneOffsetAt(zone: string | null | undefined, at: Date): number | null {
  const z = (zone ?? "").trim();
  if (!z) return null;
  const explicit = explicitOffsetMinutes(z);
  if (explicit !== null) return explicit;
  if (isIanaZone(z)) return ianaOffsetMinutes(z, at);
  const abbr = /^[A-Z]{2,5}$/.exec(z)?.[0];
  return abbr && abbr in ABBREVIATIONS ? ABBREVIATIONS[abbr] : null;
}

/**
 * プロンプトに出すゾーンの呼び名。**保存値をそのまま出さない**（利用者が入力した
 * 文字列なので、命令文を混ぜられる）。解いた結果から組み直す ——
 * IANA ならその ID、オフセットなら先頭の略称（あれば）＋ `UTC±hh:mm`。
 */
export function zoneLabel(zone: string | null | undefined, at: Date): string | null {
  const z = (zone ?? "").trim();
  if (isIanaZone(z)) return z;
  const off = zoneOffsetAt(z, at);
  if (off === null) return null;
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const hhmm = `${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  const abbr = /^[A-Z]{2,5}\b/.exec(z)?.[0];
  return abbr && abbr !== "UTC" && abbr !== "GMT" ? `${abbr} (UTC${sign}${hhmm})` : `UTC${sign}${hhmm}`;
}

/** 現地の `YYYY-MM-DD` + `HH:MM` + ゾーン → 瞬間。どれかが欠ける・解けないなら null。 */
export function localInstant(
  date?: string | null,
  time?: string | null,
  zone?: string | null,
): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec((date ?? "").slice(0, 10));
  const t = /^(\d{1,2}):(\d{2})/.exec((time ?? "").trim());
  if (!d || !t) return null;
  const naive = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  const off = zoneOffsetAt(zone, new Date(naive));
  if (off === null) return null;
  let inst = naive - off * 60_000;
  // 夏時間の切り替え付近は、推定した瞬間のオフセットで 1 回だけ取り直す。
  const off2 = zoneOffsetAt(zone, new Date(inst));
  if (off2 !== null && off2 !== off) inst = naive - off2 * 60_000;
  return new Date(inst);
}

/** 瞬間 → そのゾーンの壁時計。解けなければ null。 */
export function wallClock(at: Date, zone: string): { date: string; time: string; dow: string } | null {
  const off = zoneOffsetAt(zone, at);
  if (off === null) return null;
  const s = new Date(at.getTime() + off * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`;
  return { date, time: `${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}`, dow: weekdayJa(date) ?? "" };
}

function arrivalZoneOf(step: ClockStep): string | null {
  for (const i of step.information ?? []) {
    if (ARRIVAL_TZ_LABEL.test(i?.label ?? "")) {
      const v = (i?.value ?? "").trim();
      return v || null;
    }
  }
  return null;
}

/** 予定の終わりの瞬間（移動は到着地のゾーン。分からなければ null）。 */
function endInstant(step: ClockStep): Date | null {
  const moving = MOVING.has(step.category ?? "");
  const zone = moving ? arrivalZoneOf(step) : step.timezone;
  if (!step.endTime) return null;
  return localInstant(step.endDate || step.date, step.endTime, zone);
}

export type TravelerZone = {
  /** 計算に使うゾーン（IANA・`EDT (UTC-4)`・略称のどれか） */
  zone: string;
  /** プロンプトに出す呼び名 */
  label: string;
  source: "device" | "trip" | "default";
};

const HOUR = 3_600_000;

/**
 * 利用者のいる場所のゾーン。
 *
 *   1. アプリが送った端末のゾーン（IANA）
 *   2. 旅程からの推定 —— 72 時間以内に始まった予定があれば、その予定の
 *      到着地（着いていれば）か出発地。無ければ 48 時間以内に始まる予定の出発地
 *   3. 日本時間
 */
export function resolveTravelerZone({
  deviceTimeZone,
  journeys,
  now = new Date(),
}: {
  deviceTimeZone?: unknown;
  journeys: ClockJourney[];
  now?: Date;
}): TravelerZone {
  if (typeof deviceTimeZone === "string" && isIanaZone(deviceTimeZone)) {
    return { zone: deviceTimeZone, label: deviceTimeZone, source: "device" };
  }

  let last: { at: number; zone: string } | null = null;
  let next: { at: number; zone: string } | null = null;
  for (const j of journeys) {
    for (const s of j.steps ?? []) {
      const dep = (s.timezone ?? "").trim();
      const start = localInstant(s.date, s.time, dep);
      if (!start) continue;
      const t = start.getTime();
      if (t <= now.getTime()) {
        let zone = dep;
        if (MOVING.has(s.category ?? "")) {
          const arr = arrivalZoneOf(s);
          const end = endInstant(s);
          if (arr && end && end.getTime() <= now.getTime() && zoneOffsetAt(arr, now) !== null) {
            zone = arr;
          }
        }
        if (!last || t > last.at) last = { at: t, zone };
      } else if (!next || t < next.at) {
        next = { at: t, zone: dep };
      }
    }
  }
  if (last && now.getTime() - last.at <= 72 * HOUR) {
    return { zone: last.zone, label: zoneLabel(last.zone, now) ?? "JST", source: "trip" };
  }
  if (next && next.at - now.getTime() <= 48 * HOUR) {
    return { zone: next.zone, label: zoneLabel(next.zone, now) ?? "JST", source: "trip" };
  }
  return { zone: "Asia/Tokyo", label: "JST", source: "default" };
}

/**
 * 「いまの日時」の節。**利用者のいる場所の時刻**を先に出し、日本時間と違えば
 * 日本時間も添える（どちらの「今日」かを取り違えさせない）。
 */
export function buildTravelerNowBlock(now: Date, traveler: TravelerZone): string {
  const here = wallClock(now, traveler.zone) ?? wallClock(now, "Asia/Tokyo")!;
  const label = wallClock(now, traveler.zone) ? traveler.label : "JST";
  const jst = wallClock(now, "Asia/Tokyo")!;
  const sameAsJst = here.date === jst.date && here.time === jst.time;
  const where =
    traveler.source === "default" ? "" : "（利用者のいる場所の時刻）";
  return `
## いまの日時

- **現在**: ${here.date}（${here.dow}）${here.time} ${label}${where}
${sameAsJst ? "" : `- 日本時間: ${jst.date}（${jst.dow}）${jst.time} JST\n`}- 「今日」「明日」「今週」「これから」は、**現在の日付**を基準に解釈してください
- 🔴 **日付を利用者に尋ね返さないこと。** ここに書いてあります
`;
}

function formatLeft(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  return [d ? `${d} 日` : "", h ? `${h} 時間` : "", d ? "" : `${m} 分`].filter(Boolean).join(" ") || "0 分";
}

/**
 * 進行中の予定と、次の予定（最大 3 件）までの時間。**サーバが計算した値**。
 * 🔴 タイムゾーンが分からない予定は載せない（推測で残り時間を出さない）。
 */
export function buildUpcomingBlock(journeys: ClockJourney[], now: Date): string {
  type Item = { at: number; line: string };
  const running: Item[] = [];
  const upcoming: Item[] = [];
  for (const j of journeys) {
    for (const s of j.steps ?? []) {
      const zone = (s.timezone ?? "").trim();
      const start = localInstant(s.date, s.time, zone);
      if (!start) continue;
      const name = `「${(s.title ?? "").trim() || s.category || "予定"}」${s.category ? `（${s.category}）` : ""}`;
      const at = `${s.date}（${weekdayJa(s.date) ?? ""}）${(s.time ?? "").trim()} ${zoneLabel(zone, start) ?? ""}`;
      const diff = start.getTime() - now.getTime();
      if (diff > 0) {
        upcoming.push({ at: start.getTime(), line: `- ${name}: 現地 ${at} 開始 —— **あと ${formatLeft(diff)}**` });
      } else {
        const end = endInstant(s);
        if (end && end.getTime() > now.getTime()) {
          running.push({
            at: start.getTime(),
            line: `- ${name}: 現地 ${at} 開始・**いま進行中**（終了まであと ${formatLeft(end.getTime() - now.getTime())}）`,
          });
        }
      }
    }
  }
  upcoming.sort((a, b) => a.at - b.at);
  running.sort((a, b) => b.at - a.at);
  const lines = [...running.slice(0, 2), ...upcoming.slice(0, 3)].map((i) => i.line);
  return `
## 次の予定までの時間（サーバが計算した値）

- 🔴 **時刻の差・残り時間・「何時間後」は、自分で計算しないこと。** 下の値だけを使う
- 下に無い予定（タイムゾーンが分からない予定）の残り時間は答えず、予定の現地時刻だけを伝える
${lines.length ? lines.join("\n") : "- （タイムゾーンが分かる、これからの予定はありません）"}
`;
}
