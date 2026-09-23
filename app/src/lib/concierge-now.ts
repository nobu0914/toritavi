/**
 * コンシェルジュに「いまが何日か」を渡すための一行。
 *
 * ## 🔴 なぜ要るか（2026-09-23 に実機で踏んだ）
 *
 * 再開直後の実機確認で「今日の予定は？」と聞いたところ、こう返った:
 *
 * > 申し訳ありませんが、**本日の日付が不明** なため、今日の予定をお答えできません。
 * > 今日の日付を教えていただければ、その日の予定をお知らせします。
 *
 * **システムプロンプトにも旅程の文脈にも、現在日時がどこにも入っていなかった。**
 * それでいてプロンプト本文は「**当日動線の助言**」を仕事だと書き、
 * 「日付は YYYY-MM-DD で参照」と体裁まで指定している ——
 * **当日を語れと指示しながら、当日を渡していなかった。**
 *
 * 「今日の予定は？」は旅程アシスタントに最も多く来る質問で、
 * **落ちも警告も出ない**（`CLAUDE.md` §6-1）。返答が丁寧なぶん、
 * 壊れているのではなく「そういう仕様」に見える。
 *
 * ## 🔴 タイムゾーンは必ず名前を添えて出す
 *
 * `ocr-prompt-locale-neutral.test.ts` が記録している失敗と同じ型 ——
 * **省略されたゾーンは、読む側の既定として解釈される。**
 * OCR では「国内なら timezone を省略（JST が前提）」が、米国の利用者に対して
 * **出発時刻が 3 時間ずれたまま通知を飛ばす**形になっていた。
 *
 * ここで裸の「今日は 9 月 23 日」と書くと、同じ穴になる。**ゾーン名を必ず併記する。**
 *
 * 🔴 **いまは JST 固定でよい。1.3.1 は日本のみ配信**（`CURRENT_FACTS.yaml`）。
 *    ただし `docs/overseas-distribution.md` の英語圏（US/GB/CA/AU/NZ）を開けるときは
 *    **端末のゾーンを送って `timeZone` に渡すこと。** 日付境界をまたぐと
 *    「今日」が 1 日ずれる —— ニューヨークの 20:00 は JST では翌日。
 *    引数にしてあるのは、そのとき**呼び出し側だけを直せばよい**ようにするため。
 */

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

/**
 * システムプロンプトへ差し込む「いまの日時」の節を組み立てる。
 *
 * @param now      基準の瞬間（既定は現在）
 * @param timeZone IANA のタイムゾーン名
 * @param label    プロンプトに出す短い呼び名（利用者が読んで分かる形）
 */
export function buildNowBlock(
  now: Date = new Date(),
  timeZone = "Asia/Tokyo",
  label = "JST",
): string {
  // 🔴 `hour12: false` は ICU の版によって深夜を `24` と出す。`h23` を明示する。
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const at = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const [y, m, d, hh, mm] = [at("year"), at("month"), at("day"), at("hour"), at("minute")];
  // 曜日はロケール名を使わず、確定した Y-M-D から引く（表記ゆれを持ち込まない）。
  const dow = WEEKDAY_JA[new Date(`${y}-${m}-${d}T00:00:00Z`).getUTCDay()];

  return `
## いまの日時

- **現在**: ${y}-${m}-${d}（${dow}）${hh}:${mm} ${label}
- 「今日」「明日」「今週」「これから」は、**この日時**を基準に解釈してください
- 🔴 **日付を利用者に尋ね返さないこと。** ここに書いてあります
`;
}
