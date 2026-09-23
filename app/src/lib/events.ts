/**
 * 利用解析のイベント —— **受け取ってよいものを、ここ 1 か所で決める。**
 *
 * 🔴 **許可一覧に無い名前は捨てる。** 自由な文字列を通すと、いつか
 *    「その他」に本文が入る。表の `props` は 2KB 制限があるが、
 *    **制限は量であって中身ではない** —— 中身は名前で縛る。
 *
 * 🔴 **旅程の中身を 1 バイトも通さない。** 便名・確認番号・地名・氏名・
 *    メール・自由入力・写真。`props` に入れてよいのは
 *    **数と短い識別子だけ**（押した要素の名前・滞在ミリ秒・件数・理由コード）。
 *    ここが緩むと、解析のために PII を貯める表になる。
 */

/** 受け取るイベント名。**ここに無いものは 400 ではなく、黙って捨てる**（下記）。 */
export const EVENT_NAMES = [
  // 画面
  "screen.view", // props: { ms?: number, from?: string }
  // 操作
  "tap", // props: { target: string }
  // 節目
  "signup.started",
  "signup.completed",
  "scan.started", // props: { kind: 'camera'|'file'|'text'|'share', n?: number }
  "scan.succeeded", // props: { n?: number, units?: number }
  "scan.failed", // props: { reason: string }
  "journey.created",
  "step.created",
  "share.opened",
  "share.completed", // props: { format: 'pdf'|'image'|'text' }
  "paywall.shown", // props: { from?: string }
  "paywall.dismissed",
  "purchase.started",
  "purchase.completed",
  "offline.notice.shown", // props: { where: string }
  // 🔴 2026-09-23 に利用者の指示で追加（「使われているかを確認する時に使う」）。
  //    **アプリ側 `lib/core/analytics/analytics.dart` の
  //    `kAnalyticsEventNames` と対。** 片方だけに足すと、
  //    送っているのに**ここで黙って捨てられて集計に出ない。**
  "calendar.opened",
  "concierge.asked",
  "concierge.journey_picked",
  "concierge.limits_opened",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

const NAMES = new Set<string>(EVENT_NAMES);

/** `props` に入れてよい鍵。**それ以外は落とす。** */
const ALLOWED_PROP_KEYS = new Set([
  "target",
  "from",
  "where",
  "kind",
  "format",
  "reason",
  "ms",
  "n",
  "units",
]);

/**
 * 🔴 **値は「識別子の形」でなければ通さない。**
 *
 * 長さだけで守ろうとして失敗した（2026-09-13・検査で発覚）。48 文字に
 * していたところ、`ご予約ありがとうございます。確認番号 SKR-6620 / NH215 羽田`
 * が **41 文字なのでそのまま通った。** 本文は短いこともある ——
 * **長さは中身の代わりにならない。**
 *
 * ここに入るのは**アプリが自分で決めた語**だけ（`scan_button`,
 * `journey_detail`, `network_timeout`, `pdf`）。だから形を固定できる:
 * **英小文字で始まり、英小文字・数字・`_` だけ、32 文字まで。**
 *
 * これで構造的に落ちるもの —— 日本語／大文字（`SKR-6620`）／空白／
 * `@`（メール）／`-` や `/`（便名・確認番号）／数字始まり。
 * **「入れない約束」ではなく「入らない構造」。**
 */
const IDENT = /^[a-z][a-z0-9_]{0,31}$/;

export type IncomingEvent = {
  name: string;
  screen?: unknown;
  props?: unknown;
  at_local?: unknown;
};

export type CleanEvent = {
  name: EventName;
  screen: string | null;
  props: Record<string, string | number>;
};

/** 識別子の形か。違えば null（**切らずに落とす**）。 */
const ident = (v: unknown): string | null =>
  typeof v === "string" && IDENT.test(v) ? v : null;

/**
 * 文脈の欄（版・ロケール）は識別子ではないので、別の形で縛る。
 * `1.3.0` / `26.3` / `ja-JP` が通り、日本語と空白は通らない。
 */
const tag = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= max &&
  /^[A-Za-z0-9._-]+$/.test(v)
    ? v
    : null;

/**
 * 1 件を検査して整える。**通せないものは null。**
 *
 * 🔴 **落としたことを呼び出し側が数える**（`sanitizeEvents` の `dropped`）。
 *    黙って捨てると、アプリ側の配線ミスに永久に気づけない ——
 *    「イベントが来ていない」と「イベントが弾かれている」は
 *    集計の画面では同じに見える（`CLAUDE.md` §6-1）。
 */
export function sanitizeEvent(raw: IncomingEvent): CleanEvent | null {
  if (!raw || typeof raw.name !== "string") return null;
  if (!NAMES.has(raw.name)) return null;

  const props: Record<string, string | number> = {};
  const src = raw.props;
  if (src && typeof src === "object" && !Array.isArray(src)) {
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      if (!ALLOWED_PROP_KEYS.has(k)) continue;
      if (typeof v === "number" && Number.isFinite(v)) {
        // 🔴 **負と桁あふれを入れない。** 端末の時計や計算ミスがそのまま
        //    集計に乗ると、平均が壊れて原因が分からなくなる。
        if (v >= 0 && v <= 1_000_000_000) props[k] = v;
        continue;
      }
      const s = ident(v);
      if (s !== null) props[k] = s;
    }
  }
  return {
    name: raw.name as EventName,
    screen: ident(raw.screen),
    props,
  };
}

/** 1 回のまとめ送りで受け取る上限。**超えた分は捨てる。** */
export const MAX_BATCH = 50;

export function sanitizeEvents(list: unknown): {
  events: CleanEvent[];
  dropped: number;
} {
  if (!Array.isArray(list)) return { events: [], dropped: 0 };
  const capped = list.slice(0, MAX_BATCH);
  const events: CleanEvent[] = [];
  for (const raw of capped) {
    const ok = sanitizeEvent(raw as IncomingEvent);
    if (ok) events.push(ok);
  }
  return { events, dropped: list.length - events.length };
}

/** 文脈の欄。**個人を特定する値を入れない。** */
export function sanitizeContext(body: Record<string, unknown>) {
  const plan = body.plan;
  return {
    app_version: tag(body.appVersion, 32),
    os_version: tag(body.osVersion, 32),
    locale: tag(body.locale, 16),
    plan: plan === "free" || plan === "pro" ? plan : null,
  };
}

/** UUID v4 の形か。session_id は端末が作るので、形だけ確かめる。 */
export function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}
